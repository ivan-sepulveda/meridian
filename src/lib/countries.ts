import world from "world-atlas/countries-50m.json";
import type { Topology, GeometryCollection } from "topojson-specification";
import { countryKeys } from "./countryKey";
import topTrade from "@/data/top-trade.json";
import servicesData from "@/data/services.json";
import gdpData from "@/data/gdp-per-capita.json";
import bigMacData from "@/data/big-mac.json";

/** A country's largest export or import product. */
export type TopProduct = {
  hs: string;
  label: string;
  /** Share of the country's total goods exports (or imports), 0–1. */
  share: number;
  valueUsd: number;
};

/** A country's largest services export category (broad balance-of-payments category). */
export type TopService = {
  label: string;
  /** Share of the country's services exports, 0–1. */
  share: number;
  valueUsd: number;
};

/** Nominal GDP per capita, US$ (IMF, else World Bank, else UN). */
export type GdpPerCapita = { usd: number; source: string; year: number | null };

/** The Economist's Big Mac Index, latest data point for the country. */
export type BigMac = {
  /** Price of a Big Mac in US dollars at market exchange rates. */
  dollarPrice: number;
  /** Currency over (+) or under (−) valuation against the dollar, e.g. 0.45 = +45%. */
  vsUsd: number | null;
  /** ISO date of the survey, e.g. "2026-07-01". */
  date: string;
  /** e.g. "Euro area average" for eurozone members. */
  note: string | null;
};

export type CountryStats = {
  /** Goods only (BACI). null for territories with no data. */
  topExport: TopProduct | null;
  topImport: TopProduct | null;
  /** Services as a share of goods + services exports, 0–1. */
  servicesShare: number | null;
  topService: TopService | null;
  /** Year of the services figures (World Bank; varies by country). */
  servicesYear: number | null;
  gdpPerCapita: GdpPerCapita | null;
  bigMac: BigMac | null;
  note3: number;
};

/** Year and source of the trade data, for display. */
export const tradeSource = { year: topTrade.year, source: topTrade.source };

type TradeProduct = TopProduct & { description: string };
type TradeEntry = { name: string; topExport: TradeProduct | null; topImport: TradeProduct | null };
const tradeByIso = topTrade.countries as Record<string, TradeEntry>;

type ServicesEntry = { year: number; servicesShare: number; topService: TopService | null };
const servicesByIso = servicesData.countries as Record<string, ServicesEntry>;
export const servicesSource = servicesData.source;

// Keyed by the map's own country name, so shapes without an ISO code (Kosovo) match.
const gdpByName = gdpData.countries as Record<string, GdpPerCapita>;
export const gdpSource = gdpData.source;

const bigMacByIso = bigMacData.countries as Record<string, BigMac & { name: string }>;
export const bigMacSource = bigMacData.source;

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

function fillerNote3(key: string): number {
  return Math.round(hash(`${key}:3`) * 1_000_000);
}

/**
 * Trade and services data are keyed by ISO numeric code. When the map gives two
 * shapes the same code (Australia and Ashmore & Cartier Is. are both 036), only
 * the one whose name matches the trade data gets the data.
 */
function ownsId(id: string | number | undefined, key: string, name: string): id is string | number {
  if (id === undefined || id === "") return false;
  return key === String(id) || tradeByIso[String(id)]?.name === name;
}

function pick(p: TradeProduct | null | undefined): TopProduct | null {
  if (!p) return null;
  const { hs, label, share, valueUsd } = p;
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
    .map((g, i) => {
      const owns = ownsId(g.id, keys[i], g.name);
      const trade = owns ? tradeByIso[String(g.id)] : undefined;
      const services = owns ? servicesByIso[String(g.id)] : undefined;
      const bigMac = owns ? bigMacByIso[String(g.id)] : undefined;
      return {
        id: keys[i],
        name: g.name,
        stats: {
          topExport: pick(trade?.topExport),
          topImport: pick(trade?.topImport),
          servicesShare: services?.servicesShare ?? null,
          topService: services?.topService ?? null,
          servicesYear: services?.year ?? null,
          gdpPerCapita: gdpByName[g.name] ?? null,
          bigMac: bigMac
            ? { dollarPrice: bigMac.dollarPrice, vsUsd: bigMac.vsUsd, date: bigMac.date, note: bigMac.note }
            : null,
          note3: fillerNote3(keys[i]),
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function getCountry(id: string): Country | undefined {
  return getCountries().find((c) => c.id === id);
}
