const User = require("../models/user.model");
const Penalty = require("../models/penalty.model");
const { sendTemplateMessage } = require("../services/whatsapp.service");

const formatPhoneForWhatsapp = (contactNo) => {
  if (!contactNo) return null;
  const digits = String(contactNo).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

exports.sendPenaltyNotice = async (req, res) => {
  try {
    const { employee_id, reason, amount } = req.body;
    const imposed_by = req.user?.id; // from auth middleware

    if (!employee_id || !reason || amount === undefined || amount === null) {
      return res.status(400).json({
        message: "employee_id, reason and amount are required",
      });
    }

    if (!imposed_by) {
      return res.status(401).json({ message: "Unable to identify requesting user" });
    }

    const parsedAmount = Number(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const employee = await User.getUserContactById(employee_id);
    if (!employee) {
      return res.status(404).json({ message: "Employee not found or inactive" });
    }

    // 1. Persist the penalty first — this is the record of truth
    const penaltyId = await Penalty.createPenalty({
      employee_id,
      reason,
      amount: parsedAmount,
      imposed_by,
    });

    // 2. Attempt notification, but don't let its failure undo the record
    const phone = formatPhoneForWhatsapp(employee.contact_no);
    let notified = false;

    if (phone) {
      try {
        await sendTemplateMessage(phone, "employee_penalty_notice", "en_US", [
          {
            type: "body",
            parameters: [
              { type: "text", text: employee.name },
              { type: "text", text: reason },
              { type: "text", text: parsedAmount.toFixed(2) },
            ],
          },
        ]);
        notified = true;
        await Penalty.markPenaltyNotified(penaltyId);
      } catch (whatsappError) {
        console.error(
          "WhatsApp send failed for penalty:",
          penaltyId,
          whatsappError.response?.data || whatsappError.message
        );
        // swallow — penalty is still recorded, just not notified
      }
    }

    return res.json({
      success: true,
      penaltyId,
      whatsappSent: notified,
      message: notified
        ? `Penalty recorded and notice sent to ${employee.name}`
        : `Penalty recorded, but WhatsApp notice could not be sent${phone ? "" : " (no valid contact number)"}`,
    });
  } catch (error) {
    console.error(
      "Send Penalty Notice Error:",
      error.response?.data || error.message
    );
    return res.status(500).json({
      success: false,
      message: "Failed to process penalty",
    });
  }
};