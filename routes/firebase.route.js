const express = require("express");
const router = express.Router();
const sendFirebaseNotification = require("../controllers/firebase.controller");

router.post("/send-notification", sendFirebaseNotification.sendNotification);

module.exports = router;
