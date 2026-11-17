#!/usr/bin/env python3
"""Services trade per country: services share of exports and top services category.

Source: World Bank World Development Indicators API (balance-of-payments data,
originally from the IMF). Downloads into data/ on first run (git-ignored) and
writes src/data/services.json, keyed by the ISO numeric code the map uses.

Usage:
    python3 scripts/services.py            # uses cached downloads in data/
    python3 scripts/services.py --refresh  # re-download

Needs a BACI country_codes_*.csv in data/ (same as top_trade.py) to map ISO3
codes to the map's numeric ids. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

from top_trade import BACI_TO_ISO, latest, load_countries

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "src" / "data" / "services.json"
YEARS = "2015:2025"
MIN_YEAR = 2019  # skip countries whose latest figures are older than this

TOTAL_SERVICES = "BX.GSR.NFSV.CD"  # Service exports (BoP, current US$)
TOTAL_EXPORTS = "BX.GSR.GNFS.CD"  # Exports of goods and services (BoP, current US$)

# Categories the World Bank publishes, either in US$ or as % of service exports.
# Whatever they don't cover (consulting, R&D, engineering, construction,
# audiovisual and other cultural services, government services…) is the remainder.
CATEGORIES = {
    "Tourism": ("BX.GSR.TRVL.ZS", "pct"),
    "Transport": ("BX.GSR.TRAN.ZS", "pct"),
    "Insurance & finance": ("BX.GSR.INSF.ZS", "pct"),
    "Computer & telecom services": ("BX.GSR.CCIS.CD", "usd"),
    "IP licensing (software, media, patents)": ("BX.GSR.ROYL.CD", "usd"),
}
REMAINDER = "Business & other"


def fetch_indicator(code: str, refresh: bool) -> dict[str, dict[int, float]]:
    """{iso3: {year: value}} for one indicator, all countries."""
    cache = DATA / f"wdi_{code}.json"
    if refresh or not cache.exists():
        url = (
            f"https://api.worldbank.org/v2/country/all/indicator/{code}"
            f"?format=json&date={YEARS}&per_page=20000"
        )
        print(f"Downloading {code}", file=sys.stderr)
        req = urllib.request.Request(url, headers={"User-Agent": "meridian-data-script/0.1"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(resp.read())
    meta, rows = json.loads(cache.read_text(encoding="utf-8"))
    out: dict[str, dict[int, float]] = {}
    for r in rows or []:
        if r["value"] is not None and r["countryiso3code"]:
            out.setdefault(r["countryiso3code"], {})[int(r["date"])] = float(r["value"])
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true", help="re-download from the World Bank")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    services = fetch_indicator(TOTAL_SERVICES, args.refresh)
    exports = fetch_indicator(TOTAL_EXPORTS, args.refresh)
    cats = {name: (fetch_indicator(code, args.refresh), kind) for name, (code, kind) in CATEGORIES.items()}

    # ISO3 -> map id, via BACI's country list (regional aggregates like "WLD"
    # aren't in it, so they drop out here).
    iso3_to_id = {
        c["iso3"]: f"{BACI_TO_ISO.get(code, code):03d}"
        for code, c in load_countries(latest("country_codes_*.csv")).items()
        if c["iso3"] and "..." not in c["name"]
    }

    out: dict[str, dict] = {}
    for iso3, by_year in services.items():
        map_id = iso3_to_id.get(iso3)
        if not map_id:
            continue
        # Latest year with both totals, so share and categories are from one year.
        years = [
            y for y in by_year
            if y >= MIN_YEAR and y in exports.get(iso3, {}) and exports[iso3][y] > 0
        ]
        if not years:
            continue
        year = max(years)
        total = by_year[year]
        if total <= 0:
            continue

        values: dict[str, float] = {}
        for name, (series, kind) in cats.items():
            v = series.get(iso3, {}).get(year)
            if v is not None:
                values[name] = v / 100 * total if kind == "pct" else v
        # Name a top category when it's knowable: either most of the breakdown is
        # reported (so the remainder really is "business & other"), or one known
        # category is bigger than everything unaccounted for (Maldives: tourism).
        top = None
        remainder = max(total - sum(values.values()), 0)
        if values:
            best = max(values.items(), key=lambda kv: kv[1])
            if len(values) >= 4:
                values[REMAINDER] = remainder
                best = max(values.items(), key=lambda kv: kv[1])
                top = best
            elif best[1] >= remainder:
                top = best
        if top:
            label, value = top
            top = {"label": label, "valueUsd": round(value), "share": round(min(value / total, 1), 4)}

        out[map_id] = {
            "iso3": iso3,
            "year": year,
            "servicesExportsUsd": round(total),
            "servicesShare": round(min(total / exports[iso3][year], 1), 4),
            "topService": top,
        }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "World Bank WDI (IMF balance of payments)",
        "countries": dict(sorted(out.items())),
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with_top = sum(1 for v in out.values() if v["topService"])
    print(f"Wrote {len(out)} countries ({with_top} with a top category) to {args.out.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
