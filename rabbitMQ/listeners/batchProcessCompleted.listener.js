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
  const isDdPrepare = String(data.kind || "") === "DD_PREPARE";
  const batchName = String(data.batchName || "").trim() || "Batch";
  const totalTransactions = Number(data.totalTransactions || 0);

  let title;
  let body;
  if (isDdPrepare) {
    title = isFailed
      ? `Prepare failed for ${batchName}.`
      : `Prepare completed for ${batchName}.`;
    body = isFailed
      ? `Prepare did not finish: ${data.message || "see audit log"}`
      : "Members are ready — you can validate and approve the run.";
  } else {
    title = isFailed
      ? `Batch ${batchName} has failed.`
      : `Batch ${batchName} is completed.`;
    body = isFailed ? "Batch processing failed." : "Batch processing completed.";
  }

  await dispatchNotification(
    {
      tenantId: data.tenantId,
      userId,
      title,
      body,
      metadata: {
        type: isDdPrepare ? "DD_PREPARE_COMPLETED" : "BATCH_PROCESS_COMPLETED",
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
        ...(isDdPrepare
          ? {
              runId: data.runId || data.batchDetailId || null,
              runNo: data.runNo || null,
              included: Number(data.included || 0),
              excluded: Number(data.excluded || 0),
            }
          : {}),
      },
    },
    io,
    onlineUsers
  );

  if (io) {
    const evtName = isDdPrepare
      ? "ddPrepareCompleted"
      : "batchProcessCompleted";
    io.to(`user:${userId}`).emit(evtName, {
      batchDetailId: data.batchDetailId,
      runId: data.runId || null,
      runNo: data.runNo || null,
      status: status || "processed",
      processedTransactions: Number(data.processedTransactions || 0),
      failedTransactions: Number(data.failedTransactions || 0),
      totalTransactions: Number(data.totalTransactions || 0),
      included: Number(data.included || 0),
      excluded: Number(data.excluded || 0),
      message: data.message || null,
      timestamp: new Date().toISOString(),
    });
  }
};
