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
    const platformLower = String(platform || "").toLowerCase();

    const message = {
      token: fcmToken,
      ...(Object.keys(data).length > 0 && { data }),
    };

    // Attach only the relevant platform block — mixing Android config with iOS tokens can trip edge cases.
    if (platformLower === "android") {
      message.android = {
        priority: "high",
        notification: {
          channelId: androidChannelId,
          sound: "default",
        },
      };
    } else if (platformLower === "ios") {
      message.apns = {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            "content-available": 1,
            sound: "default",
          },
        },
      };
    } else if (mobileTarget) {
      message.android = {
        priority: "high",
        notification: {
          channelId: androidChannelId,
          sound: "default",
        },
      };
      message.apns = {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            "content-available": 1,
            sound: "default",
          },
        },
      };
    }
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
          hasApnsBlock: !!message?.apns,
          platform: platform || "unknown",
          hasNotificationBlock: !!message?.notification,
          hasDataBlock: !!message?.data && Object.keys(message.data).length > 0,
          notificationId: data?.notificationId || null,
          metadataType: data?.type || null,
        },
        "FCM send config"
      );

      const app = admin.app();
      const oauth = await app.INTERNAL.getToken(false);
      const accessLen = oauth?.accessToken ? oauth.accessToken.length : 0;
      if (!oauth?.accessToken || typeof oauth.accessToken !== "string") {
        logger.error(
          {
            accessTokenLength: accessLen,
            firebaseProjectId: app.options?.projectId || process.env.GOOGLE_CLOUD_PROJECT,
          },
          "FCM send aborted: Firebase app INTERNAL.getToken returned no access token"
        );
        throw new Error(
          "Firebase OAuth access token missing — check credentials and GCP/Firebase APIs (FCM)."
        );
      }

      const response = await admin.messaging(app).send(message);
      logger.debug(
        { fcmToken: fcmToken.substring(0, 10) + "..." },
        "Notification sent successfully"
      );
      return response;
    } catch (error) {
      const thirdPartyAuth =
        error.code === "messaging/third-party-auth-error" &&
        platformLower === "ios";
      logger.error(
        {
          error: error.message,
          code: error.code,
          fcmToken: fcmToken?.substring(0, 10) + "...",
          hasHttpsProxy: !!process.env.HTTPS_PROXY,
          hasHttpProxy: !!process.env.HTTP_PROXY,
          ...(thirdPartyAuth && {
            fcmIosHint:
              "Firebase→APNs: In Firebase Console → Project settings → Cloud Messaging → Apple app configuration, upload a valid APNs Authentication Key (.p8) with correct Key ID and Team ID, or fix the APNs certificate. Ensure the iOS bundle ID matches the registered Firebase iOS app.",
          }),
        },
        thirdPartyAuth
          ? "FCM failed for iOS (third-party-auth-error — usually APNs credentials in Firebase, not server OAuth)"
          : "Failed to send notification"
      );
      throw error;
    }
  },
};

module.exports = notificationService;
