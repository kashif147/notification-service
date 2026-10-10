const notificationService = require("../services/notificationService");
const FCMToken = require("../models/fcmToken.model.js");
const NotificationHistory = require("../models/notificationHistory.model.js");
const mongoose = require("mongoose");
const logger = require("../config/logger.js");
const axios = require("axios");
const {
  stripAttachmentsFromMetadata,
} = require("../helpers/notificationAttachmentMetadata.js");

// Helper function to fetch profiles by user IDs from profile-service
async function fetchProfilesByUserIds(userIds, req = null) {
  if (!userIds || userIds.length === 0) {
    return {};
  }

  const profileServiceUrl =
    process.env.PROFILE_SERVICE_URL || "http://localhost:4000";

  // Build headers - forward JWT token if available, otherwise use internal header
  const headers = {
    "Content-Type": "application/json",
  };

  // Forward Authorization header (JWT token) from original request if available
  if (req && req.headers && req.headers.authorization) {
    headers["Authorization"] = req.headers.authorization;
  } else {
    // Fallback to internal header if no JWT token available
    headers["x-internal-request"] = "true";
  }

  try {
    logger.info(
      {
        userIdsCount: userIds.length,
        userIds: userIds.slice(0, 5), // Log first 5 for debugging
        profileServiceUrl,
      },
      "Fetching profiles from profile-service"
    );

    const response = await axios.post(
      `${profileServiceUrl}/api/profile/internal/by-user-ids`,
      { userIds },
      {
        headers,
        timeout: 5000, // 5 second timeout
      }
    );

    if (response.data?.success && response.data?.data) {
      logger.info(
        {
          profilesFound: Object.keys(response.data.data).length,
          userIdsRequested: userIds.length,
        },
        "Profiles fetched successfully"
      );
      return response.data.data;
    }
    
    logger.warn(
      {
        responseData: response.data,
      },
      "Profile service returned unexpected response format"
    );
    return {};
  } catch (error) {
    logger.error(
      {
        error: error.message,
        errorResponse: error.response?.data,
        errorStatus: error.response?.status,
        userIdsCount: userIds.length,
        profileServiceUrl,
      },
      "Failed to fetch profiles from profile-service, returning tokens without profile data"
    );
    return {};
  }
}

// Trusted identity from authenticate (+ the tenant-context guard). Body/query tenantId and
// userId are never authoritative on the firebase routes.
const trustedTenantId = (req) => req.ctx?.tenantId || req.tenantId || req.user?.tenantId;
const trustedUserId = (req) =>
  req.ctx?.userId || req.userId || req.user?.id || req.user?.sub;

const MAX_SEND_RECIPIENTS = 1000;
function normalizeUserIds(raw) {
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return [
    ...new Set(
      list
        .filter((v) => typeof v === "string" || typeof v === "number")
        .map((v) => String(v).trim())
        .filter(Boolean)
    ),
  ];
}

