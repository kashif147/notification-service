const {
  dispatchNotification,
} = require("../../services/notificationDispatcher");

const { getSocketIO, getOnlineUsers } = require("../index");

module.exports = async function handleBatchCompleted(payload) {
  const io = getSocketIO();
  const onlineUsers = getOnlineUsers();

  await dispatchNotification(
    {
      tenantId: payload.tenantId,
      userId: payload.userId,
      title: "Batch Completed",
      body: `Batch ${payload.batchId} completed successfully`,
      metadata: {
        type: "BATCH_COMPLETED",
        batchId: payload.batchId,
      },
    },
    io,
    onlineUsers,
  );
};
