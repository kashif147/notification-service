// Responsible for orchestration:
// Save NotificationHistory
// Check onlineUsers
// Emit via Socket.IO if online
// Call notificationService.sendNotification() if offline
// notificationService = delivery channel
// notificationDispatcher = decision engine
// Tomorrow if you add:
// • Email
// • SMS
// • Slack
// • Teams
// • In-app only

// You extend dispatcher, not Firebase service.

const NotificationHistory = require("../models/notificationHistory.model");
const FCMToken = require("../models/fcmToken.model");
const notificationService = require("./notificationService");

async function dispatchNotification(event, io, onlineUsers) {
  const { tenantId, userId, title, body, metadata = {} } = event;

  const userKey = `${tenantId}:${userId}`;

  // 1. Save notification record first
  const notification = await NotificationHistory.create({
    tenantId,
    userId,
    fcmToken: "system",
    title,
    body,
    metadata,
    status: "pending",
  });

  const isOnline = onlineUsers?.has(userKey);

  // 2. If online → emit real-time
  if (isOnline && io) {
    io.to(`user:${userId}`).emit("notification", notification);
    io.to(`user:${userId}`).emit("badgeIncrement", { count: 1 });

    notification.status = "delivered";
    await notification.save();

    return notification;
  }

  // 3. If offline → send Firebase push
  const tokens = await FCMToken.find({
    tenantId,
    userId,
    isActive: true,
  });

  for (const tokenDoc of tokens) {
    try {
      const response = await notificationService.sendNotification(
        title,
        body,
        tokenDoc.fcmToken,
      );

      notification.status = "sent";
      notification.firebaseMessageId = response;
      await notification.save();
    } catch (err) {
      notification.status = "failed";
      notification.error = err.message;
      await notification.save();
    }
  }

  return notification;
}

module.exports = { dispatchNotification };
