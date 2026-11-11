// On Vercel the game server runs here, inside the website (see apps/server/src/serverless.ts).
// Locally and on Fly.io, next.config.ts proxies /api to the standalone game server instead,
// so this handler is never reached there.
import { handle } from '@mon/server/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
