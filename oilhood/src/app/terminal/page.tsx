import type { Metadata } from "next";
import { TerminalDashboard } from "@/components/TerminalDashboard";

export const metadata: Metadata = {
  title: "Terminal",
  description: "Live WTI & Brent, tokenized USO and XOM on Robinhood Chain, $OILHOOD stats, virtual barrels, alerts and energy news.",
};

export default function TerminalPage() {
  return <TerminalDashboard />;
}
