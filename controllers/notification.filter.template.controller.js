const notificationFilterTemplateService = require("../services/notification.filter.template.service.js");
const {
  filter_template_create,
  filter_template_update,
} = require("../validation/notificationTemplate.validation.js");
const { AppError } = require("../errors/AppError.js");

function crmContext(req) {
  const tenantId = req.tenantId || req.ctx?.tenantId;
  const userId = String(req.user?.sub || req.user?.id || req.userId || "");
  return { tenantId, userId };
}

exports.createTemplate = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    const validated = await filter_template_create.validateAsync(req.body);
    const template = await notificationFilterTemplateService.createTemplate(
      tenantId,
      userId,
      validated
    );
    return res.success(template, "Filter template created");
  } catch (e) {
    if (e.isJoi) {
      return res.fail(e.details.map((d) => d.message).join(", "));
    }
    return next(e);
  }
};

exports.getUserTemplates = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    const type = req.query.type || "notification";
    const list =
      await notificationFilterTemplateService.getUserTemplatesWithSystemDefault(
        tenantId,
        userId,
        type
      );
    const userTemplates = list.filter((t) => !t.systemDefault);
    const userHasDefault = userTemplates.some((t) => t.isDefault);
    const systemDefault = list.find((t) => t.systemDefault) || null;
    return res.success({
      total: list.length,
      templates: { systemDefault, userTemplates, userHasDefault },
    });
  } catch (e) {
    return next(e);
  }
};

exports.getTemplateById = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    const template = await notificationFilterTemplateService.getTemplateById(
      req.params.templateId,
      tenantId,
      userId
    );
    return res.success(template);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) {
      return res.notFound(e.message);
    }
    return next(e);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    const validated = await filter_template_update.validateAsync(req.body);
    const template = await notificationFilterTemplateService.updateTemplate(
      req.params.templateId,
      tenantId,
      userId,
      validated
    );
    return res.success(template, "Filter template updated");
  } catch (e) {
    if (e.isJoi) {
      return res.fail(e.details.map((d) => d.message).join(", "));
    }
    if (e instanceof AppError && e.status === 404) {
      return res.notFound(e.message);
    }
    return next(e);
  }
};

exports.deleteTemplate = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    await notificationFilterTemplateService.deleteTemplate(
      req.params.templateId,
      tenantId,
      userId
    );
    return res.success(null, "Filter template deleted");
  } catch (e) {
    if (e instanceof AppError && e.status === 404) {
      return res.notFound(e.message);
    }
    return next(e);
  }
};

exports.getDefaultTemplate = async (req, res, next) => {
  try {
    const { tenantId, userId } = crmContext(req);
    const template = await notificationFilterTemplateService.getDefaultTemplate(
      tenantId,
      userId
    );
    return res.success(template);
  } catch (e) {
    return next(e);
  }
};
