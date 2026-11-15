import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173" },
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

io.on("connection", (socket) => {
  console.info(`Socket connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.info(`Socket disconnected: ${socket.id}`);
  });
});

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  console.info(`Server listening on http://localhost:${port}`);
});
