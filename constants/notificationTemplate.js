exports.FILTER_OPERATOR = {
  EQUAL_TO: "equal_to",
  NOT_EQUAL_TO: "not_equal_to",
};

/** Maps template filter keys to Mongo paths on NotificationHistory */
exports.NOTIFICATION_FILTER_FIELD_MAP = {
  status: { path: "status" },
  isRead: { path: "isRead", type: "boolean" },
  userId: { path: "userId" },
  /** Matches metadata.eventType when present */
  metadataEventType: { path: "metadata.eventType" },
};

exports.ALLOWED_NOTIFICATION_FILTER_KEYS = Object.keys(
  exports.NOTIFICATION_FILTER_FIELD_MAP
);

exports.NOTIFICATION_RESPONSE_COLUMNS = [
  "_id",
  "tenantId",
  "userId",
  "title",
  "body",
  "status",
  "isRead",
  "createdAt",
  "updatedAt",
  "sentAt",
  "readAt",
  "metadata",
  "firebaseMessageId",
  "error",
];
