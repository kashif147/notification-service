const Joi = require("joi");
const {
  FILTER_OPERATOR,
  ALLOWED_NOTIFICATION_FILTER_KEYS,
  NOTIFICATION_RESPONSE_COLUMNS,
} = require("../constants/notificationTemplate.js");

const filterEntrySchema = Joi.object({
  operator: Joi.string()
    .valid(FILTER_OPERATOR.EQUAL_TO, FILTER_OPERATOR.NOT_EQUAL_TO)
    .required(),
  values: Joi.array().items(Joi.string()).min(1).required(),
});

const filter_template_create = Joi.object({
  name: Joi.string().trim().allow("", null).optional().default(null),
  templateType: Joi.string().trim().optional().default("notification"),
  filters: Joi.object()
    .pattern(
      Joi.string().valid(...ALLOWED_NOTIFICATION_FILTER_KEYS),
      filterEntrySchema
    )
    .optional()
    .default({}),
  columns: Joi.array()
    .items(Joi.string().valid(...NOTIFICATION_RESPONSE_COLUMNS))
    .optional()
    .default([]),
  isDefault: Joi.boolean().optional().default(false),
  pinned: Joi.boolean().optional().default(false),
});

const filter_template_update = Joi.object({
  name: Joi.string().trim().allow("", null).optional(),
  templateType: Joi.string().trim().optional(),
  filters: Joi.object()
    .pattern(
      Joi.string().valid(...ALLOWED_NOTIFICATION_FILTER_KEYS),
      filterEntrySchema
    )
    .optional(),
  columns: Joi.array()
    .items(Joi.string().valid(...NOTIFICATION_RESPONSE_COLUMNS))
    .optional(),
  isDefault: Joi.boolean().optional(),
  pinned: Joi.boolean().optional(),
}).min(0);

module.exports = {
  filter_template_create,
  filter_template_update,
};
