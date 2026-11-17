"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, Geometry } from "geojson";
import type { Country } from "@/lib/countries";
import { countryKeys } from "@/lib/countryKey";

const WIDTH = 960;
const HEIGHT = 500;

type CountryFeature = Feature<Geometry, { name: string }> & { key: string };

type TradeSource = { year: number; source: string };

type Hover = { key: string; x: number; y: number; flipX: boolean; flipY: boolean };

export default function WorldMap() {
  const [features, setFeatures] = useState<CountryFeature[]>([]);
  const [countries, setCountries] = useState<Record<string, Country>>({});
  const [hover, setHover] = useState<Hover | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trade, setTrade] = useState<TradeSource | null>(null);

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
    ])
      .then(([world, data]) => {
        if (cancelled) return;
        const topo = (world.default ?? world) as unknown as Topology<{
          countries: GeometryCollection<{ name: string }>;
        }>;
        const fc = feature(topo, topo.objects.countries);
        const keys = countryKeys(fc.features.map((f) => ({ id: f.id, name: f.properties.name })));
        setFeatures(fc.features.map((f, i) => ({ ...f, key: keys[i] })));
        setCountries(Object.fromEntries(data.countries.map((c) => [c.id, c])));
        setTrade(data.trade);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  const path = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent(
      [
        [8, 8],
        [WIDTH - 8, HEIGHT - 8],
      ],
      { type: "Sphere" },
    );
    return geoPath(projection);
  }, []);

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
      .on("zoom", (e) => g.attr("transform", e.transform.toString()));
    select(svgRef.current).call(z);
    zoomRef.current = z;
  }, []);

  const resetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, zoomIdentity);
    }
  };

  const onMove = (key: string, e: React.PointerEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHover({ key, x, y, flipX: x > rect.width - 180, flipY: y > rect.height - 110 });
  };

  const hovered = hover ? countries[hover.key] : undefined;
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
          className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
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
            {features.map((f) => {
              const c = countries[f.key];
              const isSel = f.key === selected;
              const isHover = f.key === hover?.key;
              const share = c?.stats.topExport?.share;
              return (
                <path
                  key={f.key}
                  d={path(f) ?? ""}
                  fill={
                    isSel ? "var(--selected)" : share === undefined ? "var(--land)" : shareFill(share)
                  }
                  stroke={isHover || isSel ? "var(--foreground)" : "var(--border-country)"}
                  strokeWidth={isHover || isSel ? 1.25 : 0.5}
                  vectorEffect="non-scaling-stroke"
                  className="cursor-pointer transition-[fill] duration-150"
                  onPointerMove={(e) => onMove(f.key, e)}
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
            className="pointer-events-none absolute z-10 min-w-40 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs shadow-lg"
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
              Top export: goods only{trade ? `, ${trade.year}, from ${trade.source}` : ""}. Note 2
              and Note 3 are filler values.
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

function StatRows({ country, large }: { country: Country; large?: boolean }) {
  const top = country.stats.topExport;
  const rows: [string, React.ReactNode][] = [
    [
      "Top Export",
      top ? (
        <>
          {top.label}
          {large && (
            <div className="text-xs font-normal text-[var(--muted)]">
              {formatShare(top.share)} of exports · {formatUsd(top.valueUsd)}
            </div>
          )}
        </>
      ) : (
        <span className="text-[var(--muted)]">No data</span>
      ),
    ],
    ["Note 2", `${country.stats.note2.toFixed(1)}%`],
    ["Note 3", country.stats.note3.toLocaleString()],
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
