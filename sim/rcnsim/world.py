from __future__ import annotations

import asyncio
import math
import random
import time
from dataclasses import dataclass

from .scenario import Scenario

METERS_PER_DEGREE = 111_320.0


@dataclass(frozen=True)
class Point:
    lat: float
    lng: float


@dataclass(frozen=True)
class Arrival:
    at_s: float
    customer: int
    pickup: Point
    dropoff: Point


class Clock:
    def __init__(self) -> None:
        self._zero = time.monotonic()
        self.wall_zero = time.time()

    def now(self) -> float:
        return time.monotonic() - self._zero

    async def sleep_until(self, at_s: float) -> None:
        delay = at_s - self.now()
        if delay > 0:
            await asyncio.sleep(delay)


def distance_m(a: Point, b: Point) -> float:
    north = (b.lat - a.lat) * METERS_PER_DEGREE
    east = (b.lng - a.lng) * METERS_PER_DEGREE * math.cos(math.radians(a.lat))
    return math.hypot(north, east)


def step_towards(origin: Point, target: Point, reach_m: float) -> Point:
    remaining = distance_m(origin, target)
    if remaining <= reach_m:
        return target
    share = reach_m / remaining
    return Point(
        origin.lat + (target.lat - origin.lat) * share,
        origin.lng + (target.lng - origin.lng) * share,
    )


def point_in_disc(rng: random.Random, lat: float, lng: float, radius_m: float) -> Point:
    reach = radius_m * math.sqrt(rng.random())
    bearing = rng.uniform(0.0, 2.0 * math.pi)
    return Point(
        lat + reach * math.cos(bearing) / METERS_PER_DEGREE,
        lng + reach * math.sin(bearing) / (METERS_PER_DEGREE * math.cos(math.radians(lat))),
    )


def point_in_region(rng: random.Random, scenario: Scenario) -> Point:
    region = scenario.region
    return point_in_disc(rng, region.lat, region.lng, region.radius_m)


def pickup_point(rng: random.Random, scenario: Scenario) -> Point:
    draw = rng.random()
    for zone in scenario.hot_zones:
        if draw < zone.weight:
            return point_in_disc(rng, zone.lat, zone.lng, zone.radius_m)
        draw -= zone.weight
    return point_in_region(rng, scenario)


def arrivals(scenario: Scenario, rng: random.Random) -> list[Arrival]:
    schedule: list[Arrival] = []
    step_start = 0.0
    for step in scenario.demand:
        at = step_start + rng.expovariate(step.orders_per_s)
        while at < step_start + step.for_s:
            schedule.append(
                Arrival(
                    at_s=at,
                    customer=rng.randrange(scenario.customers),
                    pickup=pickup_point(rng, scenario),
                    dropoff=point_in_region(rng, scenario),
                )
            )
            at += rng.expovariate(step.orders_per_s)
        step_start += step.for_s
    return schedule


def courier_starts(scenario: Scenario, rng: random.Random) -> list[Point]:
    return [point_in_region(rng, scenario) for _ in range(scenario.couriers.count)]
