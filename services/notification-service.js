#!/usr/bin/env node

// Load .env file based on environment
if (process.env.NODE_ENV === "staging") {
  require("dotenv-flow").config({ nodeEnv: "staging" });
} else if (process.env.NODE_ENV !== "production") {
  require("dotenv-flow").config({ nodeEnv: "development" });
}
// Production uses Azure Application Settings

const { shutdownEventSystem } = require("../rabbitMQ/index.js");
const logger = require("../config/logger.js");
const app = require("../app.js");

let server;

async function start() {
  const port = Number(process.env.PORT || 4010);
  server = app.listen(port, () => {
    logger.info({ port }, "API listening");
  });
}

async function shutdown(signal) {
  try {
    logger.info({ signal }, "Shutting down");
    if (server) {
      await new Promise((res) => server.close(res));
    }
    await Promise.allSettled([shutdownEventSystem()]);
    process.exit(0);
  } catch (e) {
    logger.error(e, "Shutdown error");
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => {
  logger.error(err, "Unhandled rejection");
  shutdown("unhandledRejection");
});
process.on("uncaughtException", (err) => {
  logger.error(err, "Uncaught exception");
  shutdown("uncaughtException");
});

start().catch((err) => {
  logger.error({ err, stack: err.stack }, "Failed to start");
  process.exit(1);
});
