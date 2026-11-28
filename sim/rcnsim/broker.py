from __future__ import annotations

import httpx

TAP = "sim_tap"
EXCHANGES = ("order_events", "location_events")


class Broker:
    def __init__(self, url: str, user: str, password: str) -> None:
        self._http = httpx.AsyncClient(
            base_url=url, auth=(user, password), timeout=httpx.Timeout(30.0)
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def tap(self) -> None:
        await self.untap()
        created = await self._http.put(f"/api/queues/%2F/{TAP}", json={"durable": True})
        created.raise_for_status()
        for exchange in EXCHANGES:
            bound = await self._http.post(
                f"/api/bindings/%2F/e/{exchange}/q/{TAP}", json={"routing_key": "#"}
            )
            bound.raise_for_status()

    async def untap(self) -> None:
        try:
            await self._http.delete(f"/api/queues/%2F/{TAP}")
        except httpx.HTTPError:
            pass

    async def drain(self) -> dict[str, int]:
        seen = dict.fromkeys(EXCHANGES, 0)
        while True:
            response = await self._http.post(
                f"/api/queues/%2F/{TAP}/get",
                json={
                    "count": 2000,
                    "ackmode": "ack_requeue_false",
                    "encoding": "auto",
                    "truncate": 1,
                },
            )
            response.raise_for_status()
            batch = response.json()
            if not batch:
                return seen
            for message in batch:
                seen[message["exchange"]] += 1
