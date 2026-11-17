#!/usr/bin/env python3
"""GDP per capita (nominal, US$) per country, for shading the map.

Source: Wikipedia "List of countries by GDP (nominal) per capita", which lists
IMF, World Bank and UN estimates. Takes the IMF figure, falling back to the
World Bank, then the UN, and records which one was used.

Downloads into data/ on first run (git-ignored) and writes
src/data/gdp-per-capita.json, keyed by the country name the map uses
(world-atlas), so places without an ISO code (Kosovo) still match.

Usage:
    python3 scripts/gdp_per_capita.py            # uses cached download
    python3 scripts/gdp_per_capita.py --refresh  # re-download

Standard library only.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "src" / "data" / "gdp-per-capita.json"
MAP = ROOT / "node_modules" / "world-atlas" / "countries-50m.json"

WIKI_URL = (
    "https://en.wikipedia.org/w/api.php?action=parse"
    "&page=List_of_countries_by_GDP_(nominal)_per_capita&prop=text&format=json&formatversion=2"
)
WIKI_CACHE = DATA / "wikipedia_gdp_per_capita.json"

# Wikipedia name -> map (world-atlas) name, where they differ.
ALIASES = {
    "United States": "United States of America",
    "Czech Republic": "Czechia",
    "Dominican Republic": "Dominican Rep.",
    "Bosnia and Herzegovina": "Bosnia and Herz.",
    "Cape Verde": "Cabo Verde",
    "Ivory Coast": "Côte d'Ivoire",
    "DR Congo": "Dem. Rep. Congo",
    "Central African Republic": "Central African Rep.",
    "Solomon Islands": "Solomon Is.",
    "Marshall Islands": "Marshall Is.",
    "Federated States of Micronesia": "Micronesia",
    "Cayman Islands": "Cayman Is.",
    "Faroe Islands": "Faeroe Is.",
    "U.S. Virgin Islands": "U.S. Virgin Is.",
    "British Virgin Islands": "British Virgin Is.",
    "Turks and Caicos Islands": "Turks and Caicos Is.",
    "Cook Islands": "Cook Is.",
    "Northern Mariana Islands": "N. Mariana Is.",
    "Sint Maarten (Dutch part)": "Sint Maarten",
    "Saint Martin (French part)": "St-Martin",
    "Macau": "Macao",
    "Antigua and Barbuda": "Antigua and Barb.",
    "French Polynesia": "Fr. Polynesia",
    "Saint Kitts and Nevis": "St. Kitts and Nevis",
    "North Macedonia": "Macedonia",
    "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
    "Equatorial Guinea": "Eq. Guinea",
    "South Sudan": "S. Sudan",
}
# Rows that aren't a shape on the map (Tuvalu is too small for the 50m map).
SKIP = {"World", "Channel Islands", "Zanzibar", "Tuvalu"}

# Column order in the table after the name.
SOURCES = ["IMF", "World Bank", "UN"]


def fetch(refresh: bool) -> Path:
    if WIKI_CACHE.exists() and not refresh:
        return WIKI_CACHE
    print(f"Downloading {WIKI_URL}", file=sys.stderr)
    req = urllib.request.Request(WIKI_URL, headers={"User-Agent": "meridian-data-script/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        WIKI_CACHE.parent.mkdir(parents=True, exist_ok=True)
        WIKI_CACHE.write_bytes(resp.read())
    return WIKI_CACHE


def cell_text(cell: str) -> str:
    cell = re.sub(r"<sup.*?</sup>", "", cell, flags=re.S)
    cell = re.sub(r"<style.*?</style>", "", cell, flags=re.S)
    cell = re.sub(r"<[^>]+>", "", cell)
    return re.sub(r"\s+", " ", html.unescape(cell)).strip()


def parse_value(text: str) -> tuple[int, int | None] | None:
    """'147,252' -> (147252, None); '288,002 (2024)' -> (288002, 2024); '—N/a' -> None."""
    m = re.match(r"([\d,]+)\s*(?:\((\d{4})\))?", text)
    if not m:
        return None
    return int(m.group(1).replace(",", "")), int(m.group(2)) if m.group(2) else None


def header_years(header: list[str]) -> list[int | None]:
    """'IMF(2026)' -> 2026, for the default year of each source column."""
    return [int(m.group(1)) if (m := re.search(r"\((\d{4})", h)) else None for h in header[1:4]]


def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true", help="re-download from Wikipedia")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    page = json.loads(fetch(args.refresh).read_text(encoding="utf-8"))["parse"]["text"]
    tables = re.findall(r"<table[^>]*>.*?</table>", page, re.S)
    table = next((t for t in tables if "IMF" in cell_text(t[:4000]) and "Country" in cell_text(t[:4000])), None)
    if table is None:
        raise SystemExit("Couldn't find the GDP table on the Wikipedia page; its layout may have changed.")

    map_names = {
        norm(g["properties"]["name"]): g["properties"]["name"]
        for g in json.loads(MAP.read_text(encoding="utf-8"))["objects"]["countries"]["geometries"]
    }

    out: dict[str, dict] = {}
    unmatched = []
    years: list[int | None] = [None, None, None]
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        cells = [cell_text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)]
        if len(cells) < 4:
            continue
        if cells[0].startswith("Country"):
            years = header_years(cells)
            continue
        name = cells[0]
        if name in SKIP:
            continue
        # First source with a figure: IMF, then World Bank, then UN.
        pick = next(
            ((src, v, yr or years[i]) for i, src in enumerate(SOURCES)
             if (parsed := parse_value(cells[i + 1])) for v, yr in [parsed]),
            None,
        )
        if not pick:
            continue
        map_name = map_names.get(norm(ALIASES.get(name, name)))
        if not map_name:
            unmatched.append(name)
            continue
        source, value, year = pick
        out[map_name] = {"usd": value, "source": source, "year": year}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "Wikipedia, List of countries by GDP (nominal) per capita (IMF, else World Bank, else UN)",
        "countries": dict(sorted(out.items())),
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} countries to {args.out.relative_to(ROOT)}", file=sys.stderr)
    if unmatched:
        print(f"Not on the map / no match for {len(unmatched)}: {', '.join(unmatched)}", file=sys.stderr)
        print("Add them to ALIASES (or SKIP).", file=sys.stderr)


if __name__ == "__main__":
    main()
