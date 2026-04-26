const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { paths, sboLayout, sd19Layout } = require("../config/membershipFormLayout.js");

/**
 * @param {"SBO"|"SD19"} kind
 * @param {{ memberId: string, payrollNo?: string|null }} fields
 * @returns {Promise<Buffer>}
 */
async function buildPrefilledMembershipFormPdf(kind, { memberId, payrollNo }) {
  const p = paths();
  const srcPath = kind === "SBO" ? p.sbo : p.sd19;
  const bytes = fs.readFileSync(srcPath);
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);

  if (kind === "SBO") {
    const { memberRef } = sboLayout();
    page.drawText(String(memberId), {
      x: memberRef.x,
      y: memberRef.y,
      size: memberRef.size,
      font,
      color: black,
    });
  } else {
    const { inmo, payroll } = sd19Layout();
    page.drawText(String(memberId), {
      x: inmo.x,
      y: inmo.y,
      size: inmo.size,
      font,
      color: black,
    });
    const payrollText =
      payrollNo != null && String(payrollNo).trim() !== ""
        ? String(payrollNo).trim()
        : "";
    if (payrollText) {
      page.drawText(payrollText, {
        x: payroll.x,
        y: payroll.y,
        size: payroll.size,
        font,
        color: black,
      });
    }
  }

  const out = await doc.save();
  return Buffer.from(out);
}

module.exports = { buildPrefilledMembershipFormPdf };
