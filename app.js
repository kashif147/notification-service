// Load .env file based on environment
if (process.env.NODE_ENV === "staging") {
  require("dotenv-flow").config({ nodeEnv: "staging" });
} else if (process.env.NODE_ENV !== "production") {
  require("dotenv-flow").config({ nodeEnv: "development" });
}
// Production uses Azure Application Settings

// Suppress Application Insights warnings if not configured
// Azure App Service auto-injects Application Insights, but warnings appear if key is missing
if (
  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING &&
  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING.trim() === ""
) {
  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = undefined;
}
if (
  !process.env.APPINSIGHTS_INSTRUMENTATIONKEY ||
  process.env.APPINSIGHTS_INSTRUMENTATIONKEY.trim() === ""
) {
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function (chunk, encoding, callback) {
    const message = chunk.toString();
    if (
      message.includes("ApplicationInsights") &&
      (message.includes("instrumentation key") || message.includes("iKey"))
    ) {
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  };

  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  console.warn = function (...args) {
    const message = args.join(" ");
    if (
      message.includes("ApplicationInsights") &&
      (message.includes("instrumentation key") || message.includes("iKey"))
    ) {
      return;
    }
    originalConsoleWarn.apply(console, args);
  };

  console.error = function (...args) {
    const message = args.join(" ");
    if (
      message.includes("ApplicationInsights") &&
      (message.includes("instrumentation key") || message.includes("iKey"))
    ) {
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

const express = require("express");
const compression = require("compression");
const pinoHttp = require("pino-http");
const helmet = require("helmet");
const { corsMiddleware } = require("./config/cors.js");
const { limiterGeneral } = require("./config/rateLimiters.js");
const logger = require("./config/logger.js");
const requestId = require("./middlewares/requestId.js");
const loggerMiddleware = require("./middlewares/logger.mw.js");
const responseMiddleware = require("./middlewares/response.mw.js");
const notFound = require("./middlewares/notFound.js");
const errorHandler = require("./middlewares/errorHandler.js");
const {
  initEventSystem,
  setupConsumers,
  shutdownEventSystem,
} = require("./rabbitMQ/index.js");
const bodyParser = require("body-parser");
const firebaseRoutes = require("./routes/firebase.route.js");

const app = express();

// Disable Express automatic ETag generation (304 responses)
app.set("etag", false);

// Initialize event system - Now using middleware
let eventSystemInitialized = false;

async function initializeEventSystem() {
  if (!process.env.RABBIT_URL) {
    logger.warn("RABBIT_URL not configured, skipping RabbitMQ initialization");
    return;
  }

  try {
    logger.info("RabbitMQ URL configured, initializing with middleware...");
    await initEventSystem();
    await setupConsumers();
    eventSystemInitialized = true;
    logger.info("Event system initialized successfully with middleware");
  } catch (error) {
    logger.warn(
      { error: error.message },
      "Event system initialization failed, continuing without messaging"
    );
  }
}

// Initialize event system on startup
initializeEventSystem();

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  if (eventSystemInitialized) {
    await shutdownEventSystem();
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  if (eventSystemInitialized) {
    await shutdownEventSystem();
  }
  process.exit(0);
});

app.use(pinoHttp({ logger }));
// app.use(corsMiddleware);
// Security headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
app.use(compression());
// Body parsing with size limits
app.use(express.json({ limit: "200mb", strict: true }));
app.use(
  express.urlencoded({ extended: true, limit: "200mb", parameterLimit: 100 })
);

app.use(requestId);
app.use(loggerMiddleware);
app.use(responseMiddleware);
app.use(limiterGeneral);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use("/api/firebase", firebaseRoutes);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "UP" });
});

app.get("/health/events", (req, res) => {
  res.success({
    status: eventSystemInitialized ? "healthy" : "initializing",
    initialized: eventSystemInitialized,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.success({
    service: "Notification Service",
    version: "1.0.0",
    status: "running",
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      health: "/health",
      events: "/health/events",
    },
    timestamp: new Date().toISOString(),
  });
});

// TODO: Add routes here when needed
// app.use("/api/notifications", notificationRoutes);

app.use(notFound);
// app.use(corsErrorHandler);
app.use(errorHandler);

module.exports = app;
