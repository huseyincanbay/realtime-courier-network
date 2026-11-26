from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Region:
    lat: float
    lng: float
    radius_m: float


@dataclass(frozen=True)
class HotZone:
    lat: float
    lng: float
    radius_m: float
    weight: float


@dataclass(frozen=True)
class Couriers:
    count: int
    speed_mps: float
    tick_s: float
    pickup_wait_s: float


@dataclass(frozen=True)
class DemandStep:
    for_s: float
    orders_per_s: float


@dataclass(frozen=True)
class Fault:
    at_s: float
    action: str
    target: str


@dataclass(frozen=True)
class Scenario:
    name: str
    seed: int
    warmup_s: float
    drain_s: float
    customers: int
    region: Region
    couriers: Couriers
    demand: tuple[DemandStep, ...]
    hot_zones: tuple[HotZone, ...]
    faults: tuple[Fault, ...]

    @property
    def duration_s(self) -> float:
        return sum(step.for_s for step in self.demand)


def load(path: Path) -> Scenario:
    raw = tomllib.loads(path.read_text())
    return Scenario(
        name=raw["name"],
        seed=raw["seed"],
        warmup_s=raw["warmup_s"],
        drain_s=raw["drain_s"],
        customers=raw["customers"],
        region=Region(**raw["region"]),
        couriers=Couriers(**raw["couriers"]),
        demand=tuple(DemandStep(**step) for step in raw["demand"]),
        hot_zones=tuple(HotZone(**zone) for zone in raw.get("hot_zones", [])),
        faults=tuple(Fault(**fault) for fault in raw.get("faults", [])),
    )
