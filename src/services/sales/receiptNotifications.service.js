const whatsappService = require("../whatsapp.service");
const {
  formatDocNoForWhatsapp,
  formatAmountForWhatsapp,
  formatDateForWhatsapp,
} = require("../../utils/helper");

const formatAmount = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;

exports.sendPaymentConfirmationNotification = async ({
  phone,
  recipientName,
  receiptNo,
  amount,
  paymentDate,
}) => {
  return whatsappService.sendTemplateMessage(
    phone,
    "payment_confirmation",
    "en_US",
    [
      {
        type: "body",
        parameters: [
          { type: "text", text: recipientName },
          { type: "text", text: formatDocNoForWhatsapp(receiptNo, "JSC-RECP") },
          // { type: "text", text: formatAmountForWhatsapp(amount) },
          { type: "text", text: formatAmount(amount) },
          { type: "text", text: formatDateForWhatsapp(paymentDate) },
        ],
      },
    ]
  );
};