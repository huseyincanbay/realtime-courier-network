from __future__ import annotations

import json
import socket
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .scenario import Fault
from .world import Clock

RESTORE = {"stop": "start", "kill": "start", "pause": "unpause"}


@dataclass(frozen=True)
class FaultEvent:
    at_s: float
    wall: float
    action: str
    target: str


class Docker:
    def __init__(self, socket_path: str) -> None:
        self._http = httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(uds=socket_path),
            base_url="http://docker",
            timeout=httpx.Timeout(60.0),
        )
        self._project: str | None = None

    async def close(self) -> None:
        await self._http.aclose()

    async def act(self, action: str, target: str) -> None:
        response = await self._http.post(f"/containers/rcn-{target}/{action}")
        response.raise_for_status()

    async def replicas(self, service: str) -> int:
        if self._project is None:
            me = (await self._http.get(f"/containers/{socket.gethostname()}/json")).json()
            self._project = me["Config"]["Labels"]["com.docker.compose.project"]
        labels = [
            f"com.docker.compose.project={self._project}",
            f"com.docker.compose.service={service}",
        ]
        response = await self._http.get(
            "/containers/json",
            params={"filters": json.dumps({"label": labels, "status": ["running"]})},
        )
        response.raise_for_status()
        return len(response.json())

    async def host(self) -> dict[str, Any]:
        info = (await self._http.get("/info")).json()
        return {
            "cpus": info["NCPU"],
            "memory_gb": round(info["MemTotal"] / 2**30, 1),
            "architecture": info["Architecture"],
            "os": info["OperatingSystem"],
            "docker": info["ServerVersion"],
        }


async def inject(
    docker: Docker,
    faults: tuple[Fault, ...],
    clock: Clock,
    offset_s: float,
    events: list[FaultEvent],
) -> None:
    broken: dict[str, str] = {}
    try:
        for fault in sorted(faults, key=lambda item: item.at_s):
            await clock.sleep_until(offset_s + fault.at_s)
            events.append(FaultEvent(fault.at_s, time.time(), fault.action, fault.target))
            await docker.act(fault.action, fault.target)
            if fault.action in RESTORE:
                broken[fault.target] = RESTORE[fault.action]
            else:
                broken.pop(fault.target, None)
    finally:
        for target, action in broken.items():
            await docker.act(action, target)
