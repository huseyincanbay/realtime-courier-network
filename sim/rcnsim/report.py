from __future__ import annotations

import csv
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .measure import Outcome

COLUMNS = (
    "order_id",
    "step",
    "created_s",
    "status",
    "courier_id",
    "attempts",
    "time_to_assign_s",
    "pickup_distance_m",
    "order_to_delivery_s",
)

ROW = (
    "| {name} | {created} | {rate}% | {p50} / {p95} | {api} | {outbox} "
    "| {twice} | {broken} |"
)


def since(later: float | None, earlier: float) -> float | None:
    return None if later is None else round(later - earlier, 3)


def write(folder: Path, summary: dict[str, Any], rows: Sequence[Outcome], zero: float) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    with (folder / "orders.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow(
                (
                    row.id,
                    row.step,
                    round(row.created - zero, 3),
                    row.status,
                    row.courier_id,
                    row.attempts,
                    since(row.assigned, row.created),
                    row.distance_m,
                    since(row.delivered, row.created),
                )
            )


def shown(value: Any, unit: str = "") -> str:
    return "–" if value is None else f"{value}{unit}"


def seconds(value: float | None) -> str:
    return "–" if value is None else f"{value:.3f} s"


def table(folder: Path) -> str:
    header = (
        "| Scenario | Orders | Assigned | Time to assign p50 / p95 | Order API p95 "
        "| Outbox lag p95 | Duplicate publishes | Invariant violations |"
    )
    lines = [header, "|---|---|---|---|---|---|---|---|"]
    for path in sorted(folder.glob("*/summary.json")):
        summary = json.loads(path.read_text())
        orders = summary["orders"]
        assign = summary["time_to_assign_s"]
        lines.append(
            ROW.format(
                name=summary["scenario"]["name"],
                created=orders["created"],
                rate=round(100 * orders["assignment_rate"], 1),
                p50=seconds(assign["p50"]),
                p95=seconds(assign["p95"]),
                api=shown(summary["api_ms"]["create_order"]["p95"], " ms"),
                outbox=seconds(summary["outbox_publish_lag_s"]["orders"]["p95"]),
                twice=sum(summary["duplicate_publishes"].values()),
                broken=sum(summary["invariants"].values()),
            )
        )
    return "\n".join(lines)


def headline(summary: dict[str, Any]) -> str:
    orders = summary["orders"]
    assign = summary["time_to_assign_s"]
    counts = (
        f"orders created {orders['created']}, assigned {orders['assigned']}, "
        f"delivered {orders['delivered']}, failed {orders['dispatch_failed']}, "
        f"pending {orders['pending']}, in progress {orders['in_progress']}"
    )
    lines = [
        counts,
        f"time to assign p50 {seconds(assign['p50'])}, p95 {seconds(assign['p95'])}",
        f"generator lag p95 {shown(summary['generator']['schedule_lag_ms']['p95'], ' ms')}",
        "published more than once: "
        + ", ".join(f"{name} {count}" for name, count in summary["duplicate_publishes"].items()),
    ]
    for name, count in summary["invariants"].items():
        lines.append(f"{'ok  ' if count == 0 else 'FAIL'} {name}: {count}")
    lines.append("PASSED" if summary["passed"] else "FAILED")
    return "\n".join(lines)
