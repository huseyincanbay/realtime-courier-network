from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .world import Point


@dataclass(frozen=True)
class Account:
    id: str
    token: str


@dataclass(frozen=True)
class Sample:
    at: float
    seconds: float
    status: int


@dataclass
class Stats:
    samples: dict[str, list[Sample]] = field(default_factory=dict)

    def record(self, name: str, at: float, seconds: float, status: int) -> None:
        self.samples.setdefault(name, []).append(Sample(at, seconds, status))


class Api:
    def __init__(self, base_url: str, stats: Stats) -> None:
        self._stats = stats
        self._http = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(5.0),
            limits=httpx.Limits(max_connections=400, max_keepalive_connections=400),
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def _call(
        self,
        name: str,
        method: str,
        path: str,
        token: str | None = None,
        body: dict[str, Any] | None = None,
        key: str | None = None,
    ) -> httpx.Response | None:
        headers: dict[str, str] = {}
        if token:
            headers["authorization"] = f"Bearer {token}"
        if key:
            headers["idempotency-key"] = key
        at = time.time()
        started = time.monotonic()
        try:
            response = await self._http.request(method, path, json=body, headers=headers)
        except httpx.HTTPError:
            self._stats.record(name, at, time.monotonic() - started, 0)
            return None
        self._stats.record(name, at, time.monotonic() - started, response.status_code)
        return response

    async def register(self, email: str, password: str, role: str) -> Account | None:
        body = {"email": email, "password": password, "role": role}
        response = await self._call("register", "POST", "/auth/register", body=body)
        if response is None or response.status_code != 201:
            return None
        data = response.json()
        return Account(id=data["user"]["id"], token=data["accessToken"])

    async def create_order(
        self, token: str, pickup: Point, dropoff: Point, key: str | None = None
    ) -> str | None:
        body = {
            "pickupLat": pickup.lat,
            "pickupLng": pickup.lng,
            "dropoffLat": dropoff.lat,
            "dropoffLng": dropoff.lng,
        }
        response = await self._call("create_order", "POST", "/orders", token, body, key)
        if response is None or response.status_code != 201:
            return None
        order_id: str = response.json()["id"]
        return order_id

    async def my_orders(self, token: str) -> list[dict[str, Any]]:
        response = await self._call("list_orders", "GET", "/orders", token)
        if response is None or response.status_code != 200:
            return []
        orders: list[dict[str, Any]] = response.json()
        return orders

    async def set_status(self, token: str, order_id: str, status: str) -> int:
        body = {"status": status}
        response = await self._call(
            "set_status", "PATCH", f"/orders/{order_id}/status", token, body
        )
        return 0 if response is None else response.status_code

    async def report_location(self, token: str, point: Point) -> bool:
        body = {"latitude": point.lat, "longitude": point.lng}
        response = await self._call("report_location", "POST", "/location/update", token, body)
        return response is not None and response.status_code == 200

    async def couriers_near(self, token: str, point: Point, radius_m: int) -> int | None:
        path = f"/location/nearby?lat={point.lat}&lng={point.lng}&radiusM={radius_m}&limit=50"
        response = await self._call("nearby", "GET", path, token)
        if response is None or response.status_code != 200:
            return None
        return len(response.json())
