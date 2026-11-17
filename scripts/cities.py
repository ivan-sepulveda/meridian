#!/usr/bin/env python3
"""Build the map's city list: the world's largest cities plus every national capital.

Sources (downloaded into data/ on first run, which is git-ignored):
  - Wikipedia "List of largest cities": names, countries, UN 2025 population
  - ivan-sepulveda/when-where tourist_cities_enhanced.json: coordinates for those
  - Natural Earth 10m populated places (public domain): national capitals

A capital that is also one of the largest cities becomes a single entry.
Writes src/data/cities.json for the app.

Usage:
    python3 scripts/cities.py            # uses cached downloads in data/
    python3 scripts/cities.py --refresh  # re-download the sources

Standard library only.
"""

from __future__ import annotations

import argparse
import html
import json
import math
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
PLACES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/"
    "geojson/ne_10m_populated_places_simple.geojson"
)
PLACES_CACHE = DATA / "ne_10m_populated_places_simple.json"

# Tiny European states that sit inside or between larger neighbours; their
# capitals would just clutter the map.
SKIP_CAPITALS_OF = {"AND", "LIE", "MCO", "SMR", "VAT"}
# Natural Earth tags these as national capitals, but they aren't (Johannesburg
# hosts no branch of government; Yangon and Dar es Salaam are former capitals).
NOT_CAPITALS = {("Johannesburg", "ZAF"), ("Yangon", "MMR"), ("Dar es Salaam", "TZA")}
# Natural Earth files these official capitals as "Admin-0 capital alt". Other
# alts (Kyoto, Tel Aviv, Lagos, Baguio, Laayoune…) are former, claimed or
# ceremonial capitals and stay out.
ALT_CAPITALS = {
    ("Dodoma", "TZA"),
    ("The Hague", "NLD"),
    ("Putrajaya", "MYS"),
    ("Porto-Novo", "BEN"),
    ("Sri Jayawardenepura Kotte", "LKA"),
    ("Lobamba", "SWZ"),
}
# A capital within this distance of a largest-city entry in the same country is
# treated as the same place (e.g. Natural Earth's "New Delhi" and Wikipedia's "Delhi").
MERGE_KM = 30

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


def km_between(a: dict, b: dict) -> float:
    """Great-circle distance between two {lat, lng} points."""
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lng"], b["lat"], b["lng"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


# Countries with more than one official capital: say which role each plays.
CAPITAL_ROLES = {
    ("Pretoria", "ZAF"): "Executive capital",
    ("Cape Town", "ZAF"): "Legislative capital",
    ("Bloemfontein", "ZAF"): "Judicial capital",
    ("Sucre", "BOL"): "Constitutional capital",
    ("La Paz", "BOL"): "Seat of government",
    ("Yamoussoukro", "CIV"): "Official capital",
    ("Abidjan", "CIV"): "Seat of government",
    ("Amsterdam", "NLD"): "Constitutional capital",
    ("The Hague", "NLD"): "Seat of government",
    ("Kuala Lumpur", "MYS"): "Official capital",
    ("Putrajaya", "MYS"): "Administrative capital",
    ("Porto-Novo", "BEN"): "Official capital",
    ("Cotonou", "BEN"): "Seat of government",
    ("Sri Jayawardenepura Kotte", "LKA"): "Legislative capital",
    ("Colombo", "LKA"): "Executive capital",
    ("Mbabane", "SWZ"): "Administrative capital",
    ("Lobamba", "SWZ"): "Legislative & royal capital",
}


def load_capitals(path: Path) -> list[dict]:
    places = json.loads(path.read_text(encoding="utf-8"))["features"]
    capitals = []
    for f in places:
        p = f["properties"]
        name = re.sub(r"\s+", " ", p["name"]).strip()  # "Washington,  D.C."
        iso3 = p["adm0_a3"]
        is_capital = p["featurecla"] == "Admin-0 capital" or (
            p["featurecla"] == "Admin-0 capital alt" and (name, iso3) in ALT_CAPITALS
        )
        if not is_capital or iso3 in SKIP_CAPITALS_OF or (name, iso3) in NOT_CAPITALS:
            continue
        capitals.append({
            "name": name,
            "country": p["adm0name"],
            "iso3": iso3,
            "lat": round(p["latitude"], 4),
            "lng": round(p["longitude"], 4),
            "capitalRole": CAPITAL_ROLES.get((name, iso3)),
        })
    return capitals


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--refresh", action="store_true", help="re-download the sources")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    wiki = parse_wikipedia(fetch(WIKI_URL, WIKI_CACHE, args.refresh))
    coords = json.loads(fetch(COORDS_URL, COORDS_CACHE, args.refresh).read_text(encoding="utf-8"))["cities"]
    capitals = load_capitals(fetch(PLACES_URL, PLACES_CACHE, args.refresh))

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
            "largest": True,
            "capital": False,
            "capitalRole": None,
        })

    # Fold capitals in: mark a matching largest city, otherwise add a new entry.
    # Exact name matches go first, so Kuala Lumpur claims its own dot before
    # Putrajaya (25 km away) can; then nearby matches catch spelling differences
    # (New Delhi -> Delhi). A city absorbs at most one capital.
    def mark(city: dict, cap: dict) -> None:
        city["capital"] = True
        city["capitalRole"] = cap["capitalRole"]

    largest = [c for c in out if c["largest"]]
    unmatched = []
    for cap in capitals:
        same = next((c for c in largest if c["iso3"] == cap["iso3"] and norm(c["name"]) == norm(cap["name"])), None)
        if same and not same["capital"]:
            mark(same, cap)
        else:
            unmatched.append(cap)
    merged = len(capitals) - len(unmatched)
    for cap in unmatched:
        nearby = [
            c for c in largest
            if not c["capital"] and c["iso3"] == cap["iso3"] and km_between(c, cap) <= MERGE_KM
        ]
        if nearby:
            mark(min(nearby, key=lambda c: km_between(c, cap)), cap)
            merged += 1
        else:
            out.append({**cap, "population": None, "largest": False, "capital": True})

    # Largest cities first (by population), then capitals alphabetically.
    out.sort(key=lambda c: (not c["largest"], -(c["population"] or 0), c["name"]))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "Wikipedia, List of largest cities (UN 2025 population estimates); "
                  "coordinates from ivan-sepulveda/when-where; capitals from Natural Earth",
        "cities": out,
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(out)} places to {args.out.relative_to(ROOT)}: {len(wiki) - len(missing)} largest cities, "
        f"{len(capitals)} capitals ({merged} of them also largest cities)",
        file=sys.stderr,
    )
    if missing:
        print(f"No coordinates for {len(missing)}: {', '.join(missing)}", file=sys.stderr)
        print("Add them to CITY_ALIASES / COUNTRY_ALIASES.", file=sys.stderr)


if __name__ == "__main__":
    main()
