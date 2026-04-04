const NotificationHistory = require("../models/notificationHistory.model.js");
const notificationFilterTemplateService = require("../services/notification.filter.template.service.js");
const { AppError } = require("../errors/AppError.js");
const {
  buildNotificationMongoQueryFromTemplateFilters,
  filterByColumns,
} = require("../helpers/notificationListTemplate.js");

function crmContext(req) {
  const tenantId = req.tenantId || req.ctx?.tenantId;
  const userId = String(req.user?.sub || req.user?.id || req.userId || "");
  return { tenantId, userId };
}

/**
 * GET /api/notifications/admin
 * Query: page, limit, userId?, status?, isRead?
 */
exports.listNotificationsAdmin = async (req, res, next) => {
  try {
    const { tenantId } = crmContext(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20)
    );
    const skip = (page - 1) * limit;

    const query = { tenantId };
    if (req.query.userId) {
      query.userId = String(req.query.userId).trim();
    }
    if (req.query.status) {
      query.status = String(req.query.status).trim().toLowerCase();
    }
    if (req.query.isRead !== undefined && req.query.isRead !== "") {
      const v = String(req.query.isRead).toLowerCase();
      query.isRead = v === "true" || v === "1";
    }

    const [totalCount, docs] = await Promise.all([
      NotificationHistory.countDocuments(query),
      NotificationHistory.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const rows = docs.map((n) => ({
      _id: n._id,
      tenantId: n.tenantId,
      userId: n.userId,
      title: n.title,
      body: n.body,
      status: n.status,
      isRead: !!n.isRead,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      sentAt: n.sentAt,
      readAt: n.readAt,
      metadata: n.metadata || {},
      firebaseMessageId: n.firebaseMessageId,
      error: n.error,
    }));

    return res.success({
      data: rows,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 0,
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (e) {
    return next(e);
  }
};

/**
 * PUT /api/notifications/admin/filter
 * Body: { page?, limit?, templateId? }
 */
exports.listNotificationsWithTemplate = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    const page = Math.max(1, parseInt(req.body.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.body.limit, 10) || 20)
    );
    const skip = (page - 1) * limit;
    const templateId = req.body.templateId;

    let template;
    try {
      if (templateId) {
        template = await notificationFilterTemplateService.getTemplateById(
          templateId,
          tenantId,
          userId
        );
        if (template.templateType && template.templateType !== "notification") {
          return res.fail("Template is not a notification template.");
        }
      } else {
        template =
          await notificationFilterTemplateService.getDefaultTemplateForType(
            tenantId,
            userId,
            "notification"
          );
        if (!template) {
          template =
            await notificationFilterTemplateService.getSystemDefaultTemplate(
              tenantId,
              "notification"
            );
        }
      }
    } catch (err) {
      if (err instanceof AppError && err.status === 404) {
        return res.notFound(err.message);
      }
      throw err;
    }

    const filters = template.filters || {};
    const columns = template.columns || [];

    const query = buildNotificationMongoQueryFromTemplateFilters(
      filters,
      tenantId
    );

    const [totalCount, docs] = await Promise.all([
      NotificationHistory.countDocuments(query),
      NotificationHistory.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const fullRows = docs.map((n) => ({
      _id: n._id,
      tenantId: n.tenantId,
      userId: n.userId,
      title: n.title,
      body: n.body,
      status: n.status,
      isRead: !!n.isRead,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      sentAt: n.sentAt,
      readAt: n.readAt,
      metadata: n.metadata || {},
      firebaseMessageId: n.firebaseMessageId,
      error: n.error,
    }));

    const data = fullRows.map((row) => {
      const filtered = filterByColumns(row, columns);
      if (row._id !== undefined) {
        return { _id: row._id, ...filtered };
      }
      return filtered;
    });

    return res.success({
      filter: template.filters || {},
      columns,
      templateId: template._id,
      isDefault: !!template.isDefault,
      systemDefault: !!template.systemDefault,
      data,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit) || 0,
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPreviousPage: page > 1,
      },
    });
  } catch (e) {
    return next(e);
  }
};
