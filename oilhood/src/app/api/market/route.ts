import { getMarket } from "@/lib/market";

export async function GET() {
  return Response.json(await getMarket(), {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
