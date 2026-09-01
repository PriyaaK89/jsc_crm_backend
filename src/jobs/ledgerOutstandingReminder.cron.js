// cron/ledgerOutstandingReminder.cron.js
const cron = require("node-cron");
const db = require("../config/db");
const { sendTemplateMessage } = require("../services/whatsapp.service");
const { getPresignedUrl } = require("../utils/fileUpload");
const { getCurrentLedgerBalance } = require("../models/ledger.model");
const companyConfig = require("../config/company"); // adjust path if different

const QR_OBJECT_PATH = "template/jamidara qr.png"; // adjust if the actual stored path differs

const formatPhoneForWhatsapp = (contactNo) => {
  if (!contactNo) return null;
  const digits = String(contactNo).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

cron.schedule(
  "0 11 * * *",
  async () => {
    console.log("Running ledger outstanding reminder cron (11 AM IST)...");

    try {
      let qrImageLink;
      try {
        qrImageLink = await getPresignedUrl(QR_OBJECT_PATH, 30 * 60);
      } catch (qrError) {
        console.error("Failed to generate presigned URL for QR image, aborting run:", qrError.message);
        return;
      }

      // No longer need ledger_bank_details — bank info is the company's, not the customer's
      const [ledgers] = await db.query(`
        SELECT
          l.id,
          l.ledger_name,
          lod.contact
        FROM ledgers l
        LEFT JOIN ledger_other_details lod ON lod.ledger_id = l.id
        WHERE lod.contact IS NOT NULL AND lod.contact != ''
      `);

      console.log(`Ledgers with contact numbers: ${ledgers.length}`);

      for (const ledger of ledgers) {
        try {
          const currentBalance = await getCurrentLedgerBalance(db, ledger.id);

          if (currentBalance <= 0) continue;

          const phone = formatPhoneForWhatsapp(ledger.contact);
          if (!phone) {
            console.error(`No valid contact for ledger ${ledger.id} (${ledger.ledger_name})`);
            continue;
          }

          await sendTemplateMessage(phone, "ledger_outstanding_reminder", "en_US", [
            {
              type: "header",
              parameters: [{ type: "image", image: { link: qrImageLink } }],
            },
            {
              type: "body",
              parameters: [
                { type: "text", text: ledger.ledger_name },
                { type: "text", text: currentBalance.toFixed(2) },
                { type: "text", text: companyConfig.bank.bankName },
                { type: "text", text: companyConfig.bank.accountName },
                { type: "text", text: companyConfig.bank.accountNumber },
                { type: "text", text: companyConfig.bank.ifscCode },
              ],
            },
          ]);

          console.log(`Reminder sent: ${ledger.ledger_name} — ₹${currentBalance.toFixed(2)} — ${phone}`);
        } catch (ledgerError) {
          console.error(
            `Failed for ledger ${ledger.id} (${ledger.ledger_name})`,
            ledgerError.response?.data || ledgerError.message
          );
        }
      }

      console.log("Ledger outstanding reminder cron completed");
    } catch (error) {
      console.error("LEDGER OUTSTANDING REMINDER CRON FAILED:", error);
    }
  },
  { timezone: "Asia/Kolkata" }
);

module.exports = {};