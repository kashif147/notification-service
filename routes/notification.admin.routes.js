const express = require("express");
const router = express.Router();
const notificationAdminController = require("../controllers/notification.admin.controller.js");
const notificationFilterTemplateController = require("../controllers/notification.filter.template.controller.js");

router.get("/", notificationAdminController.listNotificationsAdmin);
router.put("/filter", notificationAdminController.listNotificationsWithTemplate);

router.post("/templates", notificationFilterTemplateController.createTemplate);
router.get("/templates", notificationFilterTemplateController.getUserTemplates);
router.get(
  "/templates/default",
  notificationFilterTemplateController.getDefaultTemplate
);
router.get(
  "/templates/:templateId",
  notificationFilterTemplateController.getTemplateById
);
router.put(
  "/templates/:templateId",
  notificationFilterTemplateController.updateTemplate
);
router.delete(
  "/templates/:templateId",
  notificationFilterTemplateController.deleteTemplate
);

/** Fixed path — use when proxy/gateway does not forward `/admin/:id` */
router.get("/preview", notificationAdminController.getNotificationAdminById);

router.get("/:id", notificationAdminController.getNotificationAdminById);

module.exports = router;
