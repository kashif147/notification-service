const notificationService = require("../services/notificationService");
const FCMToken = require("../models/fcmToken.model.js");
const NotificationHistory = require("../models/notificationHistory.model.js");
const mongoose = require("mongoose");
const logger = require("../config/logger.js");
const axios = require("axios");

// Helper function to fetch profiles by user IDs from profile-service
async function fetchProfilesByUserIds(userIds) {
  if (!userIds || userIds.length === 0) {
    return {};
  }

  const profileServiceUrl =
    process.env.PROFILE_SERVICE_URL || "http://localhost:4000";

  try {
    const response = await axios.post(
      `${profileServiceUrl}/api/profile/internal/by-user-ids`,
      { userIds },
      {
        headers: {
          "x-internal-request": "true",
          "Content-Type": "application/json",
        },
        timeout: 5000, // 5 second timeout
      }
    );

    if (response.data?.success && response.data?.data) {
      return response.data.data;
    }
    return {};
  } catch (error) {
    logger.warn(
      {
        error: error.message,
        userIdsCount: userIds.length,
        profileServiceUrl,
      },
      "Failed to fetch profiles from profile-service, returning tokens without profile data"
    );
    return {};
  }
}

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

      // Extract tenantId and userId from JWT token as primary source
      const jwtTenantId = req.user?.tenantId || req.tenantId;
      const jwtUserId = req.user?.id || req.user?.sub || req.userId;

      // Use JWT values as fallback, then body, then query
      let tenantId = jwtTenantId || req.body.tenantId;
      let targetUserId = userId || jwtUserId;

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
      else if (targetUserId) {
        if (!tenantId) {
          return res.status(400).json({
            message: "tenantId is required when using userId",
            success: false,
          });
        }

        const activeTokens = await FCMToken.find({
          userId: targetUserId,
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

      // Get userId and tenantId for notification history if not already determined
      if (!targetUserId && fcmToken) {
        // Try to find userId from token
        const tokenRecord = await FCMToken.findOne({ fcmToken }).select(
          "userId tenantId"
        );
        if (tokenRecord) {
          targetUserId = tokenRecord.userId;
          if (!tenantId) {
            tenantId = tokenRecord.tenantId;
          }
        }
      }

      // Fallback to JWT values if still not determined
      if (!targetUserId) {
        targetUserId = jwtUserId;
      }
      if (!tenantId) {
        tenantId = jwtTenantId;
      }

      // Send notifications to all tokens
      const results = await Promise.allSettled(
        tokensToSend.map((token) =>
          notificationService.sendNotification(title, body, token)
        )
      );

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      // Save notification history for each result
      const notificationHistoryPromises = [];

      // If userId is provided, all tokens should have same userId/tenantId, so we can batch
      // Otherwise, we need to look up each token individually
      if (targetUserId && tenantId) {
        // All tokens belong to same user, batch create
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const token = tokensToSend[i];

          notificationHistoryPromises.push(
            NotificationHistory.create({
              tenantId,
              userId: targetUserId,
              fcmToken: token.substring(0, 20) + "...", // Store partial for privacy
              title,
              body,
              status: result.status === "fulfilled" ? "sent" : "failed",
              firebaseMessageId:
                result.status === "fulfilled" ? result.value || null : null,
              error:
                result.status === "rejected"
                  ? result.reason?.message ||
                    result.reason?.toString() ||
                    "Unknown error"
                  : null,
              sentAt: new Date(),
            })
          );
        }
      } else {
        // Need to look up userId/tenantId for each token
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const token = tokensToSend[i];

          const tokenRecord = await FCMToken.findOne({
            fcmToken: token,
          }).select("userId tenantId");

          if (tokenRecord && tokenRecord.userId && tokenRecord.tenantId) {
            notificationHistoryPromises.push(
              NotificationHistory.create({
                tenantId: tokenRecord.tenantId,
                userId: tokenRecord.userId,
                fcmToken: token.substring(0, 20) + "...", // Store partial for privacy
                title,
                body,
                status: result.status === "fulfilled" ? "sent" : "failed",
                firebaseMessageId:
                  result.status === "fulfilled" ? result.value || null : null,
                error:
                  result.status === "rejected"
                    ? result.reason?.message ||
                      result.reason?.toString() ||
                      "Unknown error"
                    : null,
                sentAt: new Date(),
              })
            );
          } else {
            logger.warn(
              { fcmToken: token.substring(0, 20) + "..." },
              "Skipping notification history - token not found or missing userId/tenantId"
            );
          }
        }
      }

      // Save all notification histories to database
      if (notificationHistoryPromises.length > 0) {
        try {
          await Promise.all(notificationHistoryPromises);
          logger.info(
            { count: notificationHistoryPromises.length },
            "Notification history saved to database"
          );
        } catch (err) {
          logger.error(
            { error: err.message },
            "Error saving notification history"
          );
          // Don't fail the request if history save fails, but log it
        }
      } else {
        // If no history was created, create a record anyway if we have userId/tenantId
        if (targetUserId && tenantId) {
          try {
            await NotificationHistory.create({
              tenantId,
              userId: targetUserId,
              fcmToken: tokensToSend[0]
                ? tokensToSend[0].substring(0, 20) + "..."
                : "unknown",
              title,
              body,
              status: successful > 0 ? "sent" : "failed",
              firebaseMessageId: null,
              error: failed > 0 ? "Some notifications failed to send" : null,
              sentAt: new Date(),
            });
            logger.info("Notification history saved to database (fallback)");
          } catch (err) {
            logger.error(
              { error: err.message },
              "Error saving notification history (fallback)"
            );
          }
        } else {
          logger.warn(
            "Could not save notification history - missing userId or tenantId"
          );
        }
      }

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

  // Get all active tokens
  getAllActiveTokens: async (req, res) => {
    try {
      const { page = 1, limit = 50 } = req.query;
      const skip = (page - 1) * limit;

      const tokens = await FCMToken.find({ isActive: true })
        .select("-__v")
        .sort({ lastUsedAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean();

      const total = await FCMToken.countDocuments({ isActive: true });

      // Extract unique userIds from tokens
      const userIds = [...new Set(tokens.map((t) => t.userId).filter(Boolean))];

      // Fetch profiles for these userIds
      const profilesByUserId = await fetchProfilesByUserIds(userIds);

      // Enrich tokens with profile data
      const enrichedTokens = tokens.map((token) => ({
        ...token,
        profile: profilesByUserId[token.userId] || null,
      }));

      logger.info(
        { count: tokens.length, page, limit, total },
        "Retrieved all active tokens"
      );

      res.status(200).json({
        message: "Active tokens retrieved successfully",
        success: true,
        data: {
          tokens: enrichedTokens,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error retrieving active tokens");
      return res.status(500).json({
        message: "Error retrieving active tokens",
        error: error.message,
        success: false,
      });
    }
  },

  // Get filtered tokens by tenantId, platform, deviceId, or userId
  getFilteredTokens: async (req, res) => {
    try {
      const {
        tenantId,
        userId,
        platform,
        deviceId,
        isActive = true,
      } = req.query;
      const { page = 1, limit = 50 } = req.query;
      const skip = (page - 1) * limit;

      // Build query object based on provided filters
      const query = {};

      if (tenantId) {
        query.tenantId = tenantId;
      }

      if (userId) {
        query.userId = userId;
      }

      if (platform) {
        // Validate platform value
        const validPlatforms = ["ios", "android", "web"];
        if (!validPlatforms.includes(platform)) {
          return res.status(400).json({
            message: `Invalid platform. Must be one of: ${validPlatforms.join(
              ", "
            )}`,
            success: false,
          });
        }
        query.platform = platform;
      }

      if (deviceId) {
        query.deviceId = deviceId;
      }

      // Filter by active status (default to true, but allow explicit false)
      if (isActive !== undefined) {
        query.isActive = isActive === "true" || isActive === true;
      }

      const tokens = await FCMToken.find(query)
        .select("-__v")
        .sort({ lastUsedAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean();

      const total = await FCMToken.countDocuments(query);

      // Extract unique userIds from tokens
      const userIds = [...new Set(tokens.map((t) => t.userId).filter(Boolean))];

      // Fetch profiles for these userIds
      const profilesByUserId = await fetchProfilesByUserIds(userIds);

      // Enrich tokens with profile data
      const enrichedTokens = tokens.map((token) => ({
        ...token,
        profile: profilesByUserId[token.userId] || null,
      }));

      logger.info(
        {
          filters: { tenantId, userId, platform, deviceId, isActive },
          count: tokens.length,
          page,
          limit,
          total,
        },
        "Retrieved filtered tokens"
      );

      res.status(200).json({
        message: "Filtered tokens retrieved successfully",
        success: true,
        data: {
          tokens: enrichedTokens,
          filters: {
            tenantId: tenantId || null,
            userId: userId || null,
            platform: platform || null,
            deviceId: deviceId || null,
            isActive: query.isActive,
          },
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error retrieving filtered tokens"
      );
      return res.status(500).json({
        message: "Error retrieving filtered tokens",
        error: error.message,
        success: false,
      });
    }
  },

  // Get notifications for a user
  getNotifications: async (req, res) => {
    try {
      // Only accept filtering and pagination parameters from query
      // userId and tenantId are NOT accepted as input - they come from JWT token only
      const { isRead, status, page = 1, limit = 50 } = req.query;

      // Extract userId and tenantId from JWT token only (not from query or body)
      const userId = req.user?.id || req.user?.sub || req.userId;
      const tenantId = req.user?.tenantId || req.tenantId;

      if (!userId) {
        return res.status(400).json({
          message: "userId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      if (!tenantId) {
        return res.status(400).json({
          message: "tenantId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      const skip = (page - 1) * limit;

      // Build query
      const query = {
        tenantId,
        userId,
      };

      // Add read status filter if provided
      if (isRead !== undefined) {
        query.isRead = isRead === "true" || isRead === true;
      }

      // Add status filter if provided
      if (status) {
        const validStatuses = ["pending", "sent", "failed", "delivered"];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({
            message: `Invalid status. Must be one of: ${validStatuses.join(
              ", "
            )}`,
            success: false,
          });
        }
        query.status = status;
      }

      // Query automatically excludes soft-deleted records via middleware
      const notifications = await NotificationHistory.find(query)
        .select("-__v -fcmToken") // Exclude sensitive fields
        .sort({ createdAt: -1 }) // Most recent first
        .limit(parseInt(limit))
        .skip(skip)
        .lean();

      const total = await NotificationHistory.countDocuments(query);
      const unreadCount = await NotificationHistory.countDocuments({
        ...query,
        isRead: false,
      });

      logger.info(
        {
          userId,
          tenantId,
          count: notifications.length,
          page,
          limit,
          total,
          unreadCount,
        },
        "Retrieved notifications"
      );

      res.status(200).json({
        message: "Notifications retrieved successfully",
        success: true,
        data: {
          notifications,
          unreadCount,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error retrieving notifications");
      return res.status(500).json({
        message: "Error retrieving notifications",
        error: error.message,
        success: false,
      });
    }
  },

  // Mark notification(s) as read
  markAsRead: async (req, res) => {
    try {
      const { notificationIds } = req.body;

      // Extract userId and tenantId from JWT token only (not from body)
      const userId = req.user?.id || req.user?.sub || req.userId;
      const tenantId = req.user?.tenantId || req.tenantId;

      if (
        !notificationIds ||
        !Array.isArray(notificationIds) ||
        notificationIds.length === 0
      ) {
        return res.status(400).json({
          message: "notificationIds array is required and must not be empty",
          success: false,
        });
      }

      // Validate all notificationIds are valid MongoDB ObjectIds
      const invalidIds = notificationIds.filter(
        (id) => !mongoose.Types.ObjectId.isValid(id)
      );
      if (invalidIds.length > 0) {
        return res.status(400).json({
          message: "Invalid notification ID(s) provided",
          success: false,
          invalidIds,
        });
      }

      if (!userId) {
        return res.status(400).json({
          message: "userId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      if (!tenantId) {
        return res.status(400).json({
          message: "tenantId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      // Build query to ensure user can only mark their own notifications
      // Exclude soft-deleted notifications
      const query = {
        _id: { $in: notificationIds },
        userId,
        tenantId,
        deletedAt: null,
      };

      const result = await NotificationHistory.updateMany(query, {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      });

      if (result.matchedCount === 0) {
        return res.status(404).json({
          message: "No notifications found matching the provided criteria",
          success: false,
        });
      }

      logger.info(
        {
          userId,
          tenantId,
          notificationIds,
          matched: result.matchedCount,
          modified: result.modifiedCount,
        },
        "Marked notifications as read"
      );

      res.status(200).json({
        message: "Notifications marked as read successfully",
        success: true,
        data: {
          matched: result.matchedCount,
          modified: result.modifiedCount,
        },
      });
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error marking notifications as read"
      );
      return res.status(500).json({
        message: "Error marking notifications as read",
        error: error.message,
        success: false,
      });
    }
  },

  // Delete a single notification (soft delete)
  deleteNotification: async (req, res) => {
    try {
      const { notificationId } = req.params;

      // Extract userId and tenantId from JWT token only
      const userId = req.user?.id || req.user?.sub || req.userId;
      const tenantId = req.user?.tenantId || req.tenantId;

      if (!notificationId) {
        return res.status(400).json({
          message: "notificationId is required",
          success: false,
        });
      }

      // Validate notificationId is a valid MongoDB ObjectId
      if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return res.status(400).json({
          message: "Invalid notification ID",
          success: false,
        });
      }

      if (!userId) {
        return res.status(400).json({
          message: "userId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      if (!tenantId) {
        return res.status(400).json({
          message: "tenantId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      // Build query to ensure user can only delete their own notifications
      const query = {
        _id: notificationId,
        userId,
        tenantId,
        deletedAt: null, // Only delete if not already deleted
      };

      const notification = await NotificationHistory.findOneAndUpdate(
        query,
        {
          $set: {
            deletedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!notification) {
        return res.status(404).json({
          message: "Notification not found or already deleted",
          success: false,
        });
      }

      logger.info(
        {
          userId,
          tenantId,
          notificationId,
        },
        "Notification soft deleted"
      );

      res.status(200).json({
        message: "Notification deleted successfully",
        success: true,
        data: {
          notificationId: notification._id,
          deletedAt: notification.deletedAt,
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error deleting notification");
      return res.status(500).json({
        message: "Error deleting notification",
        error: error.message,
        success: false,
      });
    }
  },

  // Delete all notifications for a user (soft delete)
  deleteAllNotifications: async (req, res) => {
    try {
      // Extract userId and tenantId from JWT token only
      const userId = req.user?.id || req.user?.sub || req.userId;
      const tenantId = req.user?.tenantId || req.tenantId;

      if (!userId) {
        return res.status(400).json({
          message: "userId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      if (!tenantId) {
        return res.status(400).json({
          message: "tenantId is required. Please ensure you are authenticated.",
          success: false,
        });
      }

      // Build query to ensure user can only delete their own notifications
      const query = {
        userId,
        tenantId,
        deletedAt: null, // Only delete if not already deleted
      };

      const result = await NotificationHistory.updateMany(query, {
        $set: {
          deletedAt: new Date(),
        },
      });

      logger.info(
        {
          userId,
          tenantId,
          matched: result.matchedCount,
          modified: result.modifiedCount,
        },
        "All notifications soft deleted"
      );

      res.status(200).json({
        message: "All notifications deleted successfully",
        success: true,
        data: {
          deletedCount: result.modifiedCount,
        },
      });
    } catch (error) {
      logger.error(
        { error: error.message },
        "Error deleting all notifications"
      );
      return res.status(500).json({
        message: "Error deleting all notifications",
        error: error.message,
        success: false,
      });
    }
  },
};

module.exports = sendFirebaseNotification;
