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

function sd19Layout() {
  return {
    inmo: {
      x: numEnv("FORM_SD19_INMO_X", 200),
      y: numEnv("FORM_SD19_INMO_Y", 688),
      size: numEnv("FORM_SD19_INMO_SIZE", 9),
    },
    payroll: {
      x: numEnv("FORM_SD19_PAYROLL_X", 400),
      y: numEnv("FORM_SD19_PAYROLL_Y", 688),
      size: numEnv("FORM_SD19_PAYROLL_SIZE", 9),
    },
  };
}

module.exports = {
  paths,
  sboLayout,
  sd19Layout,
};
