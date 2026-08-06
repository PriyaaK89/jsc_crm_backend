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

module.exports = { formatMobileForWhatsapp, formatOrderNoForWhatsapp };