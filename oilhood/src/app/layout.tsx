import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { site } from "@/config/site";
import { wagmiConfig } from "@/lib/wagmi";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Ticker } from "@/components/Ticker";
import "./globals.css";

const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.ticker} — OilHood Terminal`, template: `%s · OilHood` },
  description: `${site.tagline} Live WTI & Brent, tokenized USO and XOM, and your $OILHOOD bag in virtual barrels.`,
  openGraph: { type: "website", siteName: "OilHood", title: `${site.ticker} — OilHood Terminal`, description: site.tagline },
  twitter: { card: "summary_large_image", title: `${site.ticker} — OilHood Terminal`, description: site.tagline },
};

export const viewport: Viewport = { themeColor: "#07070a" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get("cookie"));
  return (
    <html lang="en" className={`${grotesk.variable} ${jetbrains.variable} antialiased`}>
      <body className="flex min-h-screen flex-col font-sans">
        <Providers initialState={initialState}>
          <Ticker />
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
