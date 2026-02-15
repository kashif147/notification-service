const mongoose = require("mongoose");

const FCMTokenSchema = new mongoose.Schema(
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
    // FCM token from client
    fcmToken: {
      type: String,
      required: true,
      unique: true,
      // index: true,
    },
    // Device identifier (optional, for tracking multiple devices per user)
    deviceId: {
      type: String,
      default: null,
      index: true,
    },
    // Platform: 'ios', 'android', 'web'
    platform: {
      type: String,
      enum: ["ios", "android", "web"],
      default: "android",
    },
    // Whether token is active
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    // Last time token was used/updated
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  },
);

// Compound indexes for efficient queries
FCMTokenSchema.index({ tenantId: 1, userId: 1 });
FCMTokenSchema.index({ tenantId: 1, userId: 1, isActive: 1 });
FCMTokenSchema.index({ fcmToken: 1 }, { unique: true });

// Update lastUsedAt before saving
FCMTokenSchema.pre("save", function (next) {
  this.lastUsedAt = new Date();
  next();
});

module.exports = mongoose.model("FCMToken", FCMTokenSchema);
