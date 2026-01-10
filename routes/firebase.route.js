const express = require("express");
const router = express.Router();
const sendFirebaseNotification = require("../controllers/firebase.controller");

// Token registration endpoints
router.post("/register-token", sendFirebaseNotification.registerToken);
router.post("/unregister-token", sendFirebaseNotification.unregisterToken);

// Token retrieval endpoints
router.get("/tokens", sendFirebaseNotification.getAllActiveTokens);
router.get("/tokens/filter", sendFirebaseNotification.getFilteredTokens);

// Notification sending endpoint
router.post("/send-notification", sendFirebaseNotification.sendNotification);

// Notification history endpoints
router.get("/notifications", sendFirebaseNotification.getNotifications);
router.post("/notifications/mark-read", sendFirebaseNotification.markAsRead);

module.exports = router;
