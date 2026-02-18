// implementing socket.io for real-time communication
let ioInstance = null;

function setSocketIO(io) {
  ioInstance = io;
}

function getSocketIO() {
  return ioInstance;
}

let onlineUsersInstance = null;

function setOnlineUsers(map) {
  onlineUsersInstance = map;
}

function getOnlineUsers() {
  return onlineUsersInstance;
}

//--------------------------------
// Main RabbitMQ module exports - Now using shared middleware
const {
  init,
  publisher,
  consumer,
  EVENT_TYPES: MIDDLEWARE_EVENT_TYPES,
  shutdown,
} = require("@projectShell/rabbitmq-middleware");

const logger = require("../config/logger.js");

// Re-export for convenience
const EVENT_TYPES = MIDDLEWARE_EVENT_TYPES;

// Initialize event system
async function initEventSystem() {
  try {
    await init({
      url: process.env.RABBIT_URL,
      logger: logger,
      prefetch: 10,
      connectionName: "notification-service",
      serviceName: "notification-service",
    });
    logger.info("Event system initialized with middleware");
  } catch (error) {
    logger.error({ error: error.message }, "Failed to initialize event system");
    throw error;
  }
}

// Publish events with standardized payload structure using middleware
async function publishDomainEvent(eventType, data, metadata = {}) {
  const result = await publisher.publish(eventType, data, {
    tenantId: metadata.tenantId,
    correlationId: metadata.correlationId || generateEventId(),
    metadata: {
      service: "notification-service",
      version: "1.0",
      ...metadata,
    },
  });

  if (result.success) {
    logger.info(
      { eventType, eventId: result.eventId },
      "Domain event published",
    );
  } else {
    logger.error(
      { eventType, error: result.error },
      "Failed to publish domain event",
    );
  }

  return result.success;
}

// Set up consumers for different event types using middleware
async function setupConsumers() {
  try {
    logger.info("Setting up RabbitMQ consumers...");

    const NOTIFICATION_QUEUE = "notification.events";

    // 1. Create queue
    await consumer.createQueue(NOTIFICATION_QUEUE, {
      durable: true,
      messageTtl: 3600000, // 1 hour (optional)
    });

    // 2. Bind queue to exchange + routing keys
    await consumer.bindQueue(NOTIFICATION_QUEUE, "batch.events", [
      "batch.completed",
    ]);

    // 3. Import listener
    const batchCompletedListener = require("./listeners/batchCompleted.listener");

    // 4. Register handler
    consumer.registerHandler("batch.completed", async (payload, context) => {
      await batchCompletedListener(payload, context);
    });

    // 5. Start consuming
    await consumer.consume(NOTIFICATION_QUEUE, { prefetch: 10 });

    logger.info("Notification events consumer ready", {
      queue: NOTIFICATION_QUEUE,
    });

    logger.info("All consumers set up successfully");
  } catch (error) {
    logger.error({ error: error.message }, "Failed to set up consumers");
    throw error;
  }
}

// Utility function
function generateEventId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Graceful shutdown using middleware
async function shutdownEventSystem() {
  try {
    await shutdown();
    logger.info("Event system shutdown complete");
  } catch (error) {
    logger.error(
      { error: error.message },
      "Error during event system shutdown",
    );
  }
}

// Export middleware components
module.exports = {
  init,
  publisher,
  consumer,
  shutdown,
  initEventSystem,
  setupConsumers,
  shutdownEventSystem,
  publishDomainEvent,
  EVENT_TYPES,
  setSocketIO,
  getSocketIO,
  setOnlineUsers,
  getOnlineUsers,
};