const sendFirebaseNotification = {
  // Register/Update FCM token for the authenticated caller (self-service only)
  registerToken: async (req, res) => {
    try {
      const { fcmToken, deviceId, platform } = req.body;
      const tenantId = trustedTenantId(req);
      const userId = trustedUserId(req);

      if (!tenantId || !userId) {
        return res.status(401).json({
          message: "Authenticated user and tenant are required",
          success: false,
        });
      }

      if (!fcmToken || typeof fcmToken !== "string") {
        return res.status(400).json({
          message: "Missing required field: fcmToken",
          success: false,
        });
      }

      // A caller may only register a device to their own account: body.userId is ignored and
      // the token is always bound to the trusted caller. (Not rejected, because clients decode
      // the JWT themselves and may send a different claim, e.g. sub vs id, for the same user.)
      if (
        req.body.userId !== undefined &&
        req.body.userId !== null &&
        String(req.body.userId) !== String(userId)
      ) {
        logger.warn(
          { trustedUserId: userId, tenantId },
          "register-token: body userId differs from authenticated user; binding to authenticated user"
        );
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

      // Keep one active token per device for this user+tenant to reduce stale duplicates.
      // If token rotated on same device, deactivate older active tokens.
      if (deviceId) {
        await FCMToken.updateMany(
          {
            tenantId,
            userId,
            deviceId,
            isActive: true,
            _id: { $ne: tokenData._id },
          },
          { $set: { isActive: false } }
        );
      }

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
      const tenantId = trustedTenantId(req);
      const userId = trustedUserId(req);

      if (!tenantId || !userId) {
        return res.status(401).json({
          message: "Authenticated user and tenant are required",
          success: false,
        });
      }

      if (!fcmToken || typeof fcmToken !== "string") {
        return res.status(400).json({
          message: "Missing required field: fcmToken",
          success: false,
        });
      }

      // Only the caller's own token in the caller's own tenant can be deactivated.
      const query = { fcmToken, tenantId, userId };

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

  // Send notification (CRM only) to recipients inside the caller's trusted tenant.
  // Targets: body.userId (string or array) resolved to that tenant's active tokens, or a raw
  // fcmToken that must belong to an active token record in the caller's tenant.
  sendNotification: async (req, res) => {
    try {
      const { title, body, fcmToken } = req.body;
      const tenantId = trustedTenantId(req);

      if (!tenantId) {
        return res.status(401).json({
          message: "Authenticated tenant is required",
          success: false,
        });
      }

      if (!title || !body) {
        return res.status(400).json({
          message: "Missing required fields: title and body are required",
          success: false,
        });
      }

      let targets = [];

      if (fcmToken) {
        if (typeof fcmToken !== "string") {
          return res.status(400).json({
            message: "fcmToken must be a string",
            success: false,
          });
        }
        const record = await FCMToken.findOne({
          fcmToken,
          tenantId,
          isActive: true,
        }).select("fcmToken userId");
        if (!record) {
          return res.status(404).json({
            message: "No active FCM token found for this tenant",
            success: false,
          });
        }
        targets = [{ fcmToken: record.fcmToken, userId: record.userId }];
      } else {
        const userIds = normalizeUserIds(req.body.userId);
        if (userIds.length === 0) {
          return res.status(400).json({
            message: "Either fcmToken or userId must be provided",
            success: false,
          });
        }
        if (userIds.length > MAX_SEND_RECIPIENTS) {
          return res.status(400).json({
            message: `Too many recipients (max ${MAX_SEND_RECIPIENTS})`,
            success: false,
          });
        }

        const activeTokens = await FCMToken.find({
          tenantId,
          userId: { $in: userIds },
          isActive: true,
        }).select("fcmToken userId");

        if (activeTokens.length === 0) {
          return res.status(404).json({
            message: "No active FCM tokens found for this user",
            success: false,
          });
        }
        targets = activeTokens.map((t) => ({ fcmToken: t.fcmToken, userId: t.userId }));
      }

      const results = await Promise.allSettled(
        targets.map((t) => notificationService.sendNotification(title, body, t.fcmToken))
      );

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      // History rows always carry the trusted tenant and the token owner's userId.
      const historyRows = results.map((result, i) => ({
        tenantId,
        userId: targets[i].userId,
        fcmToken: targets[i].fcmToken.substring(0, 20) + "...", // Store partial for privacy
        title,
        body,
        status: result.status === "fulfilled" ? "sent" : "failed",
        firebaseMessageId: result.status === "fulfilled" ? result.value || null : null,
        error:
          result.status === "rejected"
            ? result.reason?.message || result.reason?.toString() || "Unknown error"
            : null,
        sentAt: new Date(),
      }));

      try {
        await Promise.all(historyRows.map((row) => NotificationHistory.create(row)));
        logger.info({ count: historyRows.length }, "Notification history saved to database");
      } catch (err) {
        // Don't fail the request if history save fails, but log it
        logger.error({ error: err.message }, "Error saving notification history");
      }

      logger.info(
        { total: targets.length, successful, failed, tenantId },
        "Notifications sent"
      );

      res.status(200).json({
        message: "Notification(s) sent successfully",
        success: true,
        data: {
          total: targets.length,
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
      const tenantId = trustedTenantId(req);
      if (!tenantId) {
        return res.status(401).json({
          message: "Authenticated tenant is required",
          success: false,
        });
      }

      const { page = 1, limit = 500 } = req.query;
      const skip = (page - 1) * limit;
      const query = { tenantId, isActive: true };

      const tokens = await FCMToken.find(query)
        .select("-__v")
        .sort({ lastUsedAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean();

      const total = await FCMToken.countDocuments(query);

      // Extract unique userIds from tokens
      const userIds = [...new Set(tokens.map((t) => t.userId).filter(Boolean))];

      // Fetch profiles for these userIds (forward the caller's JWT)
      const profilesByUserId = await fetchProfilesByUserIds(userIds, req);

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
      // ?tenantId= is ignored: results are always the caller's own tenant.
      const tenantId = trustedTenantId(req);
      if (!tenantId) {
        return res.status(401).json({
          message: "Authenticated tenant is required",
          success: false,
        });
      }

      const { userId, platform, deviceId, isActive = true } = req.query;
      const { page = 1, limit = 500 } = req.query;
      const skip = (page - 1) * limit;

      // Build query object based on provided filters
      const query = { tenantId };

      if (userId) {
        query.userId = String(userId);
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
        query.deviceId = String(deviceId);
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

      // Fetch profiles for these userIds (forward JWT token from request)
      const profilesByUserId = await fetchProfilesByUserIds(userIds, req);

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
      const { isRead, status, page = 1, limit = 500 } = req.query;

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
      const rawNotifications = await NotificationHistory.find(query)
        .select("-__v -fcmToken") // Exclude sensitive fields
        .sort({ createdAt: -1 }) // Most recent first
        .limit(parseInt(limit))
        .skip(skip)
        .lean();

      // List endpoint — strip base64 PDF attachment payloads down to {hasData, size} before
      // returning. Skipping this ships megabytes of base64 per notification with an attachment;
      // GET /api/notifications/:id is the intended place to fetch the full payload.
      const notifications = rawNotifications.map((n) => ({
        ...n,
        metadata: stripAttachmentsFromMetadata(n.metadata || {}) || {},
      }));

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
