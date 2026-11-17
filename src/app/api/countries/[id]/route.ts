import { getCountry } from "@/lib/countries";

export async function GET(_req: Request, ctx: RouteContext<"/api/countries/[id]">) {
  const { id } = await ctx.params;
  const country = getCountry(id);
  if (!country) {
    return Response.json({ error: "Country not found" }, { status: 404 });
  }
  return Response.json(country);
}
