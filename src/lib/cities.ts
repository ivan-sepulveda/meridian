import data from "@/data/cities.json";

export type City = {
  name: string;
  country: string;
  iso3: string;
  lat: number;
  lng: number;
  /** UN 2025 estimate, as listed on Wikipedia; null for capitals not on that list. */
  population: number | null;
  /** On Wikipedia's list of largest cities. */
  largest: boolean;
  /** A national capital (Natural Earth). */
  capital: boolean;
  /** For countries with several capitals, e.g. "Legislative capital". */
  capitalRole: string | null;
};

export const citiesSource = data.source;

export function getCities(): City[] {
  return data.cities;
}
