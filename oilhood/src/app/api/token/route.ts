import { getTokens } from "@/lib/token";

export async function GET() {
  return Response.json(await getTokens(), {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
  });
}
