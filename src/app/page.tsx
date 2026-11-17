import WorldMap from "@/components/WorldMap";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Meridian</h1>
        <p className="text-sm text-[var(--muted)]">Explore the world, country by country.</p>
      </header>
      <WorldMap />
    </main>
  );
}
