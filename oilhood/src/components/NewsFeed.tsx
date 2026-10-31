"use client";

import { useNews } from "@/hooks/useData";
import { timeAgo } from "@/lib/format";
import { DemoBadge, LiveDot } from "./DemoBadge";

export function NewsFeed() {
  const { data, isLoading } = useNews();
  return (
    <div className="panel flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="label flex items-center gap-2">{data?.live && <LiveDot />} Energy wire</p>
        {data && !data.live && <DemoBadge>Curated</DemoBadge>}
      </div>
      <ul className="-mx-2 flex-1 space-y-1 overflow-y-auto md:max-h-[420px]">
        {isLoading && Array.from({ length: 6 }, (_, i) => <li key={i} className="mx-2 my-3 h-10 animate-pulse rounded bg-rig" />)}
        {data?.items.map((n) => (
          <li key={n.link}>
            <a href={n.link} target="_blank" rel="noreferrer" className="group block rounded-lg px-2 py-2.5 transition hover:bg-rig">
              <p className="text-sm leading-snug text-sand group-hover:text-gold">{n.title}</p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-smoke">
                {n.source}{n.publishedAt && ` · ${timeAgo(n.publishedAt)}`}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
