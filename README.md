# Bela za dvoje

A two-player Croatian Bela application with a React + TypeScript + Vite client and a Node.js + Express + TypeScript backend. The backend contains the Mađarice deck, shuffle, deal, adut bidding, dealer rotation, legal card play and trick-taking engine. SQLite configuration will be added later.

The normal browser route supports Stage 1 private multiplayer rooms, player seats, lobby connection status, reconnecting sessions, and an explicit creator start. The existing local hot-seat game remains available at `?dev=1`. Multiplayer game actions are reserved for Stage 2.

The provided Mađarice artwork is served from `client/public/cards`; suit icons are in `client/public/cards/suits`. Source suits map heart/bell/acorn/leaf to srce/tikva/žir/zelje. Source Unter maps to J and Ober maps to Q. The selected adut and its suit icon remain visible for the round.

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

Open the **frontend** URL printed by Vite (normally [http://localhost:5173](http://localhost:5173), shown on the `[frontend] Local:` line). Port `3000` is the backend and is not the game page. Vite proxies `/api` and Socket.IO connections to that backend. If port 5173 is already occupied, startup reports the port error.

## Online multiplayer Stage 1

1. Open the frontend in one browser and choose **Kreiraj sobu**.
2. Share the six-character room code with the second player.
3. Open the frontend in a separate browser or private window, enter the code, and choose **Pridruži se sobi**.
4. The creator starts the match after both lobby slots show as connected. Stage 1 then displays a placeholder; game actions are not connected to multiplayer yet.

The server assigns Player 1 and Player 2 seats. The browser stores a private random session token in local storage so a refresh can resume the same seat. A newer connection using that token takes control of the seat. Public lobby updates contain room and connection status only; they do not contain session tokens. Rooms and sessions are held in memory and are removed when the backend restarts. If Player 2 explicitly leaves, that seat becomes available. If the creator explicitly leaves, the room closes.

To play a local browser test match, open `http://localhost:5173/?dev=1` first:

1. Select **New Match**. The server shuffles and deals the cards; Player 2 receives the first hand in round 1.
2. Use an allowed adut action. Passing hands off to the next bidder; **Switch Player** is also available.
3. After adut is selected, the non-dealer leads. Click a highlighted card to play it. The server checks turn order and legal plays, then hands the view to the other player.
4. Acknowledge each trick result to clear the table and let the winner lead the next trick. After trick 10, acknowledge the final result before **Start Next Round** becomes available; the dealer then alternates.
5. After trick 10, the round breakdown displays played-card points, declarations, Bela, last-trick and stiglja bonuses, then applies the caller's contract. Successful callers retain their respective totals; on failure or a tie, the other player receives the combined total. Match scores accumulate toward 1001.
6. **End Test Round** can end unfinished bidding or playing during development. It awards no points.
7. Refreshing the browser reloads the active player-specific view from the running backend. Match state is in memory, so restarting the backend resets the test match.

The local game and its hot-seat controls are available only through `http://localhost:5173/?dev=1`; they are not multiplayer authentication. Opponent hands remain server-side and are never included in a player-specific response.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
