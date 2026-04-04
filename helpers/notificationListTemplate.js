const {
  FILTER_OPERATOR,
  NOTIFICATION_FILTER_FIELD_MAP,
} = require("../constants/notificationTemplate.js");

function resolveFilterKey(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  return Object.keys(NOTIFICATION_FILTER_FIELD_MAP).find(
    (x) => x.toLowerCase() === k
  );
}

function coerceBooleanValues(values) {
  return values.map((v) => {
    const s = String(v).trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    return Boolean(v);
  });
}

const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "delivered"];

function normalizeStatus(v) {
  const n = String(v).trim().toLowerCase();
  return NOTIFICATION_STATUSES.find((s) => s === n) || String(v).trim();
}

/**
 * @param {Record<string, { operator: string, values: string[] }>} filters
 * @param {string} tenantId
 */
function buildNotificationMongoQueryFromTemplateFilters(filters, tenantId) {
  const query = { tenantId };

  for (const [filterKey, filterEntry] of Object.entries(filters || {})) {
    if (
      !filterEntry ||
      !filterEntry.values ||
      filterEntry.values.length === 0
    ) {
      continue;
    }

    const resolvedKey = resolveFilterKey(filterKey);
    if (!resolvedKey) continue;

    const config = NOTIFICATION_FILTER_FIELD_MAP[resolvedKey];
    const path = config.path;
    const op =
      filterEntry.operator === FILTER_OPERATOR.EQUAL_TO ? "$in" : "$nin";

    let values = filterEntry.values.map((v) =>
      typeof v === "string" ? v.trim() : v
    );

    if (config.type === "boolean") {
      const bools = coerceBooleanValues(values);
      query[path] = { [op]: bools };
      continue;
    }

    if (resolvedKey === "status") {
      const mapped = values.map((v) => normalizeStatus(v));
      query[path] = { [op]: mapped };
      continue;
    }

    query[path] = { [op]: values.map((v) => String(v)) };
  }

  return query;
}

function filterByColumns(obj, columns) {
  if (!columns || columns.length === 0) {
    return obj;
  }

  const result = {};

  columns.forEach((column) => {
    const parts = column.split(".");
    let current = obj;
    let resultCurrent = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (i === parts.length - 1) {
        if (current && current[part] !== undefined) {
          resultCurrent[part] = current[part];
        }
      } else {
        if (current && current[part] !== undefined) {
          if (!resultCurrent[part]) {
            resultCurrent[part] = {};
          }
          current = current[part];
          resultCurrent = resultCurrent[part];
        } else {
          break;
        }
      }
    }
  });

  const orderedTopKeys = [];
  for (const column of columns) {
    const topKey = column.split(".")[0];
    if (topKey && !orderedTopKeys.includes(topKey)) {
      orderedTopKeys.push(topKey);
    }
  }
  const orderedResult = {};
  for (const key of orderedTopKeys) {
    if (result[key] !== undefined) {
      orderedResult[key] = result[key];
    }
  }
  return orderedResult;
}

module.exports = {
  buildNotificationMongoQueryFromTemplateFilters,
  filterByColumns,
};
