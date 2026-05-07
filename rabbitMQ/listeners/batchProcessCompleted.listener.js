const {
  dispatchNotification,
} = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");

module.exports = async function handleBatchProcessCompleted(payload) {
  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();
  const data = payload?.data || payload || {};
  const userId = data.userId || data.createdBy;

  if (!userId) return;

  const status = String(data.status || "").toLowerCase();
  const isFailed = status === "failed";
  const batchName = String(data.batchName || "").trim() || "Batch";
  const totalTransactions = Number(data.totalTransactions || 0);
  const title = isFailed
    ? `Batch ${batchName} has failed.`
    : `Batch ${batchName} is completed.`;
  const body = isFailed ? "Batch processing failed." : "Batch processing completed.";

  await dispatchNotification(
    {
      tenantId: data.tenantId,
      userId,
      title,
      body,
      metadata: {
        type: "BATCH_PROCESS_COMPLETED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
        batchDetailId: data.batchDetailId,
        batchName,
        referenceNumber: data.referenceNumber || null,
        description: data.description || null,
        status,
        processedTransactions: Number(data.processedTransactions || 0),
        failedTransactions: Number(data.failedTransactions || 0),
        totalTransactions,
      },
    },
    io,
    onlineUsers
  );

  if (io) {
    io.to(`user:${userId}`).emit("batchProcessCompleted", {
      batchDetailId: data.batchDetailId,
      status: status || "processed",
      processedTransactions: Number(data.processedTransactions || 0),
      failedTransactions: Number(data.failedTransactions || 0),
      totalTransactions: Number(data.totalTransactions || 0),
      message: data.message || null,
      timestamp: new Date().toISOString(),
    });
  }
};
