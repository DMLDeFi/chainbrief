import { cached, fetchWithTimeout } from "./cache";
import type { NewsItem } from "./types";

const FEEDS = [
  { source: "OilPrice.com", url: "https://oilprice.com/rss/main" },
  { source: "EIA Today in Energy", url: "https://www.eia.gov/rss/todayinenergy.xml" },
  { source: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx" },
];

const FALLBACK: NewsItem[] = [
  { title: "EIA Weekly Petroleum Status Report", link: "https://www.eia.gov/petroleum/supply/weekly/", source: "EIA", publishedAt: null },
  { title: "OPEC Monthly Oil Market Report", link: "https://www.opec.org/opec_web/en/publications/338.htm", source: "OPEC", publishedAt: null },
  { title: "IEA Oil Market Report", link: "https://www.iea.org/topics/oil-market-report", source: "IEA", publishedAt: null },
  { title: "Baker Hughes Rig Count", link: "https://rigcount.bakerhughes.com/", source: "Baker Hughes", publishedAt: null },
  { title: "Latest crude oil news", link: "https://oilprice.com/Energy/Crude-Oil/", source: "OilPrice.com", publishedAt: null },
];

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .trim();
}

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

async function readFeed(feed: (typeof FEEDS)[number]): Promise<NewsItem[]> {
  const xml = await (await fetchWithTimeout(feed.url)).text();
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, 10).flatMap((block) => {
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !/^https?:\/\//.test(link)) return [];
    const date = tag(block, "pubDate") || tag(block, "dc:date");
    const parsed = date ? new Date(date) : null;
    return [{
      title,
      link,
      source: feed.source,
      publishedAt: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    }];
  });
}

export function getNews(): Promise<{ items: NewsItem[]; live: boolean }> {
  return cached("news", 10 * 60_000, async () => {
    const results = await Promise.allSettled(FEEDS.map(readFeed));
    const items = results
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, 15);
    return items.length ? { items, live: true } : { items: FALLBACK, live: false };
  });
}
