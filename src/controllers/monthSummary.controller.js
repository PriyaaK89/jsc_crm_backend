const monthSummaryModel = require("../models/monthSummary.model");

const pad = (n) => String(n).padStart(2, "0");

// Current month range in IST: [start, nextMonthStart)
const getMonthRangeIST = () => {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const y = nowIST.getUTCFullYear();
  const m = nowIST.getUTCMonth(); // 0-based

  const next = new Date(Date.UTC(y, m + 1, 1));

  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`,
    label: nowIST.toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
};

// 18400 -> "₹18.4K", 250000 -> "₹2.5L", 12000000 -> "₹1.2Cr"
const formatCompactINR = (value) => {
  const n = Number(value) || 0;
  const trim = (x) => String(parseFloat(x.toFixed(1)));

  if (n >= 10000000) return `₹${trim(n / 10000000)}Cr`;
  if (n >= 100000) return `₹${trim(n / 100000)}L`;
  if (n >= 1000) return `₹${trim(n / 1000)}K`;
  return `₹${trim(n)}`;
};

exports.getMyMonthSummary = async (req, res) => {
  try {
    const userId = req.user.id; // adjust to match your auth middleware

    const { start, end, label } = getMonthRangeIST();
    const data = await monthSummaryModel.getMonthSummary(userId, start, end);

    const expensesTotal = Number(data.expenses_total) || 0;

    return res.status(200).json({
      success: true,
      data: {
        month: label,
        expenses_filed: expensesTotal,
        expenses_filed_display: formatCompactINR(expensesTotal),
        sales_logged: Number(data.sales_count) || 0,
        receipts: Number(data.receipts_count) || 0,
      },
    });
  } catch (error) {
    console.error("ERROR in getMyMonthSummary:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch monthly summary",
    });
  }
};