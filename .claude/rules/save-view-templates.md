# CRM admin notification list + Save View filter templates

`controllers/notification.admin.controller.js` + `controllers/notification.filter.template
.controller.js` (mounted at `/api/notifications/admin`, gated by `authenticate` +
`requireCrmUser` in `app.js`) give CRM staff a searchable grid over all `NotificationHistory` rows
across users.

`models/template.model.js` here is a saved grid filter/column template — the same Save-View
convention as the `template-filters-columns` skill and the analogous `Template` models in
events-service/communication-service. These are unrelated concepts that happen to share a model
name across services, not shared code — this service owns Save-View template storage for the
correspondence/notification-admin grids specifically (see `TEMPLATE_IMPLEMENTATION_PLAYBOOK.md`
at the repo root if working from the full projectShell checkout).

`helpers/notificationListTemplate.js`'s `buildNotificationMongoQueryFromTemplateFilters()` turns
a saved template's filter shape (`constants/notificationTemplate.js`'s
`NOTIFICATION_FILTER_FIELD_MAP`/`FILTER_OPERATOR`) into a Mongo query. Extend that map when a new
filterable field is needed — don't build the query ad hoc in the controller instead.
