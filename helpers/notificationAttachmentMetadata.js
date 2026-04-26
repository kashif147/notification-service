/**
 * In-app notification PDFs are stored in metadata.attachments[].dataBase64.
 * List/history responses must not ship large payloads; clients fetch full doc by id.
 */
function stripAttachmentsFromMetadata(metadata) {
  if (!metadata || !Array.isArray(metadata.attachments)) {
    return metadata;
  }
  return {
    ...metadata,
    attachments: metadata.attachments.map((a) => {
      if (!a || typeof a !== "object") return a;
      const { dataBase64, ...rest } = a;
      return {
        ...rest,
        hasData: Boolean(dataBase64),
        size:
          dataBase64 != null
            ? Math.floor((String(dataBase64).length * 3) / 4)
            : a.size,
      };
    }),
  };
}

function metadataHasAttachmentPayload(metadata) {
  if (!metadata?.attachments?.length) return false;
  return metadata.attachments.some(
    (a) => a && typeof a === "object" && a.dataBase64
  );
}

module.exports = {
  stripAttachmentsFromMetadata,
  metadataHasAttachmentPayload,
};
