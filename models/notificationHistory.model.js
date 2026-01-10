const mongoose = require("mongoose");

const NotificationHistorySchema = new mongoose.Schema(
  {
    // Tenant isolation - mandatory field
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    // User ID from user-service
    userId: {
      type: String,
      required: true,
      index: true,
    },
    // FCM token (partial for privacy)
    fcmToken: {
      type: String,
      required: true,
      index: true,
    },
    // Notification title
    title: {
      type: String,
      required: true,
    },
    // Notification body/content
    body: {
      type: String,
      required: true,
    },
    // Notification status
    status: {
      type: String,
      enum: ["pending", "sent", "failed", "delivered"],
      default: "pending",
      index: true,
    },
    // Firebase message ID (if sent successfully)
    firebaseMessageId: {
      type: String,
      default: null,
      index: true,
    },
    // Error message (if failed)
    error: {
      type: String,
      default: null,
    },
    // Read status
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Read timestamp
    readAt: {
      type: Date,
      default: null,
    },
    // When notification was sent
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    // Additional metadata (optional)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound indexes for efficient queries
NotificationHistorySchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
NotificationHistorySchema.index({
  tenantId: 1,
  userId: 1,
  isRead: 1,
  createdAt: -1,
});
NotificationHistorySchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationHistorySchema.index({ status: 1, createdAt: -1 });
NotificationHistorySchema.index({ fcmToken: 1, createdAt: -1 });

module.exports = mongoose.model("NotificationHistory", NotificationHistorySchema);
