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

  const isDdPrepare = String(data.kind || "") === "DD_PREPARE";
  const batchName = String(data.batchName || "").trim() || "Batch";
  const totalTransactions = Number(data.totalTransactions || 0);
  const title = isDdPrepare
    ? `Prepare started for ${batchName}.`
    : `Batch ${batchName} is queued for processing.`;
  const body = isDdPrepare
    ? "Building eligible members in the background. You will be notified when ready."
    : "Batch has been queued.";

  await dispatchNotification(
    {
      tenantId: data.tenantId,
      userId,
      title,
      body,
      metadata: {
        type: isDdPrepare ? "DD_PREPARE_QUEUED" : "BATCH_PROCESS_QUEUED",
        sourceEventId: payload?.eventId || null,
        sourceEventType: payload?.eventType || null,
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
