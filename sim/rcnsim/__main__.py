from __future__ import annotations

import asyncio
import os
import random
import secrets
import sys
import time
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import asyncpg
import httpx

from .agents import Ledger, drive, place_orders
from .api import Account, Api, Stats
from .faults import Docker, FaultEvent, inject
from .measure import measure
from .report import headline, table, write
from .scenario import Scenario, load
from .world import Clock, Point, arrivals, courier_starts

SERVICES = {
    "gateway": 4000,
    "auth": 3001,
    "orders": 3002,
    "location": 3003,
    "realtime": 3004,
    "dispatch": 3005,
}
DISPATCH_REACH_M = 15000
SETTLE_S = 4.0
RESULTS = Path(os.environ.get("RESULTS_DIR", "/results"))


async def wait_until_ready(seconds: float) -> None:
    deadline = time.monotonic() + seconds
    async with httpx.AsyncClient(timeout=httpx.Timeout(2.0)) as http:
        while True:
            try:
                answers = await asyncio.gather(
                    *(
                        http.get(f"http://{name}:{port}/api/v1/health/readiness")
                        for name, port in SERVICES.items()
                    )
                )
                if all(a.status_code == 200 and a.json()["status"] == "ok" for a in answers):
                    return
            except httpx.HTTPError:
                pass
            if time.monotonic() > deadline:
                raise SystemExit("services did not become ready")
            await asyncio.sleep(1.0)


async def enroll(api: Api, run_id: str, role: str, count: int, password: str) -> list[Account]:
    accounts = await asyncio.gather(
        *(api.register(f"sim-{run_id}-{role}-{n}@rcn.dev", password, role) for n in range(count))
    )
    if any(account is None for account in accounts):
        raise SystemExit(f"could not register every {role}")
    return [account for account in accounts if account is not None]


async def run(scenario: Scenario) -> int:
    rng = random.Random(scenario.seed)
    schedule = arrivals(scenario, rng)
    starts = courier_starts(scenario, rng)
    await wait_until_ready(90.0)

    stats = Stats()
    api = Api(os.environ["GATEWAY_URL"], stats)
    docker = Docker(os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock"))
    database = await asyncpg.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ["DB_PORT"]),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"],
    )
    try:
        run_id = secrets.token_hex(4)
        password = secrets.token_urlsafe(18)
        customers = await enroll(api, run_id, "customer", scenario.customers, password)
        couriers = await enroll(api, run_id, "courier", scenario.couriers.count, password)

        centre = Point(scenario.region.lat, scenario.region.lng)
        present = await api.couriers_near(customers[0].token, centre, DISPATCH_REACH_M)
        if present:
            raise SystemExit(f"{present} couriers are already online around this region")

        started_at = datetime.now(UTC).isoformat(timespec="seconds")
        database_zero = await database.fetchval("SELECT extract(epoch FROM now())::float8")
        clock = Clock()
        ledger = Ledger()
        fault_events: list[FaultEvent] = []
        offset = scenario.warmup_s
        end = offset + scenario.duration_s + scenario.drain_s
        spacing = scenario.couriers.tick_s / scenario.couriers.count

        async with asyncio.TaskGroup() as group:
            for index, (account, start) in enumerate(zip(couriers, starts)):
                group.create_task(
                    drive(api, account, start, scenario.couriers, clock, index * spacing, end)
                )
            group.create_task(
                place_orders(
                    api, customers, schedule, clock, offset, scenario.copies, run_id, ledger
                )
            )
            group.create_task(inject(docker, scenario.faults, clock, offset, fault_events))
        await asyncio.sleep(SETTLE_S)

        demand_zero = clock.wall_zero + offset
        summary, rows = await measure(
            database,
            scenario,
            stats,
            [account.id for account in customers],
            ledger,
            fault_events,
            database_zero,
            demand_zero,
        )
        summary = {
            "scenario": asdict(scenario),
            "run": {
                "started_at": started_at,
                "commit": os.environ.get("GIT_COMMIT", "unknown"),
                "host": await docker.host(),
            },
            **summary,
        }
    finally:
        await database.close()
        await docker.close()
        await api.close()

    write(RESULTS / scenario.name, summary, rows, demand_zero)
    print(headline(summary))
    return 0 if summary["passed"] else 1


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python -m rcnsim <scenario.toml | table>")
        return 2
    if sys.argv[1] == "table":
        print(table(RESULTS))
        return 0
    return asyncio.run(run(load(Path(sys.argv[1]))))


if __name__ == "__main__":
    sys.exit(main())
