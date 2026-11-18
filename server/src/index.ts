import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createLocalGameRouter } from "./dev/local-game-api.js";
import { attachMultiplayerHandlers, type ClientToServerEvents, type InterServerEvents, type ServerToClientEvents, type SocketData } from "./multiplayer/socket-events.js";

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" },
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

if (process.env.NODE_ENV !== "production") {
  app.use("/api/dev", createLocalGameRouter());
}

attachMultiplayerHandlers(io);

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  console.info(`Backend API listening on http://localhost:${port}`);
  console.info("Open the frontend at http://localhost:5173/");
});
