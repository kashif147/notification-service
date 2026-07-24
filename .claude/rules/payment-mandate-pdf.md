# Payment-mandate PDF generation

`applicationReviewProcessed.listener.js` inspects the approved application's chosen
`paymentType` and, for Standing Order (`SBO`) or Salary Deduction (`SD19`), prefills the actual
INMO PDF form using `services/membershipFormPdf.js` (`pdf-lib`, drawing text onto fixed
coordinates from `config/membershipFormLayout.js`). `services/sd19LayoutDetect.js` sniffs which
of several known SD19 template layouts a given PDF byte stream matches (the source PDF has been
revised over time), and `services/membershipFormFinancials.js` computes the installment
amount/frequency text drawn onto the form.

`services/membershipFormFinancials.js`'s fee-by-category table (`MEMBERSHIP_FEE_EUR_BY_KEY`) is
intentionally duplicated from subscription-service's `helpers/serviceClient.js` (the pricing
source of truth) rather than reached via a cross-service filesystem require — that reach used to
work only in a local monorepo checkout (each service's `Dockerfile` only copies its own repo). This
same drawing code (`membershipFormPdf.js` + its siblings) is itself duplicated a second time into
`profile-service/services/paymentFormPdf/` for the same reason — see that service's
`payment-forms.md`. If subscription-service's fee table changes, update all three copies.

The filled PDF is base64-encoded directly into
`NotificationHistory.metadata.attachments[].dataBase64` — there is no separate blob store for
these; the Mongo document *is* the storage.

Because of that, `helpers/notificationAttachmentMetadata.js`'s `stripAttachmentsFromMetadata()`
is critical: the Socket.IO push, `notification.admin.controller.js`'s CRM grid endpoints, and
`firebase.controller.js`'s `getNotifications` (`GET /api/notifications`, the per-user inbox list)
all strip `dataBase64` down to `{hasData, size}`, while `GET /api/notifications/:id` returns the
full base64 payload by design. **Never add a new list-style endpoint that returns raw `metadata`
without running it through `stripAttachmentsFromMetadata()` first** — skipping it ships megabytes
of base64 PDFs in a grid response.

`getNotifications` didn't do this until it was found and fixed in the same session that added the
hook below — it queried `NotificationHistory.find(query)...lean()` and returned the rows directly.
If you're looking at an old copy of this file or a diff predating that fix, that's the bug it
corrected.

When working from the full `projectShell` checkout, a new `NotificationHistory.find(...)` (list
query, not `findOne`/`findById`) added under `controllers/*.js` with no
`stripAttachmentsFromMetadata()` call and no explicit `-metadata` projection in the same edit is
mechanically blocked by `.claude/hooks/enforce-hard-rules.mjs` (root-level `PreToolUse` hook).

If PDF generation throws, `applicationReviewProcessed.listener.js` retries
`dispatchNotification` once without the attachment rather than failing the notification
entirely.
