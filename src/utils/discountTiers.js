const DISCOUNT_TIERS = [
  { sendRatio: 5 / 30, windowRatio: 7 / 30, discountPercent: 8 },
  { sendRatio: 13 / 30, windowRatio: 15 / 30, discountPercent: 5 },
  { sendRatio: 23 / 30, windowRatio: 25 / 30, discountPercent: 3 },
];

function getDiscountTiersForCreditPeriod(creditPeriodDays) {
  if (!creditPeriodDays || creditPeriodDays <= 0) return [];

  const tiers = DISCOUNT_TIERS.map((t) => {
    const sendDay = Math.max(1, Math.round(t.sendRatio * creditPeriodDays));
    const windowDay = Math.max(sendDay + 1, Math.round(t.windowRatio * creditPeriodDays));
    return { ...t, sendDay, windowDay };
  });

  const seenDays = new Set();
  return tiers.filter((t) => {
    if (t.windowDay >= creditPeriodDays) return false; // must resolve before due date
    if (seenDays.has(t.sendDay)) return false;          // short credit periods can collapse tiers
    seenDays.add(t.sendDay);
    return true;
  });
}

module.exports = { getDiscountTiersForCreditPeriod };