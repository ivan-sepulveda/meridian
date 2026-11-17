"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import type { Country, TopProduct } from "@/lib/countries";
import type { City } from "@/lib/cities";
import { countryKeys } from "@/lib/countryKey";

const WIDTH = 960;
const HEIGHT = 500;

type CountryFeature = Feature<Geometry, { name: string }> & { key: string };

type TradeSource = { year: number; source: string };

type Hover = {
  kind: "country" | "city";
  key: string;
  x: number;
  y: number;
  flipX: boolean;
  flipY: boolean;
};

// City names appear once zoomed in at least this far.
const LABEL_ZOOM = 3;

export default function WorldMap() {
  const [features, setFeatures] = useState<CountryFeature[]>([]);
  const [countries, setCountries] = useState<Record<string, Country>>({});
  const [hover, setHover] = useState<Hover | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trade, setTrade] = useState<TradeSource | null>(null);
  const [cities, setCities] = useState<City[]>([]);

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
        return r.json() as Promise<{ countries: Country[]; trade: TradeSource }>;
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
        setTrade(data.trade);
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
          svg.dataset.labels = e.transform.k >= LABEL_ZOOM ? "on" : "off";
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
    setHover({ kind, key, x, y, flipX: x > rect.width - 180, flipY: y > rect.height - 110 });
  };

  const hovered = hover?.kind === "country" ? countries[hover.key] : undefined;
  const hoveredCity = hover?.kind === "city" ? cities[Number(hover.key)] : undefined;
  const active = selected ? countries[selected] : undefined;

  return (
    <div className="flex w-full flex-1 flex-col gap-4 lg:flex-row">
      <div
        ref={wrapRef}
        className="relative w-full self-start overflow-hidden rounded-xl lg:flex-1 border border-[var(--border)] bg-[var(--ocean)]"
      >
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
              const share = c?.stats.topExport?.share;
              return (
                <path
                  key={f.key}
                  d={countryPaths[i]}
                  fill={
                    isSel ? "var(--selected)" : share === undefined ? "var(--land)" : shareFill(share)
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
            <g aria-label="Largest cities">
              {cities.map((city, i) => {
                const [x, y] = cityPoints[i];
                return (
                  <g
                    key={`${city.name}-${city.country}`}
                    transform={`translate(${x},${y})`}
                    className="city"
                    onPointerMove={(e) => onMove("city", String(i), e)}
                    onPointerLeave={() => setHover(null)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Larger invisible target so small dots are easy to hover. */}
                    <circle className="city-hit" />
                    <circle className="city-dot" />
                    <text className="city-label">{city.name}</text>
                  </g>
                );
              })}
            </g>
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
            <div className="mt-1 tabular-nums">
              {formatPopulation(hoveredCity.population)} people{" "}
              <span className="text-[var(--muted)]">(UN 2025 est.)</span>
            </div>
          </div>
        )}

        <button
          onClick={resetZoom}
          className="absolute bottom-3 right-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-xs hover:bg-[var(--hover)]"
        >
          Reset view
        </button>
        <Legend />
      </div>

      <aside className="w-full shrink-0 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 lg:w-72">
        {active ? (
          <>
            <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Selected</div>
            <h2 className="mb-4 text-xl font-semibold">{active.name}</h2>
            <StatRows country={active} large />
            <p className="mt-6 text-xs text-[var(--muted)]">
              Trade: goods only{trade ? `, ${trade.year}, from ${trade.source}` : ""}. Note 3 is a
              filler value.
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

function TradeValue({ product, of, large }: { product: TopProduct | null; of: string; large?: boolean }) {
  if (!product) return <span className="text-[var(--muted)]">No data</span>;
  return (
    <>
      {product.label}
      {large && (
        <div className="text-xs font-normal text-[var(--muted)]">
          {formatShare(product.share)} of {of} · {formatUsd(product.valueUsd)}
        </div>
      )}
    </>
  );
}

function StatRows({ country, large }: { country: Country; large?: boolean }) {
  const { topExport, topImport, note3 } = country.stats;
  const rows: [string, React.ReactNode][] = [
    ["Top Export", <TradeValue key="e" product={topExport} of="exports" large={large} />],
    ["Top Import", <TradeValue key="i" product={topImport} of="imports" large={large} />],
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

// Shading: the top export's share of total exports. 60%+ is fully saturated;
// few countries are above that, and those (mostly oil states) all read as "very dependent".
const SHARE_MAX = 0.6;
function shareFill(share: number) {
  const pct = 15 + Math.min(share / SHARE_MAX, 1) * 70;
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

function Legend() {
  return (
    <div className="absolute bottom-3 left-3 rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-[10px] text-[var(--muted)]">
      <div className="mb-1">Top export, share of all exports</div>
      <div
        className="h-2 w-28 rounded-sm"
        style={{
          background:
            `linear-gradient(to right, ${shareFill(0)}, ${shareFill(SHARE_MAX)})`,
        }}
      />
      <div className="mt-0.5 flex justify-between tabular-nums">
        <span>0%</span>
        <span>{formatShare(SHARE_MAX)}+</span>
      </div>
    </div>
  );
}
