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
      const msg = String(error?.message || "");
      const thirdPartyAuth = error.code === "messaging/third-party-auth-error";
      const misleadingOAuthWording = msg.includes("Expected OAuth 2 access token");
      const thirdPartyIos =
        platformLower === "ios" && (thirdPartyAuth || misleadingOAuthWording);
      logger.error(
        {
          error: msg,
          code: error.code,
          errorInfo: error.errorInfo || null,
          misleadingOAuthWording,
          fcmToken: fcmToken?.substring(0, 10) + "...",
          platform: platformLower || null,
          hasHttpsProxy: !!process.env.HTTPS_PROXY,
          hasHttpProxy: !!process.env.HTTP_PROXY,
          ...(thirdPartyIos && {
            fcmIosHint:
              "Firebase→APNs (not Node OAuth): Google often returns OAuth wording for third-party-auth. If INTERNAL.getToken succeeded at startup, fix Apple app in Firebase Console → Cloud Messaging (.p8 Key ID + Team ID, bundle ID matches GoogleService-Info.plist; Apple key must enable APNs).",
          }),
          ...(thirdPartyAuth &&
            platformLower !== "ios" && {
              fcmThirdPartyHint:
                "third-party-auth: check the push channel for this platform in Firebase (e.g. Web Push VAPID, not server OAuth).",
            }),
        },
        thirdPartyIos
          ? "FCM failed for iOS (APNs/third-party — OAuth text is usually a red herring)"
          : "Failed to send notification"
      );
      throw error;
    }
  },
};

module.exports = notificationService;
