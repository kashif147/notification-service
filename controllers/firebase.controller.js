const notificationService = require("../services/notificationService");
const FCMToken = require("../models/fcmToken.model.js");
const logger = require("../config/logger.js");

const sendFirebaseNotification = {
  // Register/Update FCM token for a user
  registerToken: async (req, res) => {
    try {
      const { fcmToken, userId, deviceId, platform } = req.body;
      const tenantId = req.user?.tenantId || req.body.tenantId;

      if (!fcmToken || !userId) {
        return res.status(400).json({
          message: "Missing required fields: fcmToken and userId are required",
          success: false,
        });
      }

      if (!tenantId) {
        return res.status(400).json({
          message: "Missing tenantId",
          success: false,
        });
      }

      // Upsert: Update if exists, create if not
      const tokenData = await FCMToken.findOneAndUpdate(
        { fcmToken: fcmToken },
        {
          tenantId,
          userId,
          fcmToken,
          deviceId: deviceId || null,
          platform: platform || "android",
          isActive: true,
          lastUsedAt: new Date(),
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      logger.info(
        { userId, tenantId, tokenId: tokenData._id },
        "FCM token registered/updated"
      );

      res.status(200).json({
        message: "FCM token registered successfully",
        success: true,
        data: {
          id: tokenData._id,
          userId: tokenData.userId,
          platform: tokenData.platform,
          registeredAt: tokenData.createdAt,
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error registering FCM token");
      return res.status(500).json({
        message: "Error registering FCM token",
        error: error.message,
        success: false,
      });
    }
  },

  // Unregister/Deactivate FCM token
  unregisterToken: async (req, res) => {
    try {
      const { fcmToken } = req.body;
      const tenantId = req.user?.tenantId || req.body.tenantId;
      const userId = req.user?.id || req.user?.sub || req.body.userId;

      if (!fcmToken) {
        return res.status(400).json({
          message: "Missing required field: fcmToken",
          success: false,
        });
      }

      const query = { fcmToken };
      if (tenantId) query.tenantId = tenantId;
      if (userId) query.userId = userId;

      const tokenData = await FCMToken.findOneAndUpdate(
        query,
        { isActive: false },
        { new: true }
      );

      if (!tokenData) {
        return res.status(404).json({
          message: "FCM token not found",
          success: false,
        });
      }

      logger.info(
        { fcmToken: fcmToken.substring(0, 10) + "..." },
        "FCM token deactivated"
      );

      res.status(200).json({
        message: "FCM token unregistered successfully",
        success: true,
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error unregistering FCM token");
      return res.status(500).json({
        message: "Error unregistering FCM token",
        error: error.message,
        success: false,
      });
    }
  },

  // Send notification - supports both direct fcmToken and userId-based retrieval
  sendNotification: async (req, res) => {
    try {
      const { title, body, fcmToken, userId } = req.body;
      const tenantId = req.user?.tenantId || req.body.tenantId;

      if (!title || !body) {
        return res.status(400).json({
          message: "Missing required fields: title and body are required",
          success: false,
        });
      }

      let tokensToSend = [];

      // If fcmToken provided directly, use it
      if (fcmToken) {
        tokensToSend = [fcmToken];
      }
      // If userId provided, retrieve tokens from database
      else if (userId) {
        if (!tenantId) {
          return res.status(400).json({
            message: "tenantId is required when using userId",
            success: false,
          });
        }

        const activeTokens = await FCMToken.find({
          userId,
          tenantId,
          isActive: true,
        }).select("fcmToken");

        if (activeTokens.length === 0) {
          return res.status(404).json({
            message: "No active FCM tokens found for this user",
            success: false,
          });
        }

        tokensToSend = activeTokens.map((token) => token.fcmToken);
      } else {
        return res.status(400).json({
          message: "Either fcmToken or userId must be provided",
          success: false,
        });
      }

      // Send notifications to all tokens
      const results = await Promise.allSettled(
        tokensToSend.map((token) =>
          notificationService.sendNotification(title, body, token)
        )
      );

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      logger.info(
        { total: tokensToSend.length, successful, failed },
        "Notifications sent"
      );

      res.status(200).json({
        message: "Notification(s) sent successfully",
        success: true,
        data: {
          total: tokensToSend.length,
          successful,
          failed,
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error sending notification");
      return res.status(500).json({
        message: "Error sending notification",
        error: error.message,
        success: false,
      });
    }
  },
};

module.exports = sendFirebaseNotification;
