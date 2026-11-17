import world from "world-atlas/countries-50m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryKeys } from "./countryKey";
import topExports from "@/data/top-exports.json";

export type TopExport = {
  hs: string;
  label: string;
  /** Share of the country's total goods exports, 0–1. */
  share: number;
  valueUsd: number;
};

export type CountryStats = {
  /** null for territories BACI has no data for. */
  topExport: TopExport | null;
  note2: number;
  note3: number;
};

/** Year and source of the trade data, for display. */
export const tradeSource = { year: topExports.year, source: topExports.source };

type TopExportEntry = { name: string; topExport: TopExport & { description: string } };
const exportsByIso = topExports.countries as Record<string, TopExportEntry>;

export type Country = {
  id: string;
  name: string;
  stats: CountryStats;
};

type CountryProps = { name: string };

const topology = world as unknown as Topology<{
  countries: GeometryCollection<CountryProps>;
}>;

// Deterministic pseudo-random number in [0, 1) from a string, so filler values
// stay the same across requests and deploys.
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function fillerStats(key: string): Omit<CountryStats, "topExport"> {
  return {
    note2: Math.round(hash(`${key}:2`) * 1000) / 10,
    note3: Math.round(hash(`${key}:3`) * 1_000_000),
  };
}

/**
 * Trade data is keyed by ISO numeric code. When the map gives two shapes the same
 * code (Australia and Ashmore & Cartier Is. are both 036), only the one whose
 * name matches gets the data.
 */
function lookupTopExport(id: string | number | undefined, key: string, name: string): TopExport | null {
  if (id === undefined || id === "") return null;
  const entry = exportsByIso[String(id)];
  if (!entry) return null;
  if (key !== String(id) && entry.name !== name) return null;
  const { hs, label, share, valueUsd } = entry.topExport;
  return { hs, label, share, valueUsd };
}

let cache: Country[] | null = null;

export function getCountries(): Country[] {
  if (cache) return cache;
  const geoms = topology.objects.countries.geometries.map((g) => ({
    id: g.id,
    name: (g.properties as CountryProps | undefined)?.name ?? "Unknown",
  }));
  const keys = countryKeys(geoms);
  cache = geoms
    .map((g, i) => ({
      id: keys[i],
      name: g.name,
      stats: { topExport: lookupTopExport(g.id, keys[i], g.name), ...fillerStats(keys[i]) },
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function getCountry(id: string): Country | undefined {
  return getCountries().find((c) => c.id === id);
}
