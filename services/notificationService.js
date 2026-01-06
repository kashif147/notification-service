const admin = require("../util/firebase");

const notificationService = {
  sendNotification: async (title, body, fcmToken) => {
    const message = {
      token: fcmToken,
      notification: {
        title: title,
        body: body,
      },
    };
    try {
      const response = await admin.messaging().send(message);
      return response;
    } catch (error) {
      throw error;
    }
  },
};

module.exports = notificationService;
