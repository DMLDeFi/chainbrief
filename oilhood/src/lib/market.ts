import { cached, fetchWithTimeout } from "./cache";
import type { MarketResponse, Quote, QuoteSource } from "./types";

interface Instrument {
  id: string;
  name: string;
  unit: string;
  yahoo: string;
  stooq: string;
  /** Rough reference level used only for clearly-labelled demo data. */
  demoBase: number;
}

export const INSTRUMENTS: Instrument[] = [
  { id: "wti", name: "WTI Crude", unit: "USD/bbl", yahoo: "CL=F", stooq: "cl.f", demoBase: 68 },
  { id: "brent", name: "Brent Crude", unit: "USD/bbl", yahoo: "BZ=F", stooq: "cb.f", demoBase: 72 },
  { id: "natgas", name: "Natural Gas", unit: "USD/MMBtu", yahoo: "NG=F", stooq: "ng.f", demoBase: 3.1 },
  { id: "gasoline", name: "RBOB Gasoline", unit: "USD/gal", yahoo: "RB=F", stooq: "rb.f", demoBase: 2.05 },
  { id: "uso", name: "United States Oil Fund", unit: "USD", yahoo: "USO", stooq: "uso.us", demoBase: 75 },
  { id: "xom", name: "Exxon Mobil", unit: "USD", yahoo: "XOM", stooq: "xom.us", demoBase: 112 },
];

function build(
  inst: Instrument,
  price: number,
  previousClose: number | null,
  history: number[],
  source: QuoteSource,
): Quote {
  const change = previousClose ? price - previousClose : null;
  return {
    id: inst.id,
    symbol: inst.yahoo,
    name: inst.name,
    unit: inst.unit,
    price,
    previousClose,
    change,
    changePct: change !== null && previousClose ? (change / previousClose) * 100 : null,
    history,
    source,
    updatedAt: new Date().toISOString(),
  };
}

async function fromYahoo(inst: Instrument): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.yahoo)}?range=5d&interval=1h`;
  const json = await (await fetchWithTimeout(url)).json();
  const result = json?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`yahoo: no price for ${inst.yahoo}`);
  const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? [];
  const history = closes.filter((v): v is number => typeof v === "number");
  const prev = result?.meta?.previousClose ?? result?.meta?.chartPreviousClose ?? null;
  return build(inst, price, typeof prev === "number" ? prev : null, history, "yahoo");
}

async function fromStooq(inst: Instrument): Promise<Quote> {
  const url = `https://stooq.com/q/l/?s=${inst.stooq}&f=sd2t2ohlcp&h&e=csv`;
  const text = await (await fetchWithTimeout(url)).text();
  const [header, row] = text.trim().split(/\r?\n/);
  if (!header || !row) throw new Error("stooq: empty");
  const cols = header.toLowerCase().split(",");
  const vals = row.split(",");
  const get = (name: string) => Number(vals[cols.indexOf(name)]);
  const close = get("close");
  if (!Number.isFinite(close)) throw new Error(`stooq: no price for ${inst.stooq}`);
  const prev = get("prev");
  const open = get("open");
  const history = [open, get("low"), get("high"), close].filter(Number.isFinite);
  return build(inst, close, Number.isFinite(prev) ? prev : null, history, "stooq");
}

/** Deterministic-ish demo series so the UI still works offline. Always flagged as demo. */
function demo(inst: Instrument): Quote {
  const seed = Math.floor(Date.now() / 60_000);
  const phase = [...inst.id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const history = Array.from({ length: 40 }, (_, i) => {
    const t = seed - 40 + i + phase;
    return inst.demoBase * (1 + 0.012 * Math.sin(t / 5) + 0.006 * Math.sin(t / 1.7));
  });
  return build(inst, history[history.length - 1], history[0], history, "demo");
}

async function quote(inst: Instrument): Promise<Quote> {
  try {
    return await fromYahoo(inst);
  } catch {
    try {
      return await fromStooq(inst);
    } catch {
      return demo(inst);
    }
  }
}

export function getMarket(): Promise<MarketResponse> {
  return cached("market", 60_000, async () => {
    const list = await Promise.all(INSTRUMENTS.map(quote));
    return {
      quotes: Object.fromEntries(list.map((q) => [q.id, q])),
      demo: list.some((q) => q.source === "demo"),
      updatedAt: new Date().toISOString(),
    };
  });
}
