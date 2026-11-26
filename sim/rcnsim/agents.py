from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum

from .api import Account, Api
from .scenario import Couriers
from .world import Arrival, Clock, Point, step_towards

RETRY_GAP_S = 0.3
GIVE_UP = {400, 403, 404}


class Phase(Enum):
    IDLE = "idle"
    TO_PICKUP = "to_pickup"
    WAITING = "waiting"
    LOADED = "loaded"
    TO_DROPOFF = "to_dropoff"


@dataclass(frozen=True)
class Job:
    order_id: str
    pickup: Point
    dropoff: Point


@dataclass
class Ledger:
    lag: list[float] = field(default_factory=list)
    accepted: list[str] = field(default_factory=list)
    split_keys: list[str] = field(default_factory=list)


async def place_orders(
    api: Api,
    customers: list[Account],
    schedule: list[Arrival],
    clock: Clock,
    offset_s: float,
    copies: int,
    run_id: str,
    ledger: Ledger,
) -> None:
    delays = [0.0, 0.0, *([RETRY_GAP_S] * copies)][:copies]

    async def send(arrival: Arrival, key: str | None, delay: float) -> str | None:
        await asyncio.sleep(delay)
        token = customers[arrival.customer].token
        return await api.create_order(token, arrival.pickup, arrival.dropoff, key)

    async def place(index: int, arrival: Arrival) -> None:
        key = f"{run_id}-{index}" if copies > 1 else None
        answers = await asyncio.gather(*(send(arrival, key, delay) for delay in delays))
        order_ids = {answer for answer in answers if answer is not None}
        if order_ids:
            ledger.accepted.append(min(order_ids))
        if key is not None and len(order_ids) > 1:
            ledger.split_keys.append(key)

    async with asyncio.TaskGroup() as group:
        for index, arrival in enumerate(schedule):
            due = offset_s + arrival.at_s
            await clock.sleep_until(due)
            ledger.lag.append(clock.now() - due)
            group.create_task(place(index, arrival))


async def find_job(api: Api, account: Account) -> Job | None:
    for order in await api.my_orders(account.token):
        if order["status"] == "assigned":
            return Job(
                order_id=order["id"],
                pickup=Point(order["pickupLat"], order["pickupLng"]),
                dropoff=Point(order["dropoffLat"], order["dropoffLng"]),
            )
    return None


async def drive(
    api: Api,
    account: Account,
    start: Point,
    config: Couriers,
    clock: Clock,
    first_tick_s: float,
    until_s: float,
) -> None:
    position = start
    phase = Phase.IDLE
    job: Job | None = None
    ready_at = 0.0
    reach_m = config.speed_mps * config.tick_s
    tick_at = first_tick_s

    async def advance(status: str, then: Phase) -> Phase:
        assert job is not None
        code = await api.set_status(account.token, job.order_id, status)
        if code == 200:
            return then
        if code in GIVE_UP:
            return Phase.IDLE
        return phase

    while tick_at < until_s:
        await clock.sleep_until(tick_at)
        await api.report_location(account.token, position)
        if phase is Phase.IDLE:
            job = await find_job(api, account)
            if job is not None:
                phase = Phase.TO_PICKUP
        elif job is not None and phase is Phase.TO_PICKUP:
            position = step_towards(position, job.pickup, reach_m)
            if position == job.pickup:
                phase = Phase.WAITING
                ready_at = clock.now() + config.pickup_wait_s
        elif job is not None and phase is Phase.WAITING and clock.now() >= ready_at:
            phase = await advance("picked_up", Phase.LOADED)
        elif job is not None and phase is Phase.TO_DROPOFF:
            position = step_towards(position, job.dropoff, reach_m)
            if position == job.dropoff:
                phase = await advance("delivered", Phase.IDLE)
        if job is not None and phase is Phase.LOADED:
            phase = await advance("in_transit", Phase.TO_DROPOFF)
        tick_at += config.tick_s
