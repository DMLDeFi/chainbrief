import path from 'node:path';
import type { NextConfig } from 'next';

const api = process.env.API_ORIGIN ?? 'http://localhost:4000';
// On Vercel (or with MON_SERVERLESS=1) the game server runs inside this app's /api route
// and clients poll for the world instead of holding a WebSocket open.
const serverless = process.env.VERCEL === '1' || process.env.MON_SERVERLESS === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Let phones and tablets on the same Wi-Fi open the dev server.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*', '*.local'],
  transpilePackages: ['@mon/engine', '@mon/server'],
  // Server-only packages stay as plain Node modules instead of being bundled.
  serverExternalPackages: ['fastify', '@fastify/cookie', '@fastify/rate-limit', '@fastify/websocket', '@fastify/http-proxy', 'pino', 'pg', '@prisma/client', '@prisma/adapter-pg', '@anthropic-ai/sdk'],
  // The monorepo root, so Vercel bundles the workspace packages the API route imports.
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  env: { NEXT_PUBLIC_REALTIME: serverless ? 'poll' : 'ws' },
  // The browser talks to the game server through this same origin, so the
  // httpOnly session cookie never has to cross origins.
  async rewrites() {
    // Standalone game server: proxy /api to it before the app's own routes are checked.
    return { beforeFiles: serverless ? [] : [{ source: '/api/:path*', destination: `${api}/api/:path*` }], afterFiles: [], fallback: [] };
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};
export default nextConfig;
