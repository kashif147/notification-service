const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { paths, sboLayout, sd19LayoutFallback } = require("../config/membershipFormLayout.js");
const logger = require("../config/logger.js");
const {
  detectSd19FillLayoutFromBytes,
} = require("./sd19LayoutDetect.js");

/**
 * Draw text horizontally centred on [lineLeft, lineRight] at baseline y.
 * Shrinks font slightly if the string would overflow the segment.
 */
function drawTextCenteredOnLine(page, font, rawText, row, color) {
  let text = String(rawText ?? "").trim();
  if (!text) return;

  const { lineLeft, lineRight, y, size: baseSize } = row;
  const maxWidth = Math.max(0, lineRight - lineLeft - 4);
  let size = baseSize;
  let width = font.widthOfTextAtSize(text, size);
  while (width > maxWidth && size > 6) {
    size -= 0.5;
    width = font.widthOfTextAtSize(text, size);
  }
  if (width > maxWidth && maxWidth > 0) {
    const ellipsis = "...";
    while (
      text.length > 1 &&
      font.widthOfTextAtSize(text + ellipsis, size) > maxWidth
    ) {
      text = text.slice(0, -1);
    }
    text += ellipsis;
    width = font.widthOfTextAtSize(text, size);
  }

  const mid = (lineLeft + lineRight) / 2;
  const x = mid - width / 2;
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color,
  });
}

/**
 * @param {"SBO"|"SD19"} kind
 * @param {{
 *   memberId: string,
 *   payrollNo?: string|null,
 *   memberFullName?: string|null,
 *   workLocation?: string|null,
 * }} fields
 * @returns {Promise<Buffer>}
 */
async function buildPrefilledMembershipFormPdf(
  kind,
  { memberId, payrollNo, memberFullName, workLocation },
) {
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
    let L;
    try {
      L = await detectSd19FillLayoutFromBytes(new Uint8Array(bytes));
    } catch (err) {
      logger.warn(
        { err: err?.message },
        "sd19: layout detect failed, using env/fallback coordinates"
      );
      L = sd19LayoutFallback();
    }
    drawTextCenteredOnLine(page, font, memberFullName, L.name, black);
    drawTextCenteredOnLine(page, font, workLocation, L.employedAt, black);
    drawTextCenteredOnLine(page, font, memberId, L.inmo, black);
    const payrollText =
      payrollNo != null && String(payrollNo).trim() !== ""
        ? String(payrollNo).trim()
        : "";
    if (payrollText) {
      drawTextCenteredOnLine(page, font, payrollText, L.payroll, black);
    }
  }

  const out = await doc.save();
  return Buffer.from(out);
}

module.exports = { buildPrefilledMembershipFormPdf };
