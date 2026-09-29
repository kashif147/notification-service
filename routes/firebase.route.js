const express = require("express");
const router = express.Router();
const sendFirebaseNotification = require("../controllers/firebase.controller");
const { authenticate } = require("../middlewares/auth");
const { tenantContextWarn } = require("../middlewares/tenantContext.mw");

// Token registration endpoints
router.post("/register-token", sendFirebaseNotification.registerToken);
router.post("/unregister-token", sendFirebaseNotification.unregisterToken);

// Token retrieval endpoints
router.get("/tokens", sendFirebaseNotification.getAllActiveTokens);
router.get("/tokens/filter", sendFirebaseNotification.getFilteredTokens);

// Notification sending endpoint
router.post("/send-notification", sendFirebaseNotification.sendNotification);

// Notification history endpoints (authentication only - data filtered by userId/tenantId)
// Users can only access their own notifications (tenant isolation)
router.get(
  "/notifications",
  authenticate,
  tenantContextWarn,
  sendFirebaseNotification.getNotifications
);
router.post(
  "/notifications/mark-read",
  authenticate,
  tenantContextWarn,
  sendFirebaseNotification.markAsRead
);
router.delete(
  "/notifications/:notificationId",
  authenticate,
  tenantContextWarn,
  sendFirebaseNotification.deleteNotification
);
router.delete(
  "/notifications",
  authenticate,
  tenantContextWarn,
  sendFirebaseNotification.deleteAllNotifications
);

module.exports = router;
