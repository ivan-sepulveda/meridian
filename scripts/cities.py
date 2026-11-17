#!/usr/bin/env python3
"""Build the list of the world's largest cities, with coordinates.

Sources (downloaded into data/ on first run, which is git-ignored):
  - Wikipedia "List of largest cities": names, countries, UN 2025 population
  - ivan-sepulveda/when-where tourist_cities_enhanced.json: latitude/longitude

Writes src/data/cities.json for the app.

Usage:
    python3 scripts/cities.py            # uses cached downloads in data/
    python3 scripts/cities.py --refresh  # re-download both sources

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
OUT = ROOT / "src" / "data" / "cities.json"

WIKI_URL = (
    "https://en.wikipedia.org/w/api.php?action=parse&page=List_of_largest_cities"
    "&prop=text&format=json&formatversion=2"
)
WIKI_CACHE = DATA / "wikipedia_largest_cities.json"
COORDS_URL = (
    "https://raw.githubusercontent.com/ivan-sepulveda/when-where/main/"
    "data/processed/tourist_cities_enhanced.json"
)
COORDS_CACHE = DATA / "tourist_cities_enhanced.json"

# Wikipedia name -> name in the coordinates file, where they differ.
CITY_ALIASES = {
    "New York City": "New York",
    "Bengaluru": "Bangalore",
    "Washington, D.C.": "Washington",
    "Yangon": "Rangoon",
}
# Wikipedia country -> country in the coordinates file, where they differ.
COUNTRY_ALIASES = {
    "South Korea": "Korea, South",
    "DR Congo": "Congo (Kinshasa)",
    "Hong Kong SAR": "Hong Kong",
    "Myanmar": "Burma",
}


def fetch(url: str, dest: Path, refresh: bool) -> Path:
    if dest.exists() and not refresh:
        return dest
    print(f"Downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "meridian-data-script/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.read())
    return dest


def cell_text(cell: str) -> str:
    cell = re.sub(r"<sup.*?</sup>", "", cell, flags=re.S)  # footnote markers
    cell = re.sub(r"<[^>]+>", "", cell)
    return re.sub(r"\s+", " ", html.unescape(cell)).strip()


def parse_wikipedia(path: Path) -> list[dict]:
    """Rows of the main table: City | Country | UN 2025 population | ..."""
    page = json.loads(path.read_text(encoding="utf-8"))["parse"]["text"]
    tables = re.findall(r"<table[^>]*>.*?</table>", page, re.S)
    table = next((t for t in tables if "UN 2025 population" in cell_text(t[:3000])), None)
    if table is None:
        raise SystemExit("Couldn't find the city table on the Wikipedia page; its layout may have changed.")
    cities = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        cells = [cell_text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)]
        if len(cells) < 3:
            continue
        if not re.fullmatch(r"[\d,]+", cells[2]):
            continue  # header rows
        cities.append({"name": cells[0], "country": cells[1], "population": int(cells[2].replace(",", ""))})
    return cities


def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true", help="re-download the sources")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    wiki = parse_wikipedia(fetch(WIKI_URL, WIKI_CACHE, args.refresh))
    coords = json.loads(fetch(COORDS_URL, COORDS_CACHE, args.refresh).read_text(encoding="utf-8"))["cities"]

    index: dict[tuple[str, str], dict] = {}
    for c in coords:
        key = (norm(c["city_ascii"]), c["country"])
        # Keep the most populous entry if a name repeats within a country.
        if key not in index or (c.get("population") or 0) > (index[key].get("population") or 0):
            index[key] = c

    out, missing = [], []
    for city in wiki:
        name = CITY_ALIASES.get(city["name"], city["name"])
        country = COUNTRY_ALIASES.get(city["country"], city["country"])
        match = index.get((norm(name), country))
        if not match:
            missing.append(f'{city["name"]} ({city["country"]})')
            continue
        out.append({
            "name": city["name"],
            "country": city["country"],
            "iso3": match["iso3"],
            "lat": round(match["lat"], 4),
            "lng": round(match["lng"], 4),
            "population": city["population"],
        })

    out.sort(key=lambda c: -c["population"])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "Wikipedia, List of largest cities (UN 2025 population estimates); "
                  "coordinates from ivan-sepulveda/when-where",
        "cities": out,
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} cities to {args.out.relative_to(ROOT)}", file=sys.stderr)
    if missing:
        print(f"No coordinates for {len(missing)}: {', '.join(missing)}", file=sys.stderr)
        print("Add them to CITY_ALIASES / COUNTRY_ALIASES.", file=sys.stderr)


if __name__ == "__main__":
    main()
