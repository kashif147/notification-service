const { getSocketIO } = require("../index");

module.exports = async function handleBatchProcessProgress(payload) {
  const io = getSocketIO();
  if (!io) return;

  const data = payload?.data || payload || {};
  const userId = data.userId || data.createdBy;
  if (!userId) return;

  io.to(`user:${userId}`).emit("batchProcessProgress", {
    batchDetailId: data.batchDetailId,
    status: data.status || "processing_in_progress",
    processedTransactions: Number(data.processedTransactions || 0),
    failedTransactions: Number(data.failedTransactions || 0),
    totalTransactions: Number(data.totalTransactions || 0),
    timestamp: new Date().toISOString(),
  });
};
