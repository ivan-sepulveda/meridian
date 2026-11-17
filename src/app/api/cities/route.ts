import { citiesSource, getCities } from "@/lib/cities";

// No request input, so Next prerenders this response at build time.
export async function GET() {
  return Response.json({ cities: getCities(), source: citiesSource });
}
