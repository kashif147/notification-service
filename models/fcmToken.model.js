const mongoose = require("mongoose");
const { tenantOwnershipPlugin } = require("./plugins/tenantOwnership.plugin");

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
    // Phase A / A6: unique per tenant (not globally); see indexes below.
    fcmToken: {
      type: String,
      required: true,
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
// Phase A / A6: a token binding is unique per tenant, and a physical token has at most ONE active
// binding across tenants (explicit handoff deactivates the previous one). Built/verified by
// scripts/migrate-fcmtoken-tenant-indexes.js, which also drops the old global fcmToken_1.
FCMTokenSchema.index({ tenantId: 1, fcmToken: 1 }, { unique: true, name: "tenantId_1_fcmToken_1" });
FCMTokenSchema.index(
  { fcmToken: 1 },
  { unique: true, name: "fcmToken_active_unique", partialFilterExpression: { isActive: true } }
);

// Update lastUsedAt before saving
FCMTokenSchema.pre("save", function (next) {
  this.lastUsedAt = new Date();
  next();
});

// Phase A / A15: tenantId is immutable once written (ownership cannot move between tenants).
FCMTokenSchema.plugin(tenantOwnershipPlugin, { modelName: "FCMToken" });

module.exports = mongoose.model("FCMToken", FCMTokenSchema);
