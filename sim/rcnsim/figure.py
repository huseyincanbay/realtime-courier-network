from __future__ import annotations

import json
import math
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any

EARLIER = (("first run", 30.4), ("fix 1 · every courier in range", 0.975))
LATEST = "fix 2 · publisher woken on commit"

WIDTH = 840
HEIGHT = 232
TILE = 198
GAP = 16
PLOT_LEFT = 40.0
PER_DECADE = 190.0
LOWEST = -2.3
TICKS = ((0.01, "10 ms"), (0.1, "100 ms"), (1.0, "1 s"), (10.0, "10 s"))
FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif"


@dataclass(frozen=True)
class Theme:
    name: str
    surface: str
    primary: str
    secondary: str
    muted: str
    grid: str
    axis: str
    accent: str


THEMES = (
    Theme("light", "#ffffff", "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7", "#2a78d6"),
    Theme("dark", "#0d1117", "#f0efec", "#c3c2b7", "#898781", "#2c2c2a", "#383835", "#3987e5"),
)


def duration(seconds: float) -> str:
    return f"{seconds * 1000:.0f} ms" if seconds < 1 else f"{seconds:.1f} s"


def position(seconds: float) -> float:
    return round(PLOT_LEFT + (math.log10(seconds) - LOWEST) * PER_DECADE, 1)


def facts(folder: Path) -> dict[str, Any]:
    runs = [json.loads(path.read_text()) for path in sorted(folder.glob("*/summary.json"))]
    named = {run["scenario"]["name"]: run for run in runs}
    baseline = named["baseline"]
    outages = [outage for run in runs for outage in run["outages"]]
    return {
        "orders": sum(run["orders"]["created"] for run in runs),
        "scenarios": len(runs),
        "twice": sum(
            run["invariants"]["orders_assigned_twice"]
            + run["invariants"]["couriers_with_overlapping_orders"]
            for run in runs
        ),
        "lost": sum(
            run["invariants"]["accepted_orders_missing"]
            + run["invariants"]["orders_left_pending"]
            for run in runs
        ),
        "copies": max(max(run["scenario"]["replicas"].values(), default=1) for run in runs),
        "stopped": len({outage["target"] for outage in outages}),
        "p95": baseline["time_to_assign_s"]["p95"],
        "rate": baseline["scenario"]["demand"][0]["orders_per_s"],
        "couriers": baseline["scenario"]["couriers"]["count"],
    }


def tile(theme: Theme, index: int, label: str, value: str, note: str) -> str:
    left = index * (TILE + GAP)
    return (
        f'<rect x="{left + 0.5}" y="0.5" width="{TILE - 1}" height="103" rx="8" fill="none" '
        f'stroke="{theme.primary}" stroke-opacity="0.12"/>'
        f'<text x="{left + 16}" y="27" font-size="12" fill="{theme.secondary}">{label}</text>'
        f'<text x="{left + 16}" y="65" font-size="30" font-weight="600" '
        f'fill="{theme.primary}">{value}</text>'
        f'<text x="{left + 16}" y="88" font-size="11.5" fill="{theme.secondary}">{note}</text>'
    )


def track(theme: Theme, latest: float) -> str:
    points = [*EARLIER, (LATEST, latest)]
    places = [position(seconds) for _, seconds in points]
    parts = [
        f'<text x="0" y="134" font-size="12" fill="{theme.secondary}">'
        "p95 time to assign in the baseline scenario, log scale</text>"
    ]
    for seconds, name in TICKS:
        at = position(seconds)
        parts.append(
            f'<line x1="{at}" y1="178" x2="{at}" y2="204" stroke="{theme.grid}" stroke-width="1"/>'
            f'<text x="{at}" y="222" font-size="11" text-anchor="middle" '
            f'fill="{theme.muted}">{name}</text>'
        )
    parts.append(
        f'<line x1="0" y1="204.5" x2="{WIDTH}" y2="204.5" stroke="{theme.axis}" stroke-width="1"/>'
        f'<line x1="{min(places)}" y1="188" x2="{max(places)}" y2="188" stroke="{theme.axis}" '
        'stroke-width="2" stroke-linecap="round"/>'
    )
    for older, newer in pairwise(places):
        middle = round((older + newer) / 2, 1)
        parts.append(
            f'<path d="M{middle + 4} 183.5L{middle - 1} 188L{middle + 4} 192.5" fill="none" '
            f'stroke="{theme.muted}" stroke-width="1.5" stroke-linecap="round" '
            'stroke-linejoin="round"/>'
        )
    for (name, seconds), at in zip(points, places, strict=True):
        fill = theme.accent if name == LATEST else theme.muted
        parts.append(
            f'<circle cx="{at}" cy="188" r="6" fill="{fill}" stroke="{theme.surface}" '
            'stroke-width="2"/>'
            f'<text x="{at}" y="172" font-size="13" font-weight="600" text-anchor="middle" '
            f'fill="{theme.primary}">{duration(seconds)}</text>'
            f'<text x="{at}" y="155" font-size="11.5" text-anchor="middle" '
            f'fill="{theme.secondary}">{name}</text>'
        )
    return "".join(parts)


def render(theme: Theme, found: dict[str, Any]) -> str:
    said = (
        f"{found['orders']} simulated orders in {found['scenarios']} scenarios, "
        f"{found['twice']} assigned to two couriers, {found['lost']} lost, "
        f"p95 time to assign {duration(found['p95'])}"
    )
    tiles = (
        tile(
            theme,
            0,
            "Orders simulated",
            str(found["orders"]),
            f"in {found['scenarios']} load and failure scenarios",
        ),
        tile(
            theme,
            1,
            "Assigned to two couriers",
            str(found["twice"]),
            f"{found['copies']} worker copies competing",
        ),
        tile(
            theme,
            2,
            "Lost in an outage",
            str(found["lost"]),
            f"{found['stopped']} services stopped under load",
        ),
        tile(
            theme,
            3,
            "p95 time to assign",
            duration(found["p95"]),
            f"{found['rate']} orders/s, {found['couriers']} couriers",
        ),
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="{said}" font-family="{FONT}">'
        f"<title>{said}</title>{''.join(tiles)}{track(theme, found['p95'])}</svg>\n"
    )


def draw(folder: Path) -> list[Path]:
    found = facts(folder)
    written = []
    for theme in THEMES:
        path = folder / f"overview-{theme.name}.svg"
        path.write_text(render(theme, found), encoding="utf-8")
        written.append(path)
    return written
