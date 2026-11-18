import express, { type Express } from "express";
import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketServer, type ServerOptions } from "socket.io";
import { createLocalGameRouter } from "./dev/local-game-api.js";
import { attachMultiplayerHandlers, type ClientToServerEvents, type InterServerEvents, type ServerToClientEvents, type SocketData } from "./multiplayer/socket-events.js";

export interface ApplicationOptions {
  readonly production?: boolean;
  readonly clientDistPath?: string;
  readonly clientOrigins?: string;
}

export interface BelaApplication {
  readonly app: Express;
  readonly httpServer: HttpServer;
  readonly io: SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
}

function parseOrigins(value: string | undefined): string[] {
  return value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
}

export function createApplication(options: ApplicationOptions = {}): BelaApplication {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const app = express();
  const httpServer = createServer(app);
  const origins = parseOrigins(options.clientOrigins ?? process.env.CLIENT_ORIGIN);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  if (!production) {
    app.use("/api/dev", createLocalGameRouter());
  } else {
    const clientDistPath = options.clientDistPath ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../client/dist");
    const indexPath = join(clientDistPath, "index.html");
    if (!existsSync(indexPath)) {
      throw new Error(`Production client build is missing: ${indexPath}. Run build-game.bat or npm run build first.`);
    }

    app.use("/api", (_request, response) => response.status(404).json({ error: "API endpoint not found." }));
    app.use(express.static(clientDistPath, { index: false, fallthrough: true }));
    app.use((request, response, next) => {
      const isApiPath = request.path === "/api" || request.path.startsWith("/api/");
      const isSocketPath = request.path === "/socket.io" || request.path.startsWith("/socket.io/");
      if (request.method !== "GET" || isApiPath || isSocketPath) return next();
      response.sendFile(indexPath, (error) => { if (error) next(error); });
    });
  }

  const socketOptions: Partial<ServerOptions> = {
    maxHttpBufferSize: 64 * 1024,
  };
  if (!production || origins.length) {
    socketOptions.cors = { origin: origins.length ? origins : ["http://localhost:5173"] };
  }
  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, socketOptions);
  attachMultiplayerHandlers(io);
  return { app, httpServer, io };
}
