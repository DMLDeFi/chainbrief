// Vercel build step: create or update the database tables before the site is built.
import { execSync } from 'node:child_process';
if (!process.env.DATABASE_URL) {
  console.error('\n[merchants-of-near] DATABASE_URL is not set.\nAdd a free Postgres database: Vercel project → Storage → Create Database → Neon, connect it to this project, then redeploy.\n');
  process.exit(1);
}
execSync('npx prisma db push', { stdio: 'inherit' });
