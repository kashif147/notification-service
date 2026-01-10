const admin = require("../util/firebase");
const logger = require("../config/logger.js");

const notificationService = {
  sendNotification: async (title, body, fcmToken) => {
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
    const message = {
      token: fcmToken,
      notification: {
        title: title,
        body: body,
      },
    };

    try {
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
