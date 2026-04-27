const path = require("path");

/**
 * Flat INMO PDFs (no AcroForm fields) — text is drawn at configurable coordinates
 * (PDF user space, origin bottom-left). Override via env to align with your print layout.
 */
function numEnv(key, defaultVal) {
  const v = process.env[key];
  if (v == null || v === "") return defaultVal;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultVal;
}

const assetDir = path.join(__dirname, "../assets/membership-forms");

function paths() {
  return {
    sbo:
      process.env.MEMBERSHIP_FORM_SBO_PDF || path.join(assetDir, "sbo-2492.pdf"),
    sd19:
      process.env.MEMBERSHIP_FORM_SD19_PDF || path.join(assetDir, "sd19.pdf"),
  };
}

function sboLayout() {
  return {
    memberRef: {
      x: numEnv("FORM_SBO_INMO_REF_X", 320),
      y: numEnv("FORM_SBO_INMO_REF_Y", 698),
      size: numEnv("FORM_SBO_INMO_REF_SIZE", 9),
    },
  };
}

/**
 * SD19 fallback layout — used only if pdf.js cannot read underscore segments (rare).
 * Prefer automatic detection in sd19LayoutDetect.js.
 */
function sd19LayoutFallback() {
  const pageW = 595.32;
  const margin = 28;
  const defaultFullWidthRight = pageW - margin;

  return {
    name: {
      lineLeft: numEnv("FORM_SD19_NAME_LINE_LEFT", 118),
      lineRight: numEnv("FORM_SD19_NAME_LINE_RIGHT", defaultFullWidthRight),
      y: numEnv("FORM_SD19_NAME_LINE_Y", 704),
      size: numEnv("FORM_SD19_NAME_SIZE", 10),
    },
    employedAt: {
      lineLeft: numEnv("FORM_SD19_EMPLOYED_LINE_LEFT", 118),
      lineRight: numEnv("FORM_SD19_EMPLOYED_LINE_RIGHT", defaultFullWidthRight),
      y: numEnv("FORM_SD19_EMPLOYED_LINE_Y", 676),
      size: numEnv("FORM_SD19_EMPLOYED_SIZE", 10),
    },
    inmo: {
      lineLeft: numEnv("FORM_SD19_INMO_LINE_LEFT", 132),
      lineRight: numEnv("FORM_SD19_INMO_LINE_RIGHT", 420),
      y: numEnv("FORM_SD19_INMO_LINE_Y", 408),
      size: numEnv("FORM_SD19_INMO_SIZE", 10),
    },
    payroll: {
      lineLeft: numEnv("FORM_SD19_PAYROLL_LINE_LEFT", 132),
      lineRight: numEnv("FORM_SD19_PAYROLL_LINE_RIGHT", 420),
      y: numEnv("FORM_SD19_PAYROLL_LINE_Y", 376),
      size: numEnv("FORM_SD19_PAYROLL_SIZE", 10),
    },
  };
}

module.exports = {
  paths,
  sboLayout,
  sd19LayoutFallback,
};
