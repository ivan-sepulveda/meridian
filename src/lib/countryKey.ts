type Item = { id?: string | number; name: string };

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Stable, unique keys for countries. Natural Earth uses ISO 3166-1 numeric codes
 * as ids, but a few disputed territories (Kosovo, N. Cyprus, Somaliland…) have
 * none, and some share a parent's code (Australia / Ashmore and Cartier Is. are
 * both 036). Unique ids are used as-is; missing ones become a name slug, and
 * shared ones become `<id>-<slug>`. Shared by the API and the map, so both sides
 * derive the same keys from the same data.
 */
export function countryKeys(items: Item[]): string[] {
  const counts = new Map<string, number>();
  for (const { id } of items) {
    if (id !== undefined && id !== "") counts.set(String(id), (counts.get(String(id)) ?? 0) + 1);
  }
  return items.map(({ id, name }) => {
    if (id === undefined || id === "") return slug(name);
    const s = String(id);
    return counts.get(s)! > 1 ? `${s}-${slug(name)}` : s;
  });
}
