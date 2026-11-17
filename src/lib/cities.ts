import data from "@/data/cities.json";

export type City = {
  name: string;
  country: string;
  iso3: string;
  lat: number;
  lng: number;
  /** UN 2025 estimate, as listed on Wikipedia. */
  population: number;
};

export const citiesSource = data.source;

export function getCities(): City[] {
  return data.cities;
}
