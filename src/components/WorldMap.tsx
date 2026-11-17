"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import type { BigMac, Country, TopProduct } from "@/lib/countries";
import type { City } from "@/lib/cities";
import { countryKeys } from "@/lib/countryKey";

const WIDTH = 960;
const HEIGHT = 500;

type CountryFeature = Feature<Geometry, { name: string }> & { key: string };

type TradeSource = { year: number; source: string; services: string };

type Hover = {
  kind: "country" | "city";
  key: string;
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
};

// Names of the largest cities appear from this zoom; capital-only names from the next.
const LABEL_ZOOM_MAJOR = 3;
const LABEL_ZOOM_ALL = 5;

export default function WorldMap() {
  const [features, setFeatures] = useState<CountryFeature[]>([]);
  const [countries, setCountries] = useState<Record<string, Country>>({});
  const [hover, setHover] = useState<Hover | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trade, setTrade] = useState<TradeSource | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [showCities, setShowCities] = useState(false);
  const [shadeBy, setShadeBy] = useState<ShadeMetric>("gdpPerCapita");

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Geometry is a static asset (code-split); stats come from our API.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("world-atlas/countries-50m.json"),
      fetch("/api/countries").then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json() as Promise<{ countries: Country[]; trade: Omit<TradeSource, "services">; services: string }>;
      }),
      fetch("/api/cities").then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json() as Promise<{ cities: City[] }>;
      }),
    ])
      .then(([world, data, cityData]) => {
        if (cancelled) return;
        const topo = (world.default ?? world) as unknown as Topology<{
          countries: GeometryCollection<{ name: string }>;
        }>;
        const fc = feature(topo, topo.objects.countries);
        const keys = countryKeys(fc.features.map((f) => ({ id: f.id, name: f.properties.name })));
        setFeatures(fc.features.map((f, i) => ({ ...f, key: keys[i] })));
        setCountries(Object.fromEntries(data.countries.map((c) => [c.id, c])));
        setTrade({ ...data.trade, services: data.services });
        setCities(cityData.cities);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const projection = useMemo(
    () =>
      geoNaturalEarth1().fitExtent(
        [
          [8, 8],
          [WIDTH - 8, HEIGHT - 8],
        ],
        { type: "Sphere" },
      ),
    [],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  // Project once; hover re-renders then only touch fill/stroke.
  const countryPaths = useMemo(() => features.map((f) => path(f) ?? ""), [features, path]);
  const cityPoints = useMemo(
    () => cities.map((c) => projection([c.lng, c.lat]) ?? [0, 0]),
    [cities, projection],
  );

  // Pan + zoom (scroll / pinch / drag).
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const g = select(gRef.current);
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 12])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .on("zoom", (e) => {
        g.attr("transform", e.transform.toString());
        // Counter-scale city dots and labels so they stay the same size on screen.
        const svg = svgRef.current;
        if (svg) {
          svg.style.setProperty("--k", String(e.transform.k));
          const k = e.transform.k;
          svg.dataset.labels = k >= LABEL_ZOOM_ALL ? "all" : k >= LABEL_ZOOM_MAJOR ? "major" : "off";
        }
      });
    select(svgRef.current).call(z);
    zoomRef.current = z;
  }, []);

  const resetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
    }
  };

  const onMove = (kind: Hover["kind"], key: string, e: React.PointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHover({ kind, key, x, y, flipX: x > rect.width / 2, flipY: y > rect.height / 2 });
  };

  const hovered = hover?.kind === "country" ? countries[hover.key] : undefined;
  const hoveredCity = hover?.kind === "city" ? cities[Number(hover.key)] : undefined;
  const active = selected ? countries[selected] : undefined;

  return (
    <div className="flex w-full flex-1 flex-col gap-4 lg:flex-row">
      {/* Outer box positions overlays; only the inner one clips, so tooltips and
          the Options menu can extend past the map's edge. */}
      <div ref={wrapRef} className="relative w-full self-start lg:flex-1">
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--ocean)]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="world-map block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
            data-labels="off"
            role="img"
            aria-label="World map"
            onClick={() => setSelected(null)}
          >
            <g ref={gRef}>
              <path d={path({ type: "Sphere" }) ?? ""} fill="var(--ocean)" />
              <path
                d={path(geoGraticule10()) ?? ""}
                fill="none"
                stroke="var(--graticule)"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
              />
              {features.map((f, i) => {
                const c = countries[f.key];
                const isSel = f.key === selected;
                const isHover = hover?.kind === "country" && f.key === hover.key;
                const metric = SHADE_METRICS[shadeBy];
                const value = c ? metric.value(c) : null;
                return (
                  <path
                    key={f.key}
                    d={countryPaths[i]}
                    fill={
                      isSel ? "var(--selected)" : value == null ? "var(--land)" : metricFill(metric, value)
                    }
                    stroke={isHover || isSel ? "var(--foreground)" : "var(--border-country)"}
                    strokeWidth={isHover || isSel ? 1.25 : 0.5}
                    vectorEffect="non-scaling-stroke"
                    className="cursor-pointer transition-[fill] duration-150"
                    onPointerMove={(e) => onMove("country", f.key, e)}
                    onPointerLeave={() => setHover(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected((s) => (s === f.key ? null : f.key));
                    }}
                  >
                    <title>{f.properties.name}</title>
                  </path>
                );
              })}
              {showCities && (
                <g aria-label="Largest cities and capitals">
                  {cities.map((city, i) => {
                    const [x, y] = cityPoints[i];
                    return (
                      <g
                        key={`${city.name}-${city.country}`}
                        transform={`translate(${x},${y})`}
                        className={`city ${city.capital ? "is-capital" : ""} ${city.largest ? "is-major" : ""}`}
                        onPointerMove={(e) => onMove("city", String(i), e)}
                        onPointerLeave={() => setHover(null)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Larger invisible target so small dots are easy to hover. */}
                        <circle className="city-hit" />
                        {city.capital && <circle className="city-ring" />}
                        <circle className="city-dot" />
                        <text className="city-label">{city.name}</text>
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          </svg>

          {features.length === 0 && !error && (
            <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted)]">
              Loading map…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 grid place-items-center text-sm text-red-500">{error}</div>
          )}
        </div>

        {hovered && hover && (
          <div
            className="pointer-events-none absolute z-10 w-max min-w-48 max-w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs shadow-lg"
            style={{
              left: hover.x + 14,
              top: hover.y + 14,
              transform: `${hover.flipX ? "translateX(calc(-100% - 28px))" : ""} ${hover.flipY ? "translateY(calc(-100% - 28px))" : ""}`,
            }}
          >
            <div className="mb-1 font-semibold">{hovered.name}</div>
            <StatRows country={hovered} />
          </div>
        )}

        {hoveredCity && hover && (
          <div
            className="pointer-events-none absolute z-10 w-max max-w-72 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs shadow-lg"
            style={{
              left: hover.x + 14,
              top: hover.y + 14,
              transform: `${hover.flipX ? "translateX(calc(-100% - 28px))" : ""} ${hover.flipY ? "translateY(calc(-100% - 28px))" : ""}`,
            }}
          >
            <div className="font-semibold">{hoveredCity.name}</div>
            <div className="text-[var(--muted)]">{hoveredCity.country}</div>
            {hoveredCity.capital && (
              <div className="mt-1">
                ★ {hoveredCity.capitalRole ?? "Capital"}
                {hoveredCity.capitalRole ? ` of ${hoveredCity.country}` : ""}
              </div>
            )}
            {hoveredCity.population !== null && (
              <div className="mt-1 tabular-nums">
                {formatPopulation(hoveredCity.population)} people{" "}
                <span className="text-[var(--muted)]">(UN 2025 est.)</span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={resetZoom}
          className="absolute bottom-3 right-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-xs hover:bg-[var(--hover)]"
        >
          Reset view
        </button>
        <OptionsMenu
          shadeBy={shadeBy}
          onShadeByChange={setShadeBy}
          showCities={showCities}
          onShowCitiesChange={(on) => {
            setShowCities(on);
            if (!on) setHover((h) => (h?.kind === "city" ? null : h));
          }}
        />
        <Legend metric={SHADE_METRICS[shadeBy]} />
      </div>

      <aside className="w-full shrink-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 lg:w-72">
        {active ? (
          <>
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Selected</div>
            <h2 className="mb-4 text-xl font-semibold">{active.name}</h2>
            <StatRows country={active} large />
            <p className="mt-6 text-xs text-[var(--muted)]">
              Goods: {trade ? `${trade.year}, ${trade.source}` : "CEPII BACI"}. Services:{" "}
              {trade?.services ?? "World Bank"}
              {active.stats.servicesYear ? `, ${active.stats.servicesYear}` : ""}; categories are
              broad, and software and film rights mostly fall under IP licensing. GDP per capita:
              nominal US$, {active.stats.gdpPerCapita
                ? `${active.stats.gdpPerCapita.source}${active.stats.gdpPerCapita.year ? ` ${active.stats.gdpPerCapita.year}` : ""}`
                : "IMF / World Bank / UN"}{" "}
              via Wikipedia. Big Mac: The Economist&apos;s Big Mac Index, latest survey for each
              country. Note 3 is a filler value.
            </p>
          </>
        ) : (
          <div className="text-sm text-[var(--muted)]">
            Hover a country for a quick look, or click one to pin its stats here. Scroll or pinch
            to zoom, drag to pan.
          </div>
        )}
      </aside>
    </div>
  );
}

type Ranked = Pick<TopProduct, "label" | "share" | "valueUsd">;

const noData = <span className="text-[var(--muted)]">No data</span>;

/** "Crude oil (7%)"; the panel adds the dollar value underneath. */
function TradeValue({ product, large }: { product: Ranked | null; large?: boolean }) {
  if (!product) return noData;
  return (
    <>
      {product.label} <span className="text-[var(--muted)]">({formatShare(product.share)})</span>
      {large && <div className="text-xs font-normal text-[var(--muted)]">{formatUsd(product.valueUsd)}</div>}
    </>
  );
}

/** "$9.04 (+45% vs US)"; the panel adds the survey date and any note. */
function BigMacValue({ bigMac, large }: { bigMac: BigMac; large?: boolean }) {
  const vs = bigMac.vsUsd;
  const sign = vs !== null && vs > 0 ? "+" : "";
  const date = new Date(`${bigMac.date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      ${bigMac.dollarPrice.toFixed(2)}
      {vs !== null && Math.abs(vs) >= 0.005 && (
        <span className="text-[var(--muted)]">
          {" "}
          ({sign}
          {formatShare(vs)} vs US)
        </span>
      )}
      {large && (
        <div className="text-xs font-normal text-[var(--muted)]">
          {[bigMac.note, date].filter(Boolean).join(" · ")}
        </div>
      )}
    </>
  );
}

function StatRows({ country, large }: { country: Country; large?: boolean }) {
  const { topExport, topImport, topService, gdpPerCapita, bigMac, note3 } = country.stats;
  const rows: [string, React.ReactNode][] = [
    ["Top goods export", <TradeValue key="e" product={topExport} large={large} />],
    ["Top service export", <TradeValue key="s" product={topService} large={large} />],
    ["Top goods import", <TradeValue key="i" product={topImport} large={large} />],
    ["GDP per capita", gdpPerCapita ? `$${gdpPerCapita.usd.toLocaleString("en-US")}` : noData],
    ["Big Mac", bigMac ? <BigMacValue key="b" bigMac={bigMac} large={large} /> : noData],
    ["Note 3", note3.toLocaleString()],
  ];
  return (
    <dl className={large ? "space-y-3" : "space-y-0.5"}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-[var(--muted)]">{label}</dt>
          <dd className={`text-right tabular-nums ${large ? "text-lg font-medium" : ""}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Shading. Each metric maps a country to a number, and a range to colour
// between. Add entries here to offer more choices in Options.
type ShadeMetricDef = {
  label: string;
  value: (c: Country) => number | null | undefined;
  min: number;
  max: number;
  /** Log scale: equal steps for each 10x, so poor and rich countries both get contrast. */
  log: boolean;
  format: (n: number) => string;
};

const SHADE_METRICS = {
  gdpPerCapita: {
    label: "GDP per capita",
    value: (c) => c.stats.gdpPerCapita?.usd,
    min: 1_000,
    max: 100_000,
    log: true,
    format: (n) => (n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${n}`),
  },
  bigMac: {
    label: "Big Mac Index (price in US$)",
    value: (c) => c.stats.bigMac?.dollarPrice,
    min: 2,
    max: 8,
    log: false,
    format: (n) => `$${Math.round(n)}`,
  },
} satisfies Record<string, ShadeMetricDef>;

type ShadeMetric = keyof typeof SHADE_METRICS;

function metricPosition(m: ShadeMetricDef, v: number) {
  const t = m.log
    ? (Math.log(Math.max(v, 1)) - Math.log(m.min)) / (Math.log(m.max) - Math.log(m.min))
    : (v - m.min) / (m.max - m.min);
  return Math.min(Math.max(t, 0), 1);
}

function metricFill(m: ShadeMetricDef, v: number) {
  const pct = 15 + metricPosition(m, v) * 70;
  return `color-mix(in oklab, var(--accent) ${pct}%, var(--land))`;
}

function formatPopulation(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString();
}

function formatShare(share: number) {
  return `${Math.round(share * 100)}%`;
}

function formatUsd(usd: number) {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${Math.round(usd / 1e3)}K`;
}

function OptionsMenu({
  shadeBy,
  onShadeByChange,
  showCities,
  onShowCitiesChange,
}: {
  shadeBy: ShadeMetric;
  onShadeByChange: (m: ShadeMetric) => void;
  showCities: boolean;
  onShowCitiesChange: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="absolute right-3 top-3 z-20 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 hover:bg-[var(--hover)]"
      >
        Options
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-max space-y-1 rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg">
          <label className="flex flex-col gap-1 px-1.5 py-1">
            <span className="text-[var(--muted)]">Shade countries by</span>
            <select
              value={shadeBy}
              onChange={(e) => onShadeByChange(e.target.value as ShadeMetric)}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1"
            >
              {(Object.keys(SHADE_METRICS) as ShadeMetric[]).map((m) => (
                <option key={m} value={m}>
                  {SHADE_METRICS[m].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--hover)]">
            <input
              type="checkbox"
              checked={showCities}
              onChange={(e) => onShowCitiesChange(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Show Cities
          </label>
        </div>
      )}
    </div>
  );
}

function Legend({ metric }: { metric: ShadeMetricDef }) {
  // Middle tick at the scale's midpoint (for a log scale, the geometric mean).
  const mid = metric.log ? Math.sqrt(metric.min * metric.max) : (metric.min + metric.max) / 2;
  return (
    <div className="absolute bottom-3 left-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-[10px] text-[var(--muted)]">
      <div className="mb-1">{metric.label}</div>
      <div
        className="h-2 w-32 rounded-sm"
        style={{
          background: `linear-gradient(to right, ${metricFill(metric, metric.min)}, ${metricFill(metric, metric.max)})`,
        }}
      />
      <div className="mt-0.5 flex justify-between tabular-nums">
        <span>&lt;{metric.format(metric.min)}</span>
        <span>{metric.format(mid)}</span>
        <span>{metric.format(metric.max)}+</span>
      </div>
    </div>
  );
}
