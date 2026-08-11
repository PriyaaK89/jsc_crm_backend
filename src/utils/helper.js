// utils/formatMobile.js
function formatMobileForWhatsapp(number) {
  if (!number) return null;
  let mobile = number.replace(/\D/g, "");
  if (!mobile.startsWith("91")) {
    mobile = "91" + mobile;
  }
  return mobile;
}

function formatOrderNoForWhatsapp(orderNo) {
  if (!orderNo) return orderNo;

  const match = String(orderNo).match(/(\d+)\s*$/);
  if (!match) return orderNo; // fallback: no digits found, return as-is

  const originalDigits = match[1];
  const numericValue = parseInt(originalDigits, 10);

  // Pad to 3 digits minimum; numbers >= 100 are left as-is
  const padded = String(numericValue).padStart(3, "0");

  return `JSC-ORD-${padded}`;
}

/**
 * Generic doc-number formatter for WhatsApp messages.
 * "SALE-1" + "JSC-ORD"  -> "JSC-ORD-001"
 * "RCPT-2026-00125" + "JSC-RECP" -> "JSC-RECP-125"   (trailing digits only, padded to 3)
 */
function formatDocNoForWhatsapp(docNo, prefix) {
  if (!docNo) return docNo;

  const match = String(docNo).match(/(\d+)\s*$/);
  if (!match) return docNo; // no trailing digits found, return as-is

  const numericValue = parseInt(match[1], 10);
  const padded = String(numericValue).padStart(3, "0");

  return `${prefix}-${padded}`;
}

function formatAmountForWhatsapp(amount) {
  const num = Number(amount || 0);
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateForWhatsapp(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${d.getDate()} ${months[d.getMonth()]}, ${d.getFullYear()}`;
}

function getFinancialYear(date = new Date()) {
    const year = date.getFullYear();

    if (date.getMonth() >= 3) {
        return `${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
    }

    return `${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
}

function getCurrentMonth(date = new Date()) {
    return String(date.getMonth() + 1).padStart(2, "0");
}

module.exports = {
  formatMobileForWhatsapp, formatOrderNoForWhatsapp,
  formatDocNoForWhatsapp,
  formatAmountForWhatsapp,
  formatDateForWhatsapp,  getFinancialYear,
    getCurrentMonth,
};
