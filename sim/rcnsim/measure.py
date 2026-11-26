from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from .agents import Ledger
from .api import Sample, Stats
from .faults import RESTORE, FaultEvent
from .scenario import Scenario

IN_PROGRESS = {"assigned", "picked_up", "in_transit"}

ORDERS = """
SELECT id::text AS id,
       extract(epoch FROM created_at)::float8 AS created,
       status::text AS status,
       courier_id::text AS courier_id
FROM orders.orders
WHERE customer_id = ANY($1::uuid[])
ORDER BY created_at
"""

LOGS = """
SELECT order_id::text AS order_id,
       status,
       courier_id::text AS courier_id,
       distance_m,
       attempt_number,
       extract(epoch FROM created_at)::float8 AS at
FROM dispatch.dispatch_logs
WHERE order_id = ANY($1::uuid[])
ORDER BY created_at
"""

ORDER_EVENTS = """
SELECT routing_key,
       payload->>'orderId' AS order_id,
       payload->>'newStatus' AS new_status,
       extract(epoch FROM created_at)::float8 AS created,
       extract(epoch FROM published_at)::float8 AS published
FROM orders.outbox_events
WHERE extract(epoch FROM created_at) >= $1
"""

PUBLISH_LAG = """
SELECT extract(epoch FROM published_at)::float8 - extract(epoch FROM created_at)::float8 AS lag
FROM {schema}.outbox_events
WHERE extract(epoch FROM created_at) >= $1 AND published_at IS NOT NULL
"""

UNPUBLISHED = "SELECT count(*) FROM {schema}.outbox_events WHERE published_at IS NULL"


@dataclass(frozen=True)
class Outcome:
    id: str
    step: int
    created: float
    status: str
    courier_id: str | None
    assigned: float | None
    assigned_courier: str | None
    assignments: int
    attempts: int
    distance_m: float | None
    failed: float | None
    delivered: float | None
    ended: float | None


def percentile(values: Sequence[float], share: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(share * len(ordered)) - 1)]


def spread(values: Sequence[float], scale: float = 1.0, digits: int = 3) -> dict[str, Any]:
    def scaled(value: float | None) -> float | None:
        return None if value is None else round(value * scale, digits)

    return {
        "count": len(values),
        "p50": scaled(percentile(values, 0.50)),
        "p95": scaled(percentile(values, 0.95)),
        "max": scaled(max(values) if values else None),
    }


def step_of(created: float, boundaries: Sequence[float]) -> int:
    for index, boundary in enumerate(boundaries):
        if created < boundary:
            return index
    return len(boundaries) - 1


def outcomes(
    orders: Sequence[Any],
    logs: Sequence[Any],
    events: Sequence[Any],
    boundaries: Sequence[float],
) -> list[Outcome]:
    assigned: dict[str, list[Any]] = defaultdict(list)
    failed: dict[str, float] = {}
    attempts: dict[str, int] = defaultdict(int)
    for log in logs:
        order_id = log["order_id"]
        attempts[order_id] = max(attempts[order_id], log["attempt_number"])
        if log["status"] == "assigned":
            assigned[order_id].append(log)
        elif log["status"] == "failed":
            failed[order_id] = log["at"]
    delivered = {e["order_id"]: e["created"] for e in events if e["new_status"] == "delivered"}
    cancelled = {
        e["order_id"]: e["created"] for e in events if e["routing_key"] == "order.cancelled"
    }
    rows: list[Outcome] = []
    for order in orders:
        order_id = order["id"]
        first = assigned[order_id][0] if assigned[order_id] else None
        rows.append(
            Outcome(
                id=order_id,
                step=step_of(order["created"], boundaries),
                created=order["created"],
                status=order["status"],
                courier_id=order["courier_id"],
                assigned=first["at"] if first else None,
                assigned_courier=first["courier_id"] if first else None,
                assignments=len(assigned[order_id]),
                attempts=attempts[order_id],
                distance_m=first["distance_m"] if first else None,
                failed=failed.get(order_id),
                delivered=delivered.get(order_id),
                ended=delivered.get(order_id, cancelled.get(order_id)),
            )
        )
    return rows


def overlapping_assignments(rows: Sequence[Outcome]) -> int:
    spans: dict[str, list[tuple[float, float | None]]] = defaultdict(list)
    for row in rows:
        if row.assigned is not None and row.assigned_courier is not None:
            spans[row.assigned_courier].append((row.assigned, row.ended))
    overlaps = 0
    for courier_spans in spans.values():
        courier_spans.sort(key=lambda span: span[0])
        for (_, previous_end), (started, _) in pairwise(courier_spans):
            if previous_end is None or previous_end > started:
                overlaps += 1
    return overlaps


def mismatched_projections(rows: Sequence[Outcome]) -> int:
    wrong = 0
    for row in rows:
        if row.assigned is not None and row.status != "cancelled":
            wrong += row.status == "pending" or row.courier_id != row.assigned_courier
        elif row.failed is not None:
            wrong += row.status != "dispatch_failed"
    return wrong


def order_counts(rows: Sequence[Outcome]) -> dict[str, Any]:
    created = len(rows)
    assigned = sum(row.assigned is not None for row in rows)
    return {
        "created": created,
        "assigned": assigned,
        "delivered": sum(row.status == "delivered" for row in rows),
        "dispatch_failed": sum(row.status == "dispatch_failed" for row in rows),
        "pending": sum(row.status == "pending" for row in rows),
        "in_progress": sum(row.status in IN_PROGRESS for row in rows),
        "assignment_rate": round(assigned / created, 4) if created else None,
        "assigned_on_first_attempt": sum(
            row.assigned is not None and row.attempts == 1 for row in rows
        ),
    }


