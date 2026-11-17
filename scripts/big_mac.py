#!/usr/bin/env python3
"""Big Mac Index: latest Big Mac price (in US$) per country, for map shading.

Source: The Economist's big-mac-data repository (the original data behind the
Kaggle "Big Mac Index data" dataset, and more up to date). Takes each
country's latest data point. Eurozone members share The Economist's single
"Euro area" figure, a weighted average of member-country prices.

Downloads into data/ on first run (git-ignored) and writes src/data/big-mac.json,
keyed by the ISO numeric code the map uses.

Usage:
    python3 scripts/big_mac.py                       # cached Economist data
    python3 scripts/big_mac.py --refresh             # re-download
    python3 scripts/big_mac.py --csv path/to/kaggle.csv   # use a Kaggle download instead

Needs a BACI country_codes_*.csv in data/ (same as top_trade.py) to map ISO3
codes to the map's ids. Standard library only.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.request
from pathlib import Path

from top_trade import BACI_TO_ISO, latest, load_countries

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "src" / "data" / "big-mac.json"
URL = "https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv"
CACHE = DATA / "big-mac-full-index.csv"

# Euro members as of 2026 (Bulgaria joined on 1 January 2026).
EURO_AREA = [
    "AUT", "BEL", "BGR", "HRV", "CYP", "EST", "FIN", "FRA", "DEU", "GRC", "IRL",
    "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "PRT", "SVK", "SVN", "ESP",
]
# ISO3 codes BACI's country list lacks or spells differently.
EXTRA_ISO3 = {"TWN": 158}


def fetch(refresh: bool) -> Path:
    if CACHE.exists() and not refresh:
        return CACHE
    print(f"Downloading {URL}", file=sys.stderr)
    req = urllib.request.Request(URL, headers={"User-Agent": "meridian-data-script/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(resp.read())
    return CACHE


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true", help="re-download The Economist's data")
    p.add_argument("--csv", type=Path, help="read this CSV instead (e.g. the Kaggle download)")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    path = args.csv or fetch(args.refresh)
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    # Latest data point per country (dates are ISO, so string order works).
    newest: dict[str, dict] = {}
    for r in rows:
        if r.get("dollar_price") and (r["iso_a3"] not in newest or r["date"] > newest[r["iso_a3"]]["date"]):
            newest[r["iso_a3"]] = r

    iso3_to_id = {
        c["iso3"]: BACI_TO_ISO.get(code, code)
        for code, c in load_countries(latest("country_codes_*.csv")).items()
        if c["iso3"] and "..." not in c["name"]
    } | EXTRA_ISO3

    def entry(r: dict, note: str | None = None) -> dict:
        # Over/under-valuation against the dollar, as The Economist computes it.
        raw = r.get("USD_raw") or r.get("USD")
        return {
            "name": r["name"],
            "date": r["date"],
            "dollarPrice": round(float(r["dollar_price"]), 2),
            "vsUsd": round(float(raw), 4) if raw not in (None, "") else None,
            "note": note,
        }

    out: dict[str, dict] = {}
    unmatched = []
    for iso3, r in newest.items():
        if iso3 == "EUZ":
            continue
        code = iso3_to_id.get(iso3)
        if code is None:
            unmatched.append(f'{r["name"]} ({iso3})')
            continue
        out[f"{code:03d}"] = entry(r)

    if "EUZ" in newest:
        for iso3 in EURO_AREA:
            code = iso3_to_id.get(iso3)
            if code is not None and f"{code:03d}" not in out:
                out[f"{code:03d}"] = entry(newest["EUZ"], note="Euro area average")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"source": "The Economist, Big Mac Index", "countries": dict(sorted(out.items()))}
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} countries to {args.out.relative_to(ROOT)}", file=sys.stderr)
    if unmatched:
        print(f"No map id for: {', '.join(unmatched)}", file=sys.stderr)


if __name__ == "__main__":
    main()
