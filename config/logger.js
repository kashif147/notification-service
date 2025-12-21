const pino = require("pino");
const pretty = require("pino-pretty");

const stream =
  process.env.NODE_ENV === "production"
    ? undefined
    : pretty({
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      });

const logger = pino({}, stream);

module.exports = logger;
