#!/usr/bin/env node

const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const dotenvFlow = require("dotenv-flow");
dotenvFlow.config();

const NotificationHistory = require("../models/notificationHistory.model");

const {
  shutdownEventSystem,
  setSocketIO,
  setOnlineUsers,
  initEventSystem,
  setupConsumers,
} = require("../rabbitMQ");

const { disconnectDB } = require("../config/db.js");
const logger = require("../config/logger.js");
const app = require("../app.js");

let server;

async function start() {
  const port = Number(process.env.PORT || 4010);

  const httpServer = http.createServer(app);

  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const onlineUsers = new Map(); // tenant:user -> Set(socketIds)

  // JWT auth
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Unauthorized"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      socket.user = {
        userId: decoded.id,
        tenantId: decoded.tenantId,
      };

      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    try {
      const { userId, tenantId } = socket.user;
      const userKey = `${tenantId}:${userId}`;

      socket.join(`tenant:${tenantId}`);
      socket.join(`user:${userId}`);

      if (!onlineUsers.has(userKey)) {
        onlineUsers.set(userKey, new Set());
      }

      onlineUsers.get(userKey).add(socket.id);

      logger.info({ userKey }, "Socket connected");

      // 🔹 Emit unread count on connect
      const unreadCount = await NotificationHistory.countDocuments({
        tenantId,
        userId,
        isRead: false,
      });

      socket.emit("unreadCount", { count: unreadCount });

      // 🔹 Listen for mark single notification as read
      socket.on("markAsRead", async ({ notificationId }) => {
        const notification = await NotificationHistory.findOneAndUpdate(
          { _id: notificationId, tenantId, userId },
          { isRead: true, readAt: new Date() },
          { new: true },
        );

        if (notification) {
          io.to(`user:${userId}`).emit("badgeDecrement", { count: 1 });
        }
      });

      // 🔹 Listen for mark all as read
      socket.on("markAllAsRead", async () => {
        await NotificationHistory.updateMany(
          { tenantId, userId, isRead: false },
          { isRead: true, readAt: new Date() },
        );

        io.to(`user:${userId}`).emit("badgeReset");
      });

      socket.on("disconnect", () => {
        const userSockets = onlineUsers.get(userKey);
        if (userSockets) {
          userSockets.delete(socket.id);
          if (userSockets.size === 0) {
            onlineUsers.delete(userKey);
          }
        }
        logger.info({ userKey }, "Socket disconnected");
      });
    } catch (err) {
      logger.error({ err }, "Socket connection error");
    }
  });

  // Inject into Rabbit layer
  setSocketIO(io);
  setOnlineUsers(onlineUsers);

  await initEventSystem();
  await setupConsumers();

  logger.info("RabbitMQ initialized and consumers registered");

  server = httpServer.listen(port, () => {
    logger.info({ port }, "API + Socket.IO listening");
  });
}

async function shutdown(signal) {
  try {
    logger.info({ signal }, "Shutting down");
    if (server) {
      await new Promise((res) => server.close(res));
    }
    await Promise.allSettled([shutdownEventSystem(), disconnectDB()]);
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
