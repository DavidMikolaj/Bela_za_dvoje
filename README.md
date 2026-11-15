# Bela za dvoje

A two-player Croatian Bela application with a React + TypeScript + Vite client and a Node.js + Express + TypeScript backend. The backend contains the Mađarice deck, shuffle, deal, adut bidding, and dealer rotation engine. SQLite configuration will be added later.

The current browser table is a local hot-seat testing interface. It supports dealing, adut bidding, private hand handoffs, and development-only test-round transitions. Trick-taking, scoring, and zvanja are not implemented.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Install

```sh
npm install
npm install --prefix client
npm install --prefix server
```

## Start the application

From the repository root, run:

```sh
npm run dev
```

Open the **frontend** URL printed by Vite (normally [http://localhost:5173](http://localhost:5173), shown on the `[frontend] Local:` line). Port `3000` is the backend API and is not the game page. Vite proxies `/api` requests to that backend. If port 5173 is already occupied, use the alternate URL printed on the frontend line.

To test a match in the browser:

1. Select **New Match**. The server shuffles and deals the cards; Player 2 receives the first hand in round 1.
2. Use the displayed allowed adut action. Passing automatically hands the view to the next bidder. **Switch Player** can also hand off the device at any time.
3. Only the active local player's cards are sent to the browser. During bidding, they see their initial six; after adut is selected, they see all ten.
4. After adut selection, the table shows **Card play coming soon**. **End Test Round** ends the development test without awarding points. **Start Next Round** then starts the next round and rotates the dealer.
5. Refreshing the browser reloads the active player-specific view from the running backend. Match state is in memory, so restarting the backend resets the test match.

The hot-seat switch and game routes are development-only and are not multiplayer authentication. The scoreboard remains at zero because scoring is not implemented.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
