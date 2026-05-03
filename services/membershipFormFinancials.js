const path = require("path");

/** Resolve subscription-service fee helper without coupling notification-service package.json */
function loadGetMembershipFeeByCategory() {
  try {
    const svcPath = path.join(
      __dirname,
      "../../subscription-service/helpers/serviceClient.js",
    );
    const mod = require(svcPath);
    return typeof mod.getMembershipFeeByCategory === "function"
      ? mod.getMembershipFeeByCategory
      : () => 0;
  } catch {
    return () => 0;
  }
}

const getMembershipFeeByCategory = loadGetMembershipFeeByCategory();

function normalizeFrequency(raw) {
  if (raw == null || raw === "") return "";
  return String(raw).trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Maps subscription payment frequency label to periods per year for installment math.
 * Weekly / Fortnightly supported for future enum expansion and plain-text payloads.
 */
function periodsPerYearFromFrequency(raw) {
  const n = normalizeFrequency(raw);
  if (!n) return 12;
  if (
    (n.includes("week") || n === "weekly") &&
    !n.includes("fortnight") &&
    !n.includes("biweek") &&
    n !== "biweekly"
  ) {
    return 52;
  }
  if (
    n.includes("fortnight") ||
    n.includes("biweek") ||
    n === "twoweek" ||
    n === "2week"
  ) {
    return 26;
  }
  if (n.includes("month")) return 12;
  if (n.includes("quarter")) return 4;
  if (
    n.includes("annual") ||
    n.includes("year") ||
    n === "yearly" ||
    n === "once"
  ) {
    return 1;
  }
  return 12;
}

/** Frequency keys aligned with layout env / PDF drawing */
function frequencyLayoutKey(raw) {
  const n = normalizeFrequency(raw);
  if (
    (n.includes("week") || n === "weekly") &&
    !n.includes("fortnight") &&
    !n.includes("biweek") &&
    n !== "biweekly"
  ) {
    return "Weekly";
  }
  if (
    n.includes("fortnight") ||
    n.includes("biweek") ||
    n === "biweekly"
  ) {
    return "Fortnightly";
  }
  if (n.includes("month")) return "Monthly";
  if (n.includes("quarter")) return "Quarterly";
  if (
    n.includes("annual") ||
    n.includes("year") ||
    n === "yearly"
  ) {
    return "Annually";
  }
  return "Monthly";
}

/**
 * Annual subscription fee in euros — explicit subscription fields first, then category table.
 */
function resolveAnnualFeeEuros(subscriptionDetails = {}) {
  const sd = subscriptionDetails;
  const tryNum = (v) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? x : 0;
  };

  const explicit = [
    sd.membershipFeeAnnualEur,
    sd.annualMembershipFee,
    sd.membershipFee,
    sd.invoiceAmountEur,
    sd.invoiceTotalEur,
    sd.subscriptionFeeAnnual,
  ];
  for (const c of explicit) {
    const v = tryNum(c);
    if (v > 0) return v;
  }

  const fromCategory = tryNum(getMembershipFeeByCategory(sd.membershipCategory));
  return fromCategory > 0 ? fromCategory : 0;
}

function formatInstallmentEuro(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function computeInstallmentDisplay(subscriptionDetails = {}) {
  const annual = resolveAnnualFeeEuros(subscriptionDetails);
  const periods = periodsPerYearFromFrequency(
    subscriptionDetails.paymentFrequency,
  );
  if (!annual || !periods) return { amountStr: "", periods };
  const per = annual / periods;
  return {
    amountStr: formatInstallmentEuro(per),
    annualEur: annual,
    periods,
    layoutFreqKey: frequencyLayoutKey(subscriptionDetails.paymentFrequency),
  };
}

module.exports = {
  periodsPerYearFromFrequency,
  frequencyLayoutKey,
  resolveAnnualFeeEuros,
  computeInstallmentDisplay,
};
