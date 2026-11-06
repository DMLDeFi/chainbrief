# Deploying to Fly.io

The whole game runs in **one Fly machine**. Inside the container:

- The game server listens on port 8080 (the port Fly routes to). It handles `/api` and the live `/ws` stream itself.
- Every other request goes to the Next.js app, which runs on `127.0.0.1:3000` in the same container.

Players therefore use a single `https://<app>.fly.dev` origin for pages, the session cookie and the WebSocket.

The world simulation lives in that one process, so run **exactly one machine** and never let Fly stop it (`fly.toml` already sets this).

## 1. Prerequisites

Install flyctl (https://fly.io/docs/flyctl/install/), then sign in:

```bash
fly auth login
```

## 2. Create the app and its volume

Edit `app = "merchants-of-near"` in `fly.toml` to a globally unique name, then from `merchants-of-near/`:

```bash
fly apps create <your-app-name>
```

```bash
fly volumes create mon_data --size 1 --region iad --app <your-app-name>
```

The volume holds the world snapshot, accounts and ledger (the JSON store at `/data`).

## 3. Set secrets

To use the testnet deployment from this project, take the values from `near-testnet-keys.txt` (section 1):

```bash
fly secrets set --app <your-app-name> NEAR_CONTRACT_ID=mon-game-190cff.testnet GAME_AUTHORITY_SECRET=<64-hex-secret>
```

Or deploy your own contract first with `node scripts/deploy-testnet.mjs` and use the values it writes into `.env`.

Optional, for Claude-voiced merchants:

```bash
fly secrets set --app <your-app-name> ANTHROPIC_API_KEY=<key>
```

Without the NEAR secrets the game still runs; on-chain features show "not configured".

## 4. Deploy

```bash
fly deploy --app <your-app-name>
```

```bash
fly scale count 1 --app <your-app-name>
```

Then open `https://<your-app-name>.fly.dev`. The health check is `GET /api/health`.

## Optional: PostgreSQL instead of the volume

```bash
fly postgres create --name <your-app-name>-db --region iad
```

```bash
fly postgres attach <your-app-name>-db --app <your-app-name>
```

`attach` sets the `DATABASE_URL` secret. On start, the container runs `prisma db push` to create the tables and then uses PostgreSQL. You can keep or delete the `[[mounts]]` block.

## Operational notes

- **Shutdown and restarts:** Fly sends SIGTERM on deploys and restarts. The server saves the world snapshot before exiting (`kill_timeout = 30`), and a new machine resumes from it.
- **Fast-forward:** it advances the shared world for every player, so `fly.toml` turns it off (`ALLOW_FAST_FORWARD = "false"`), and the Fast-forward button and demo step are hidden. Set it to `"true"` only for a private demo server.
- **Tick speed:** `TICK_MS` sets the speed (2000 ms is one in-game hour).
- **Logs:** run `fly logs --app <your-app-name>`.
- **Testing the container locally:**
  ```bash
  docker build -t mon .
  ```
  ```bash
  docker run -p 8080:8080 -v mon-data:/data mon
  ```
  Without Docker, `PORT=8080 DATA_DIR=./data bash scripts/start-prod.sh` runs the same production setup after `npm run build -w @mon/web`.
