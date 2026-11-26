from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import Enum

from .api import Account, Api
from .scenario import Couriers
from .world import Arrival, Clock, Point, step_towards


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


async def place_orders(
    api: Api,
    customers: list[Account],
    schedule: list[Arrival],
    clock: Clock,
    offset_s: float,
    lag: list[float],
    accepted: list[str],
) -> None:
    async def place(arrival: Arrival) -> None:
        token = customers[arrival.customer].token
        order_id = await api.create_order(token, arrival.pickup, arrival.dropoff)
        if order_id is not None:
            accepted.append(order_id)

    async with asyncio.TaskGroup() as group:
        for arrival in schedule:
            due = offset_s + arrival.at_s
            await clock.sleep_until(due)
            lag.append(clock.now() - due)
            group.create_task(place(arrival))


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
        if 400 <= code < 500:
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
