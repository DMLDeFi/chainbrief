import { ImageResponse } from "next/og";

export const alt = "$OILHOOD — The oil of the people on Robinhood Chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          padding: 72, background: "radial-gradient(70% 60% at 75% 0%, rgba(245,184,61,0.28), #07070a 70%)", color: "#ede4cf",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 40, fontWeight: 700 }}>
          <svg width="56" height="56" viewBox="0 0 32 32"><path d="M16 2.5c5.6 7 9.5 12.4 9.5 17a9.5 9.5 0 0 1-19 0c0-4.6 3.9-10 9.5-17Z" fill="#f5b83d" /></svg>
          OilHood Terminal
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 120, fontWeight: 800, color: "#f5b83d", letterSpacing: -4 }}>$OILHOOD</div>
          <div style={{ fontSize: 44, color: "#8d8a99" }}>The oil of the people on Robinhood Chain.</div>
        </div>
        <div style={{ display: "flex", gap: 40, fontSize: 28, color: "#ede4cf" }}>
          <span>Live WTI &amp; Brent</span><span>Tokenized USO · XOM</span><span>Virtual Barrels</span>
        </div>
      </div>
    ),
    size,
  );
}
