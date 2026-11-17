import world from "world-atlas/countries-50m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryKeys } from "./countryKey";

export type CountryStats = {
  note1: number;
  note2: number;
  note3: number;
};

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

function fillerStats(key: string): CountryStats {
  return {
    note1: Math.round(hash(`${key}:1`) * 100),
    note2: Math.round(hash(`${key}:2`) * 1000) / 10,
    note3: Math.round(hash(`${key}:3`) * 1_000_000),
  };
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
    .map((g, i) => ({ id: keys[i], name: g.name, stats: fillerStats(keys[i]) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function getCountry(id: string): Country | undefined {
  return getCountries().find((c) => c.id === id);
}