def timings(rows: Sequence[Outcome]) -> dict[str, Any]:
    return {
        "time_to_assign_s": spread(
            [row.assigned - row.created for row in rows if row.assigned is not None]
        ),
        "pickup_distance_m": spread(
            [row.distance_m for row in rows if row.distance_m is not None], digits=0
        ),
        "order_to_delivery_s": spread(
            [row.delivered - row.created for row in rows if row.delivered is not None]
        ),
    }


def outage_windows(events: Sequence[FaultEvent]) -> list[tuple[str, float, float]]:
    began: dict[str, float] = {}
    windows: list[tuple[str, float, float]] = []
    for event in events:
        if event.action in RESTORE:
            began[event.target] = event.wall
        elif event.target in began:
            windows.append((event.target, began.pop(event.target), event.wall))
    return windows


def failed(sample: Sample) -> bool:
    return not 200 <= sample.status < 300


def request_impact(began: float, ended: float, stats: Stats) -> dict[str, Any]:
    calls = [sample for samples in stats.samples.values() for sample in samples]
    during = [sample for sample in calls if began <= sample.at <= ended]
    failures = sorted((s for s in calls if s.at >= began and failed(s)), key=lambda s: s.at)
    return {
        "requests_during": len(during),
        "requests_failed_during": sum(failed(sample) for sample in during),
        "requests_failed_in_total": len(failures),
        "failed_request_ms": spread([s.seconds for s in failures], scale=1000.0, digits=1),
        "first_failure_after_s": round(failures[0].at - began, 1) if failures else None,
        "last_failure_after_restart_s": round(failures[-1].at - ended, 1) if failures else None,
    }


def outage_report(
    window: tuple[str, float, float],
    rows: Sequence[Outcome],
    events: Sequence[Any],
    stats: Stats,
) -> dict[str, Any]:
    target, began, ended = window
    inside = [row for row in rows if began <= row.created <= ended]
    dispatched = [row.assigned - ended for row in inside if row.assigned is not None]
    published = [
        e["published"] - ended
        for e in events
        if began <= e["created"] <= ended and e["published"] is not None
    ]
    return {
        "target": target,
        "seconds": round(ended - began, 1),
        "orders_accepted": len(inside),
        "orders_never_dispatched": sum(
            row.assigned is None and row.failed is None for row in inside
        ),
        "events_published_after_s": spread(published)["max"],
        "orders_dispatched_after_s": spread(dispatched),
        **request_impact(began, ended, stats),
    }


def api_report(stats: Stats) -> dict[str, Any]:
    report: dict[str, Any] = {}
    for name, samples in sorted(stats.samples.items()):
        statuses: dict[str, int] = defaultdict(int)
        for sample in samples:
            statuses[str(sample.status)] += 1
        report[name] = {
            **spread([sample.seconds for sample in samples], scale=1000.0, digits=1),
            "errors": sum(failed(sample) for sample in samples),
            "statuses": dict(sorted(statuses.items())),
        }
    return report


async def measure(
    database: Any,
    scenario: Scenario,
    stats: Stats,
    customer_ids: list[str],
    ledger: Ledger,
    fault_events: list[FaultEvent],
    database_zero: float,
    demand_zero: float,
) -> tuple[dict[str, Any], list[Outcome]]:
    orders = await database.fetch(ORDERS, customer_ids)
    logs = await database.fetch(LOGS, [order["id"] for order in orders])
    events = await database.fetch(ORDER_EVENTS, database_zero)
    publish_lag = {
        schema: [
            row["lag"]
            for row in await database.fetch(PUBLISH_LAG.format(schema=schema), database_zero)
        ]
        for schema in ("orders", "locations", "dispatch")
    }
    unpublished = sum(
        [
            await database.fetchval(UNPUBLISHED.format(schema=schema))
            for schema in ("orders", "locations", "dispatch")
        ]
    )

    boundaries: list[float] = []
    edge = demand_zero
    for step in scenario.demand:
        edge += step.for_s
        boundaries.append(edge)
    rows = outcomes(orders, logs, events, boundaries)
    stored = {row.id for row in rows}

    invariants = {
        "orders_assigned_twice": sum(row.assignments > 1 for row in rows),
        "couriers_with_overlapping_orders": overlapping_assignments(rows),
        "orders_left_pending": sum(row.status == "pending" for row in rows),
        "accepted_orders_missing": sum(order_id not in stored for order_id in ledger.accepted),
        "orders_beyond_requests": max(0, len(rows) - len(ledger.lag)),
        "keys_with_two_orders": len(ledger.split_keys),
        "projection_mismatches": mismatched_projections(rows),
        "events_never_published": unpublished,
    }
    summary = {
        "generator": {
            "scheduled": len(ledger.lag),
            "requests_per_order": scenario.copies,
            "accepted": len(ledger.accepted),
            "schedule_lag_ms": spread(ledger.lag, scale=1000.0, digits=1),
        },
        "orders": order_counts(rows),
        **timings(rows),
        "outbox_publish_lag_s": {schema: spread(lags) for schema, lags in publish_lag.items()},
        "api_ms": api_report(stats),
        "steps": [
            {
                "orders_per_s": step.orders_per_s,
                "for_s": step.for_s,
                **order_counts([row for row in rows if row.step == index]),
                "time_to_assign_s": timings([row for row in rows if row.step == index])[
                    "time_to_assign_s"
                ],
            }
            for index, step in enumerate(scenario.demand)
        ],
        "outages": [
            outage_report(window, rows, events, stats) for window in outage_windows(fault_events)
        ],
        "invariants": invariants,
        "passed": not any(invariants.values()),
    }
    return summary, rows
