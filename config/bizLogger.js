const { createLogger } = require("@projectShell/logging-lib");

module.exports = createLogger(process.env.SERVICE_NAME || "notification-service");
