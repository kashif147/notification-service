const admin = require("../util/firebase");
const logger = require("../config/logger.js");
const androidChannelId = process.env.FCM_ANDROID_CHANNEL_ID || "portal_default_v2";

function isMobilePlatform(platform) {
  const p = String(platform || "").toLowerCase();
  return p === "ios" || p === "android";
}

const notificationService = {
  /**
   * @param {Record<string, string>} [dataPayload] FCM `data` map — values must be strings; keep small.
   */
  sendNotification: async (
    title,
    body,
    fcmToken,
    notificationId = null,
    dataPayload = null,
    platform = null,
    forceDataOnly = false
  ) => {
    // Verify Firebase is initialized
    if (admin.apps.length === 0) {
      const error = new Error(
        "Firebase Admin SDK not initialized. Please configure FIREBASE_SERVICE_ACCOUNT_JSON or provide firebaseAdminSDK.json file."
      );
      logger.error(
        error,
        "Cannot send notification - Firebase not initialized"
      );
      throw error;
    }

    // Firebase Admin SDK requires 'token' property in message object
    // We use fcmToken variable name to avoid confusion with JWT tokens
    // data.notificationId enables client deduplication with Socket.IO (same _id)
    const baseData = notificationId
      ? { notificationId: String(notificationId) }
      : {};
    const extra =
      dataPayload && typeof dataPayload === "object" ? { ...dataPayload } : {};
    const data = {
      ...baseData,
      ...extra,
      title: String(title || ""),
      body: String(body || ""),
    };
    const mobileTarget = forceDataOnly || isMobilePlatform(platform);

    const message = {
      token: fcmToken,
      android: {
        priority: "high",
        notification: {
          channelId: androidChannelId,
          sound: "default",
        },
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            "content-available": 1,
            sound: "default",
          },
        },
      },
      ...(Object.keys(data).length > 0 && { data }),
    };
    // For mobile apps (Notifee path), send data-only so app fully controls display.
    if (!mobileTarget) {
      message.notification = {
        title,
        body,
      };
    }

    try {
      logger.info(
        {
          tokenPrefix: fcmToken?.substring(0, 10) + "...",
          androidPriority: message?.android?.priority,
          androidChannelId: message?.android?.notification?.channelId,
          platform: platform || "unknown",
          hasNotificationBlock: !!message?.notification,
          hasDataBlock: !!message?.data && Object.keys(message.data).length > 0,
          notificationId: data?.notificationId || null,
          metadataType: data?.type || null,
        },
        "FCM send config"
      );

      const response = await admin.messaging().send(message);
      logger.debug(
        { fcmToken: fcmToken.substring(0, 10) + "..." },
        "Notification sent successfully"
      );
      return response;
    } catch (error) {
      logger.error(
        { error: error.message, fcmToken: fcmToken?.substring(0, 10) + "..." },
        "Failed to send notification"
      );
      throw error;
    }
  },
};

module.exports = notificationService;
