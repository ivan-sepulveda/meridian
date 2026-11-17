import { getCountries } from "@/lib/countries";

// No request input, so Next prerenders this response at build time.
export async function GET() {
  return Response.json({ countries: getCountries() });
}
