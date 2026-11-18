# Bela za dvoje

A two-player Croatian Bela application with a React + TypeScript + Vite client and a Node.js + Express + TypeScript + Socket.IO backend. The server owns dealing, adut bidding, legal plays, trick transitions, declarations, Bela, scoring, dealer rotation, and private player views. Rooms and matches are stored in memory; SQLite is not configured.

The Mađarice card artwork is served from `client/public/cards`; suit icons are in `client/public/cards/suits`. Source suits map heart/bell/acorn/leaf to `srce`/`tikva`/`žir`/`zelje`. Source Unter maps to J and Ober maps to Q.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Install

Run these commands once from the repository root:

```sh
npm install
npm install --prefix client
npm install --prefix server
```

## Development

From the root, run:

```sh
npm run dev
```

Open the frontend URL printed by Vite (normally [http://localhost:5173](http://localhost:5173)). The backend listens on port 3000, and Vite proxies API and Socket.IO requests to it. The Vite development server is for local development only; do not expose it publicly.

To use the local hot-seat test interface, open `http://localhost:5173/?dev=1`. Development mode shows one player hand at a time and includes the local player-switch control. This interface is compiled out of the production route and is not multiplayer authentication.

## Online multiplayer

1. Open the application in one browser and choose **Kreiraj sobu**.
2. Share the six-character room code with the second player.
3. The second player opens the same application link, enters the code, and chooses **Pridruži se sobi**.
4. The creator starts the match after both room seats show as connected.
5. During a completed trick, both players see the result for about 1.5 seconds. After a round, each player confirms readiness before the next round is dealt.

The server sends each seat its own filtered game state; opponent hands and unrevealed cards are never included in that player's view. Refreshing restores the existing seat and match using the browser's private session token. A newer connection using that token replaces the previous socket. If a player disconnects, the match pauses and resumes when they reconnect. A round transition requires both players' confirmations, then the dealer alternates.

## Build and host from Windows

The production server serves the compiled frontend, REST endpoints, and Socket.IO from one port. The production frontend uses the current page origin, so it works through the HTTPS tunnel without a configured temporary URL. Socket.IO can upgrade to WebSocket on the same proxied origin; Cloudflare Tunnel supports WebSockets without additional application configuration ([Cloudflare WebSocket docs](https://developers.cloudflare.com/network/websockets/)). The server binds to `127.0.0.1` by default, so no inbound router port forwarding or public IP is needed.

1. Install dependencies using the commands above.
2. Run `build-game.bat` from Explorer or Command Prompt. This builds the client into `client/dist` and the backend into `server/dist`. Re-run this after changing application code.
3. Run `start-game.bat`. It starts the existing production build without rebuilding, and prints the local URL (default `http://localhost:3000/`). Keep its window open.
4. Download `cloudflared` for Windows from [Cloudflare's official download page](https://developers.cloudflare.com/tunnel/downloads/). Add it to `PATH`, or run it from the folder where its executable is saved.
5. In a second Command Prompt window, run:

   ```bat
   cloudflared tunnel --url http://localhost:3000
   ```

6. Copy the generated `https://….trycloudflare.com` URL from the terminal and share it with your girlfriend. Do not put room session tokens in URLs or messages.
7. Both players open that same HTTPS link. One creates a room and shares the room code; the other joins with the code. There is no public room listing.
8. To stop hosting, press Ctrl+C in the `cloudflared` window, then press Ctrl+C in the `start-game.bat` window.

You can change the production listener before starting by setting `PORT` and/or `HOST` in the Command Prompt. For example, `set PORT=3100` changes the server port; use the same port in the tunnel command. `HOST` defaults to `127.0.0.1`. `CLIENT_ORIGIN` is optional and accepts a comma-separated list of exact origins for a separately hosted frontend; leave it unset for the single-origin tunnel setup.

The host PC must remain powered on, and both the server and tunnel windows must stay open. Closing either disconnects remote players. Rooms and matches are in memory and disappear if the backend restarts. Quick Tunnel URLs can change between sessions and are intended for private testing, not guaranteed availability. Anyone with the link can reach the app, so share it only with trusted people. Cloudflare documents Quick Tunnels as temporary testing links and provides the current Windows download from its [Tunnel downloads page](https://developers.cloudflare.com/tunnel/downloads/) and [Quick Tunnel guide](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Production disables the local `/api/dev` endpoints. Socket.IO actions require the player's current authenticated room socket, payload sizes are limited, and game state is emitted separately to each seat.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
