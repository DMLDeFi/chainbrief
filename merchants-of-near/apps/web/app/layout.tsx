import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Merchants of NEAR — An AI-driven trading civilization',
  description: 'A living medieval economy of autonomous AI merchants. Trade, build businesses, and own your empire on NEAR.',
  icons: { icon: '/favicon.svg' },
};
export const viewport: Viewport = { themeColor: '#0e0b08', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-parchment antialiased">{children}</body>
    </html>
  );
}
