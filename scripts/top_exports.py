#!/usr/bin/env python3
"""Compute each country's top export from a BACI trade file.

Reads the raw BACI files in data/ (not committed) and writes a small JSON file
the app serves: src/data/top-exports.json, keyed by the ISO 3166-1 numeric
code the map uses (zero-padded, e.g. "076" for Brazil).

Usage:
    python3 scripts/top_exports.py
    python3 scripts/top_exports.py --trade data/BACI_HS17_Y2023_V202601.csv \
        --products data/product_codes_HS17_V202601.csv \
        --countries data/country_codes_V202601.csv

Standard library only. BACI columns: t=year, i=exporter, j=importer,
k=HS6 product, v=value (thousands of USD), q=quantity (metric tons).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "src" / "data" / "top-exports.json"

# BACI follows UN Comtrade's country codes, which match ISO numeric codes
# except for these. 490 "Other Asia, nes" is Comtrade's code for Taiwan.
BACI_TO_ISO = {
    251: 250,  # France
    579: 578,  # Norway
    699: 356,  # India
    757: 756,  # Switzerland
    842: 840,  # USA
    490: 158,  # Taiwan
}
NAME_OVERRIDES = {490: "Taiwan"}

# Readable names for HS codes that come up as a top export (HS07 codes).
# Anything not listed falls back to short_label(); add entries here as needed.
LABELS = {
    "270900": "Crude oil",
    "271000": "Refined petroleum",
    "271111": "Liquefied natural gas",
    "271121": "Natural gas",
    "270112": "Coal",
    "270119": "Coal",
    "271600": "Electricity",
    "284410": "Uranium",
    "710812": "Gold",
    "710813": "Gold (semi-manufactured)",
    "711319": "Gold jewellery",
    "710231": "Rough diamonds",
    "710239": "Cut diamonds",
    "710121": "Cultured pearls",
    "260111": "Iron ore",
    "260300": "Copper ore",
    "740311": "Refined copper",
    "740200": "Unrefined copper",
    "750210": "Nickel",
    "760110": "Aluminium",
    "281820": "Alumina",
    "720221": "Ferrosilicon",
    "720260": "Ferronickel",
    "720449": "Scrap iron & steel",
    "721650": "Steel sections",
    "251710": "Gravel & crushed stone",
    "310420": "Potash",
    "310390": "Phosphate fertilizer",
    "080300": "Bananas",
    "080420": "Figs",
    "080131": "Cashew nuts",
    "090111": "Coffee",
    "090240": "Black tea",
    "090700": "Cloves",
    "180100": "Cocoa beans",
    "120100": "Soybeans",
    "230400": "Soybean meal",
    "100590": "Corn",
    "170111": "Raw cane sugar",
    "170199": "Refined sugar",
    "150910": "Olive oil",
    "040221": "Milk powder",
    "240120": "Tobacco",
    "240210": "Cigars",
    "240220": "Cigarettes",
    "220840": "Rum",
    "220190": "Water",
    "030343": "Frozen skipjack tuna",
    "030232": "Fresh yellowfin tuna",
    "030362": "Frozen toothfish",
    "030379": "Frozen fish",
    "030613": "Frozen shrimp",
    "030799": "Frozen molluscs",
    "160414": "Canned tuna",
    "160510": "Prepared crab",
    "230120": "Fishmeal",
    "440349": "Tropical timber",
    "440710": "Sawn softwood",
    "470329": "Wood pulp",
    "300490": "Medicines",
    "300390": "Medicines (bulk)",
    "300439": "Hormone medicines",
    "300290": "Biological products",
    "901890": "Medical instruments",
    "330210": "Food flavourings",
    "293100": "Organo-inorganic compounds",
    "381512": "Catalysts",
    "390120": "Polyethylene",
    "390760": "PET plastic",
    "870321": "Cars",
    "870323": "Cars",
    "870390": "Cars",
    "880240": "Large aircraft",
    "841112": "Jet engines",
    "890110": "Cruise ships & ferries",
    "890190": "Cargo ships",
    "890392": "Yachts & motorboats",
    "890800": "Ships for scrap",
    "854231": "Processors & chips",
    "854232": "Memory chips",
    "854239": "Integrated circuits",
    "851712": "Mobile phones",
    "847170": "Data storage units",
    "850780": "Batteries",
    "854140": "Solar cells & LEDs",
    "854430": "Vehicle wiring harnesses",
    "854442": "Electrical cables",
    "842240": "Packing machinery",
    "610910": "Cotton T-shirts",
    "621210": "Bras",
    "640391": "Leather footwear",
    "570110": "Wool carpets",
    "670420": "Wigs & hairpieces",
    "680530": "Abrasives",
    "940180": "Seats",
    "970110": "Paintings",
}

def short_label(description: str) -> str:
    """Fallback label from an HS description.

    BACI descriptions read "Category: specific item, qualifiers (notes)", so take
    the specific part:  "Fruit, edible: figs, fresh or dried" -> "Figs"
    """
    label = description.split(":", 1)[-1]
    label = label.split("(")[0].split(";")[0].split(",")[0].strip()
    return label[:1].upper() + label[1:]


def load_countries(path: Path) -> dict[int, dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return {
            int(r["country_code"]): {"name": r["country_name"], "iso3": r["country_iso3"]}
            for r in csv.DictReader(f)
        }


def load_products(path: Path) -> dict[str, str]:
    # Latin-1 fallback: some BACI releases aren't UTF-8.
    for enc in ("utf-8", "latin-1"):
        try:
            with path.open(newline="", encoding=enc) as f:
                return {r["code"].zfill(6): r["description"] for r in csv.DictReader(f)}
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"Could not decode {path}")


def aggregate(path: Path) -> tuple[int, dict[int, dict[str, float]]]:
    """Sum export value per (exporter, product) across all importers."""
    totals: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    year = None
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        col = {name: i for i, name in enumerate(header)}
        ti, ii, ki, vi = col["t"], col["i"], col["k"], col["v"]
        for n, row in enumerate(reader, 1):
            if year is None:
                year = int(row[ti])
            try:
                totals[int(row[ii])][row[ki].zfill(6)] += float(row[vi])
            except ValueError:
                continue  # blank or malformed value
            if n % 2_000_000 == 0:
                print(f"  {n:,} rows…", file=sys.stderr)
    if year is None:
        raise SystemExit(f"No rows in {path}")
    return year, totals


def latest(pattern: str) -> Path:
    matches = sorted(DATA.glob(pattern))
    if not matches:
        raise SystemExit(f"No file matching data/{pattern}")
    return matches[-1]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--trade", type=Path, help="BACI trade CSV (default: latest data/BACI_*.csv)")
    p.add_argument("--products", type=Path, help="product codes CSV (default: latest data/product_codes_*.csv)")
    p.add_argument("--countries", type=Path, help="country codes CSV (default: latest data/country_codes_*.csv)")
    p.add_argument("--out", type=Path, default=OUT)
    args = p.parse_args()

    trade = args.trade or latest("BACI_*.csv")
    products_path = args.products or latest("product_codes_*.csv")
    countries_path = args.countries or latest("country_codes_*.csv")

    print(f"Reading {trade.name}", file=sys.stderr)
    year, totals = aggregate(trade)
    products = load_products(products_path)
    countries = load_countries(countries_path)

    out: dict[str, dict] = {}
    for baci_code, by_product in totals.items():
        hs, value = max(by_product.items(), key=lambda kv: kv[1])
        total = sum(by_product.values())
        country = countries.get(baci_code, {"name": str(baci_code), "iso3": ""})
        name = NAME_OVERRIDES.get(baci_code, country["name"])
        description = products.get(hs, "")
        iso = BACI_TO_ISO.get(baci_code, baci_code)
        out[f"{iso:03d}"] = {
            "name": name,
            "iso3": country["iso3"],
            "topExport": {
                "hs": hs,
                "label": LABELS.get(hs) or short_label(description) or hs,
                "description": description,
                "valueUsd": round(value * 1000),
                "share": round(value / total, 4) if total else 0,
            },
            "totalExportsUsd": round(total * 1000),
        }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": f"CEPII BACI ({trade.stem})",
        "year": year,
        "countries": dict(sorted(out.items())),
    }
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} countries for {year} to {args.out.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
