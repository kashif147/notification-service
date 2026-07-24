# Real-time finance invalidation (not a notification)

`journalCreated.listener.js` (on `journal.created.v1`, filtered to `FINANCE_DOC_TYPES` —
Receipt/Claim/Refund/WriteOff) and the internal HTTP route `POST
/api/internal/realtime/member-finance-updated` (`routes/internal.realtime.route.js`, gated only
by `x-internal-request: true`, no shared secret) both call
`services/memberFinanceRealtime.service.js`'s `emitMemberFinanceUpdated()`, which broadcasts
`memberFinanceUpdated`/`member:finance:updated` to the whole `tenant:${tenantId}` Socket.IO room —
no `NotificationHistory` row, no FCM push, no per-user targeting.

This exists purely so the CRM's member ledger view can invalidate/refetch live when a GL posting
happens elsewhere (account-service). Don't route this through `dispatchNotification` — it's a
different concern (broadcast UI cache invalidation vs. a per-user notification record), and
routing it through the dispatcher would create a `NotificationHistory` row and attempt an FCM
push that nobody wants for this event.
