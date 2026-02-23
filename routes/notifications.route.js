const express = require("express");
const router = express.Router();
const { authenticate } = require("../middlewares/auth");
const NotificationHistory = require("../models/notificationHistory.model");

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
      })
        .select("_id title body isRead createdAt metadata")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const unreadCount = await NotificationHistory.countDocuments({
        tenantId,
        userId,
        isRead: false,
      });
      const list = notifications.map((n) => ({
        _id: n._id,
        title: n.title,
        body: n.body,
        isRead: !!n.isRead,
        createdAt: n.createdAt,
        metadata: n.metadata || {},
      }));
      res.status(200).json({
        data: { notifications: list, unreadCount },
      });
    } catch (err) {
      res.status(500).json({ message: err.message || "Error fetching notifications" });
    }
  }
);

module.exports = router;
