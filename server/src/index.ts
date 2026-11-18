import { createApplication } from "./app.js";

const { httpServer } = createApplication();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

httpServer.listen(port, host, () => {
  const browserHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  console.info(`Bela za dvoje is running at http://${browserHost}:${port}/`);
  if (process.env.NODE_ENV !== "production") console.info("Development frontend: http://localhost:5173/");
});
