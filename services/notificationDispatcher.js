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
const {
  metadataHasAttachmentPayload,
} = require("../helpers/notificationAttachmentMetadata.js");

function dedupeTokensByDevice(tokens = []) {
  const seen = new Set();
  const deduped = [];
  for (const tokenDoc of tokens) {
    const platform = String(tokenDoc.platform || "").toLowerCase();
    const deviceId = tokenDoc.deviceId || "";
    const key = deviceId
      ? `${tokenDoc.tenantId}:${tokenDoc.userId}:${platform}:${deviceId}`
      : `${tokenDoc.tenantId}:${tokenDoc.userId}:${platform}:token:${tokenDoc.fcmToken}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(tokenDoc);
  }
  // Final safety net: never attempt same raw FCM token more than once.
  const seenToken = new Set();
  return deduped.filter((tokenDoc) => {
    const token = String(tokenDoc?.fcmToken || "");
    if (!token || seenToken.has(token)) return false;
    seenToken.add(token);
    return true;
  });
}

function isInvalidOrUnregisteredTokenError(err) {
  const code = String(err?.code || "").toLowerCase();
  const message = String(err?.message || "").toLowerCase();
  return (
    code.includes("registration-token-not-registered") ||
    code.includes("invalid-registration-token") ||
    message.includes("notregistered") ||
    message.includes("requested entity was not found")
  );
}

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

  const allActiveTokens = await FCMToken.find({
    tenantId,
    userId,
    isActive: true,
  }).sort({ lastUsedAt: -1, createdAt: -1 });

  const mobileTokens = dedupeTokensByDevice(
    allActiveTokens.filter((t) => ["ios", "android"].includes(t.platform))
  );

  // Mobile flow is always FCM-based, even when user is online.
  // This ensures actual device push delivery semantics for iOS/Android.
  const shouldUseMobileFcm = mobileTokens.length > 0;
  const isOnline = onlineUsers?.has(userKey);

  // 2. If online and no mobile FCM route → emit real-time
  if (isOnline && io && !shouldUseMobileFcm) {
    const payload = {
      _id: notification._id,
      title: notification.title,
      body: notification.body,
      isRead: !!notification.isRead,
      createdAt: notification.createdAt,
      metadata: notification.metadata || {},
    };
    io.to(`user:${userId}`).emit("notification", payload);
    io.to(`user:${userId}`).emit("badgeIncrement", { count: 1 });

    notification.status = "delivered";
    await notification.save();

    return notification;
  }

  // 3. Send Firebase push
  // Current product behavior: send to only the latest active token
  // (sorted by lastUsedAt desc above).
  const candidateTokens = shouldUseMobileFcm
    ? mobileTokens
    : dedupeTokensByDevice(allActiveTokens);
  const tokens = candidateTokens.length > 0 ? [candidateTokens[0]] : [];

  const fcmData =
    metadataHasAttachmentPayload(metadata) ? { hasAttachments: "true" } : null;

  let successfulSends = 0;
  let failedSends = 0;
  let lastFirebaseMessageId = null;
  const failureReasons = [];

  for (const tokenDoc of tokens) {
    try {
      const response = await notificationService.sendNotification(
        title,
        body,
        tokenDoc.fcmToken,
        notification._id,
        fcmData,
        tokenDoc.platform,
      );
      successfulSends += 1;
      lastFirebaseMessageId = response || lastFirebaseMessageId;
    } catch (err) {
      failedSends += 1;
      failureReasons.push(err?.message || "Unknown error");
      if (isInvalidOrUnregisteredTokenError(err)) {
        await FCMToken.updateMany(
          { fcmToken: tokenDoc.fcmToken, isActive: true },
          { $set: { isActive: false } }
        );
      }
    }
  }

  if (successfulSends > 0) {
    notification.status = "sent";
    notification.firebaseMessageId = lastFirebaseMessageId;
    notification.error =
      failedSends > 0 ? `Partial failure: ${failureReasons.join(" | ")}` : null;
  } else {
    notification.status = "failed";
    notification.firebaseMessageId = null;
    notification.error =
      failedSends > 0
        ? failureReasons.join(" | ")
        : "No active FCM tokens found for user";
  }
  await notification.save();

  return notification;
}

module.exports = { dispatchNotification };
