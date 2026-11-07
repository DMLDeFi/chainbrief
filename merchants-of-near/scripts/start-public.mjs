// Public mode for sharing the game from your own computer through a tunnel
// (for example Cloudflare: `cloudflared tunnel --url http://localhost:4000`).
//
// Everything is served from one address, port 4000: the game server handles
// /api and the live /ws stream, and passes every other request to the Next.js
// app on 127.0.0.1:3000. Fast-forward is turned off so visitors cannot skip
// time for everyone. Run `npm run build` first.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, ALLOW_FAST_FORWARD: process.env.ALLOW_FAST_FORWARD ?? 'false', WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000' };
const run = (name, args, cwd) => {
  const p = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${name}] ${l}\n`).join(''));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  return p;
};
const web = run('web', [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', '3000', '-H', '127.0.0.1'], path.join(root, 'apps/web'));
const server = run('server', ['--import', 'tsx', 'src/index.ts'], path.join(root, 'apps/server'));
console.log('\nPublic mode: open http://localhost:4000 (not 3000). Share it with:\n  cloudflared tunnel --url http://localhost:4000\n');
const stop = () => { server.kill('SIGINT'); setTimeout(() => web.kill('SIGINT'), 1500); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of [web, server]) p.on('exit', (code) => { stop(); setTimeout(() => process.exit(code ?? 0), 2000); });
