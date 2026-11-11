# Deploying to Vercel (free)

On Vercel the game server runs inside the website's `/api` route (`apps/server/src/serverless.ts`), with the world and accounts in a free Postgres database.

How it behaves:

- **Time:** the world moves in real time while anyone is playing. With nobody online it pauses, then resumes when the next player arrives.
- **Updates:** browsers refresh the world every two seconds instead of holding a live WebSocket.
- **Saving:** every player action is saved to the database before the response is sent.
- **Fast-forward:** off, unless `ALLOW_FAST_FORWARD=true` is set.

## 1. Import the project

1. On vercel.com, click **Add New… → Project** and import the `chainbrief` GitHub repository.
2. Set **Root Directory** to `merchants-of-near/apps/web`. Vercel detects Next.js.
3. Leave the build settings as they are. The `vercel-build` script creates the database tables, then builds the site.

## 2. Add the database

1. In the new project, open **Storage → Create Database → Neon** (free plan).
2. Connect it to the project for all environments. This sets `DATABASE_URL` automatically.

## 3. Optional: NEAR deeds

Under **Settings → Environment Variables**, add:

- `NEAR_CONTRACT_ID` = `mon-game-0ebe9a.testnet`
- `GAME_AUTHORITY_SECRET` = the value from your local `.env`

Without them the game runs normally, and the NEAR features show "not configured".

## 4. Deploy

Click **Deploy**, or redeploy from the **Deployments** tab after adding the database. Open the `*.vercel.app` link when the build finishes. The first request after a quiet spell takes a second or two while the server wakes.

## Run the Vercel mode locally

```bash
cd apps/web
```

```bash
DATABASE_URL=postgresql://... MON_SERVERLESS=1 npm run vercel-build
```

```bash
DATABASE_URL=postgresql://... MON_SERVERLESS=1 COOKIE_SECURE=false npx next start
```
