const axios = require("axios");
const logger = require("../config/logger.js");

function communicationServiceBaseUrl() {
  const raw =
    process.env.COMMUNICATION_SERVICE_URL ||
    process.env.REACT_APP_COMMUNICATION_SERVICE_URL ||
    "http://communication-service";
  const base = String(raw).trim().replace(/\/$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

/**
 * Fetch generated letter bytes from communication-service (internal).
 */
async function fetchLetterContentBase64({ letterId, tenantId }) {
  if (!letterId || !tenantId) return null;
  const url = `${communicationServiceBaseUrl()}/internal/letters/${encodeURIComponent(
    letterId
  )}/content`;

  try {
    const res = await axios.get(url, {
      headers: {
        "x-internal-request": "true",
        "x-tenant-id": tenantId,
      },
      timeout: 25000,
      validateStatus: () => true,
    });

    if (res.status >= 400 || !res.data?.data?.dataBase64) {
      logger.warn(
        { letterId, tenantId, status: res.status },
        "fetchLetterContentBase64: communication-service returned no content"
      );
      return null;
    }

    return {
      filename: res.data.data.fileName || "letter.docx",
      mimeType: res.data.data.contentType || "application/octet-stream",
      dataBase64: res.data.data.dataBase64,
    };
  } catch (err) {
    logger.warn(
      { letterId, tenantId, err: err.message },
      "fetchLetterContentBase64 failed"
    );
    return null;
  }
}

/**
 * Hydrate metadata.attachments that reference letterId without inline data.
 */
async function hydrateLetterAttachments(metadata, tenantId) {
  if (!metadata || typeof metadata !== "object") return metadata;

  const out = {
    ...metadata,
    attachments: Array.isArray(metadata.attachments)
      ? [...metadata.attachments]
      : [],
  };
  let changed = false;

  for (let i = 0; i < out.attachments.length; i++) {
    const att = out.attachments[i];
    if (!att || att.dataBase64) continue;
    const letterId = att.letterId || metadata.letterId;
    if (!letterId) continue;
    const fetched = await fetchLetterContentBase64({ letterId, tenantId });
    if (!fetched) continue;
    out.attachments[i] = {
      ...att,
      filename: att.filename || fetched.filename,
      mimeType: att.mimeType || fetched.mimeType,
      dataBase64: fetched.dataBase64,
      hasData: true,
    };
    changed = true;
  }

  if (!changed && metadata.letterId) {
    const fetched = await fetchLetterContentBase64({
      letterId: metadata.letterId,
      tenantId,
    });
    if (fetched) {
      out.attachments = [
        ...(out.attachments || []),
        { ...fetched, letterId: metadata.letterId, hasData: true },
      ];
    }
  }

  return out;
}

module.exports = {
  fetchLetterContentBase64,
  hydrateLetterAttachments,
  communicationServiceBaseUrl,
};
