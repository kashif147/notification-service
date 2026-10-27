const Template = require("../models/template.model.js");
const { AppError } = require("../errors/AppError.js");
const {
  assertSharedTemplateDeleteAllowed,
  assertSharedTemplateUpdateAllowed,
  isFrozenSharedTemplate,
} = require("./sharedTemplateFreeze");

function toTemplateResponse(doc) {
  const obj =
    doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete obj.meta;
  delete obj.__v;
  return obj;
}

class NotificationFilterTemplateService {
  async createTemplate(tenantId, userId, templateData) {
    const {
      name,
      templateType,
      filters,
      columns,
      columnLabels,
      visibleFilters,
      isDefault,
      pinned,
    } = templateData;
    const type = templateType || "notification";

    if (isDefault) {
      await Template.updateMany(
        {
          tenantId,
          userId,
          templateType: type,
          isDefault: true,
          "meta.deleted": false,
        },
        { $set: { isDefault: false } }
      );
    }

    const template = new Template({
      tenantId,
      userId,
      name: name != null && name !== "" ? name : undefined,
      templateType: type,
      filters: filters || {},
      columns: columns || [],
      columnLabels: columnLabels || {},
      visibleFilters: Array.isArray(visibleFilters) ? visibleFilters : [],
      isDefault: isDefault || false,
      pinned: pinned || false,
    });

    const saved = await template.save();
    return toTemplateResponse(saved);
  }

  async getUserTemplatesWithSystemDefault(tenantId, userId, type = "notification") {
    const typeFilter = { templateType: type };

    const systemDefault = await Template.findOne({
      tenantId,
      systemDefault: true,
      "meta.deleted": false,
      ...typeFilter,
    });

    const userTemplates = await Template.find({
      tenantId,
      userId,
      "meta.deleted": false,
      ...typeFilter,
    }).sort({ isDefault: -1, createdAt: -1 });

    const allTemplates = [];
    if (systemDefault) allTemplates.push(systemDefault);
    allTemplates.push(...userTemplates);
    return allTemplates;
  }

  async getTemplateById(templateId, tenantId, userId) {
    const systemDefault = await Template.findOne({
      _id: templateId,
      tenantId,
      systemDefault: true,
      "meta.deleted": false,
    });
    if (systemDefault) {
      const type = systemDefault.templateType || "notification";
      const userHasDefault = await Template.exists({
        tenantId,
        userId,
        templateType: type,
        isDefault: true,
        "meta.deleted": false,
      });
      const out = toTemplateResponse(systemDefault);
      if (!userHasDefault) out.isDefault = true;
      return out;
    }

    const template = await Template.findOne({
      _id: templateId,
      tenantId,
      userId,
      "meta.deleted": false,
    });

    if (!template) {
      throw AppError.notFound("Filter template not found");
    }

    return template;
  }

  async updateTemplate(templateId, tenantId, userId, updateData) {
    const {
      name,
      templateType,
      filters,
      columns,
      columnLabels,
      visibleFilters,
      isDefault,
      pinned,
    } = updateData;

    let template = await Template.findOne({
      _id: templateId,
      tenantId,
      systemDefault: true,
      "meta.deleted": false,
    });

    if (!template) {
      template = await Template.findOne({
        _id: templateId,
        tenantId,
        userId,
        "meta.deleted": false,
      });
    }

    if (!template) {
      throw AppError.notFound("Filter template not found");
    }

    const type =
      templateType !== undefined ? templateType : template.templateType;

    // Phase A / A14: a shared (null-tenant) default is write-frozen - 423 on any real change; the
    // per-user isDefault preference still works and the shared row itself is never saved.
    assertSharedTemplateUpdateAllowed(template, updateData);
    const sharedFrozen = isFrozenSharedTemplate(template);

    if (template.systemDefault) {
      if (isDefault === true) {
        await Template.updateMany(
          {
            tenantId,
            userId,
            templateType: type,
            "meta.deleted": false,
          },
          { $set: { isDefault: false } }
        );
      }
      if (pinned !== undefined) template.pinned = pinned;
      const saved = sharedFrozen ? template : await template.save();
      const response = toTemplateResponse(saved);
      if (isDefault === true) response.isDefault = true;
      return response;
    }

    if (isDefault === true) {
      await Template.updateMany(
        {
          tenantId,
          userId,
          templateType: type,
          _id: { $ne: templateId },
          "meta.deleted": false,
        },
        { $set: { isDefault: false } }
      );
    }

    if (name !== undefined) {
      template.name = name !== "" ? name : null;
    }
    if (templateType !== undefined) {
      template.templateType = templateType;
    }
    if (filters !== undefined) {
      template.filters = filters;
    }
    if (columns !== undefined) {
      template.columns = columns;
    }
    if (columnLabels !== undefined) {
      template.columnLabels = columnLabels;
    }
    if (visibleFilters !== undefined) {
      template.visibleFilters = Array.isArray(visibleFilters)
        ? visibleFilters
        : [];
    }
    if (isDefault !== undefined) {
      template.isDefault = isDefault;
    }
    if (pinned !== undefined) {
      template.pinned = pinned;
    }

    const saved = await template.save();
    return toTemplateResponse(saved);
  }

  async deleteTemplate(templateId, tenantId, userId) {
    const template = await Template.findOne({
      _id: templateId,
      tenantId,
      userId,
      "meta.deleted": false,
    });

    if (!template) {
      throw AppError.notFound("Filter template not found");
    }

    assertSharedTemplateDeleteAllowed(template); // Phase A / A14: shared default -> 423
    template.meta.deleted = true;
    template.meta.deletedAt = new Date();
    return template.save();
  }

  async getDefaultTemplate(tenantId, userId) {
    let template = await Template.findOne({
      tenantId,
      userId,
      isDefault: true,
      "meta.deleted": false,
    });

    if (!template) {
      template = new Template({
        tenantId,
        userId,
        templateType: "notification",
        filters: {},
        columns: [],
        isDefault: true,
        pinned: false,
      });
      template = await template.save();
    }

    return template;
  }

  async getDefaultTemplateForType(tenantId, userId, type = "notification") {
    return Template.findOne({
      tenantId,
      userId,
      templateType: type,
      isDefault: true,
      "meta.deleted": false,
    });
  }

  async getSystemDefaultTemplate(tenantId, type = "notification") {
    const query = {
      tenantId,
      systemDefault: true,
      "meta.deleted": false,
    };
    if (type) {
      query.templateType = type;
    }
    const template = await Template.findOne(query);

    if (!template) {
      throw AppError.notFound(
        "System default notification template not found. Seed one with systemDefault: true for this tenant."
      );
    }

    return template;
  }
}

module.exports = new NotificationFilterTemplateService();
