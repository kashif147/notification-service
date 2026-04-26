const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { authenticate } = require("../middlewares/auth");
const NotificationHistory = require("../models/notificationHistory.model");
const {
  stripAttachmentsFromMetadata,
} = require("../helpers/notificationAttachmentMetadata.js");

router.get(
  "/",
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.user?.sub || req.userId;
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!userId || !tenantId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const notifications = await NotificationHistory.find({
        tenantId,
        userId,
        deletedAt: null,
      })
        .select("_id title body isRead createdAt metadata")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const unreadCount = await NotificationHistory.countDocuments({
        tenantId,
        userId,
        isRead: false,
        deletedAt: null,
      });
      const list = notifications.map((n) => ({
        _id: n._id,
        title: n.title,
        body: n.body,
        isRead: !!n.isRead,
        createdAt: n.createdAt,
        metadata: stripAttachmentsFromMetadata(n.metadata) || {},
      }));
      res.status(200).json({
        data: { notifications: list, unreadCount },
      });
    } catch (err) {
      res.status(500).json({ message: err.message || "Error fetching notifications" });
    }
  }
);

/**
 * Full notification (including base64 PDF attachments) for the signed-in user.
 */
router.get(
  "/:id",
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.user?.sub || req.userId;
      const tenantId = req.user?.tenantId || req.tenantId;
      if (!userId || !tenantId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid notification id" });
      }
      const n = await NotificationHistory.findOne({
        _id: id,
        tenantId,
        userId,
        deletedAt: null,
      })
        .select("_id title body isRead createdAt metadata")
        .lean();
      if (!n) {
        return res.status(404).json({ message: "Notification not found" });
      }
      return res.status(200).json({
        data: {
          notification: {
            _id: n._id,
            title: n.title,
            body: n.body,
            isRead: !!n.isRead,
            createdAt: n.createdAt,
            metadata: n.metadata || {},
          },
        },
      });
    } catch (err) {
      res.status(500).json({ message: err.message || "Error fetching notification" });
    }
  }
);

module.exports = router;
