const notificationService = require("../services/notificationService");

const sendFirebaseNotification = {
  sendNotification: async (req, res) => {
    try {
      const { title, body, token, fcmToken } = req.body;
      const deviceToken = token || fcmToken;
      if (!title || !body || !deviceToken) {
        return res
          .status(400)
          .json({ message: "Missing required fields", success: false });
      }
      const response = await notificationService.sendNotification(
        title,
        body,
        deviceToken
      );
      res.status(200).json({
        message: "Notification sent successfully",
        success: true,
        data: response,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Error sending notification",
        error: error.message,
        success: false,
      });
    }
  },
};

module.exports = sendFirebaseNotification;
