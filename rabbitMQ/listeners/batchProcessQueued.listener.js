const {
  dispatchNotification,
} = require("../../services/notificationDispatcher");
const { getSocketIO, getOnlineUsers } = require("../index");

module.exports = async function handleBatchProcessQueued(payload) {
  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();
  const data = payload?.data || payload || {};
  const userId = data.userId || data.createdBy;

  if (!userId) return;

  const batchName = String(data.batchName || "").trim() || "Batch";
  const totalTransactions = Number(data.totalTransactions || 0);
  const title = `Batch ${batchName} is queued for processing.`;

  await dispatchNotification(
    {
      tenantId: data.tenantId,
      userId,
      title,
      body: "Batch has been queued.",
      metadata: {
        type: "BATCH_PROCESS_QUEUED",
        batchDetailId: data.batchDetailId,
        batchName,
        referenceNumber: data.referenceNumber || null,
        description: data.description || null,
        totalTransactions,
        status: "queued",
      },
    },
    io,
    onlineUsers
  );
};
