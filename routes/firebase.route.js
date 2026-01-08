const express = require("express");
const router = express.Router();
const sendFirebaseNotification = require("../controllers/firebase.controller");

// Token registration endpoints
router.post("/register-token", sendFirebaseNotification.registerToken);
router.post("/unregister-token", sendFirebaseNotification.unregisterToken);

// Notification sending endpoint
router.post("/send-notification", sendFirebaseNotification.sendNotification);

module.exports = router;
