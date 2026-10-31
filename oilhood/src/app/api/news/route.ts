import { getNews } from "@/lib/news";

export async function GET() {
  return Response.json(await getNews(), {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" },
  });
}
