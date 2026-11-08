# Sharing the game from your own computer (free)

Anyone with the link can play while your computer is on and the game is running.
It uses a free Cloudflare quick tunnel: no account or domain is needed.

## 1. Install cloudflared once

- **Windows:** `winget install --id Cloudflare.cloudflared`. You can also download `cloudflared-windows-amd64.exe` from https://github.com/cloudflare/cloudflared/releases and rename it to `cloudflared.exe`.
- **macOS:** `brew install cloudflared`
- **Linux:** see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## 2. Start the game in public mode

From `merchants-of-near/`:

```bash
npm run build
```

```bash
npm run start:public
```

Public mode serves everything from **http://localhost:4000**: the pages, the API and the live world stream. Fast-forward is turned off, so visitors cannot skip time for everyone.

## 3. Open the tunnel

In a second terminal:

```bash
cloudflared tunnel --url http://localhost:4000
```

It prints a link like `https://something-random.trycloudflare.com`. Send that link to players and judges.

## Notes

- The link changes every time you restart `cloudflared`. Keep both terminals open while people are playing.
- The world and accounts are your local save in `apps/server/data`.
- Music files in `apps/web/public/audio` are only played to you. Visitors through the tunnel hear the game's own soundtrack.
- NEAR features use the same testnet contract as local play.
- For a link that stays up when your computer is off, deploy to a host instead. See `docs/DEPLOY_FLY.md`.
