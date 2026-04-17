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
  const title = isFailed ? "Batch Failed" : "Batch Completed";
  const body = isFailed
    ? `Batch ${data.batchDetailId} failed. Processed ${Number(
        data.processedTransactions || 0
      )}/${Number(data.totalTransactions || 0)}.`
    : `Batch ${data.batchDetailId} completed. Processed ${Number(
        data.processedTransactions || 0
      )}/${Number(data.totalTransactions || 0)}.`;

  await dispatchNotification(
    {
      tenantId: data.tenantId,
      userId,
      title,
      body,
      metadata: {
        type: "BATCH_PROCESS_COMPLETED",
        batchDetailId: data.batchDetailId,
        status,
        processedTransactions: Number(data.processedTransactions || 0),
        failedTransactions: Number(data.failedTransactions || 0),
        totalTransactions: Number(data.totalTransactions || 0),
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
