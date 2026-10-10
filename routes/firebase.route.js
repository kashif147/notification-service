const express = require("express");
const router = express.Router();
const sendFirebaseNotification = require("../controllers/firebase.controller");
const { authenticate, requireCrmUser } = require("../middlewares/auth");
const { tenantContextWarn } = require("../middlewares/tenantContext.mw");

// Phase 2B0: every firebase route is authenticated. Tenant and (for self-service routes) user
// identity come only from the trusted auth context, never from the request body or query.

// Token registration endpoints (self-service: the caller's own device, own account)
router.post(
  "/register-token",
  authenticate,
  tenantContextWarn,
  sendFirebaseNotification.registerToken
);
router.post(
  "/unregister-token",
  authenticate,
  tenantContextWarn,
  sendFirebaseNotification.unregisterToken
);

// Token retrieval endpoints (CRM staff only, scoped to the caller's tenant)
router.get(
  "/tokens",
  authenticate,
  tenantContextWarn,
  requireCrmUser,
  sendFirebaseNotification.getAllActiveTokens
);
router.get(
  "/tokens/filter",
  authenticate,
  tenantContextWarn,
  requireCrmUser,
  sendFirebaseNotification.getFilteredTokens
);

// Notification sending endpoint (CRM staff only, recipients within the caller's tenant)
router.post(
  "/send-notification",
  authenticate,
  tenantContextWarn,
  requireCrmUser,
  sendFirebaseNotification.sendNotification
);

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
