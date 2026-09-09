const salesModel = require("../models/sales.model");
const { sendTemplateMessage } = require("./whatsapp.service");
const { getDiscountTiersForCreditPeriod } = require("../utils/discountTiers");
const company = require("../config/company");

const COMPANY_BANK = {
  bank_name: company.bank.bankName,
  account_name: company.bank.accountName,
  account_number: company.bank.accountNumber,
  ifsc_code: company.bank.ifscCode,
};

const TEMPLATE_LANGUAGE = "en_US"; // TODO: confirm this matches the language set on each template in Meta Business Manager

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};
const formatDMY = (d) => {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}-${String(dt.getMonth() + 1).padStart(2, "0")}-${dt.getFullYear()}`;
};

const toBodyComponents = (params) => [
  {
    type: "body",
    parameters: params.map((p) => ({ type: "text", text: String(p) })),
  },
];

async function sendIfNotSent(bill, templateName, today, params, results, discountPercent = null) {
  const already = await salesModel.hasReminderBeenSentToday(bill.bill_reference_id, templateName, today);
  if (already) return;

  let status = "SENT";
  let responsePayload;

  try {
    const data = await sendTemplateMessage(bill.contact, templateName, TEMPLATE_LANGUAGE, toBodyComponents(params));
    responsePayload = data;
  } catch (err) {
    status = "FAILED";
    responsePayload = err.response?.data || err.message;
  }

  await salesModel.logReminderSent({
    bill_reference_id: bill.bill_reference_id,
    template_name: templateName,
    sent_date: today,
    discount_percent: discountPercent,
    status,
    response_payload: JSON.stringify(responsePayload),
  });

  results.push({ bill: bill.reference_no, template: templateName, success: status === "SENT" });
}

exports.runDailyReminders = async () => {
  const bills = await salesModel.getActiveBillsForReminders();
  const today = todayStr();
  const results = [];

  for (const bill of bills) {
    if (!bill.contact) continue; // no phone on file

    const daysSinceSale = daysBetween(bill.sales_date, today);
    const daysPastDue = daysBetween(bill.due_date, today);
    const creditPeriod = Number(bill.default_credit_period || 0);
    const gracePeriod = Number(bill.grace_period || 0);
    const customerName = bill.customer_name || bill.ledger_name;
    const amount = Number(bill.pending_amount).toFixed(2);

    // Track A — discount tiers, only while still before the due date
    if (daysPastDue < 0) {
      const tier = getDiscountTiersForCreditPeriod(creditPeriod).find((t) => t.sendDay === daysSinceSale);
      if (tier) {
        await sendIfNotSent(
          bill, "payment_due_reminder", today,
          [
            customerName, bill.reference_no, amount,
            formatDMY(addDays(bill.sales_date, tier.windowDay)),
            tier.discountPercent,
            COMPANY_BANK.bank_name, COMPANY_BANK.account_name,
            COMPANY_BANK.account_number, COMPANY_BANK.ifsc_code,
          ],
          results, tier.discountPercent
        );
      }
      continue;
    }

    // Track B — due today
    if (daysPastDue === 0) {
      await sendIfNotSent(bill, "payment_due_today", today, [
        customerName, bill.reference_no, amount, formatDMY(bill.due_date),
        COMPANY_BANK.bank_name, COMPANY_BANK.account_name,
        COMPANY_BANK.account_number, COMPANY_BANK.ifsc_code,
      ], results);
      continue;
    }

    // Track B — inside grace period, daily
    if (daysPastDue > 0 && daysPastDue <= gracePeriod) {
      await sendIfNotSent(bill, "payment_overdue_1", today, [
        customerName, bill.reference_no, amount, formatDMY(bill.due_date),
      ], results);
      continue;
    }

    // Track B — day after grace period ends, once
    if (daysPastDue === gracePeriod + 1) {
      await sendIfNotSent(bill, "payment_overdue_2", today, [
        customerName, bill.reference_no, amount, formatDMY(bill.due_date),
      ], results);
    }
  }

  return results;
};