const db = require("../config/db");
const paymentModel = require("../models/payment.model");
const generateVoucherNo = require("../utils/generateVoucherNo");
const { uploadFileToMinio } = require("../utils/fileUpload");


exports.getPaymentAccountDropdown = async (req, res) => {
  try {
    const data = await paymentModel.getPaymentAccountDropdown();

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getBillReferences = async (req, res) => {
  try {
    const { ledgerId } = req.params;
    const data = await paymentModel.getBillReferences(ledgerId);
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createPayment = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const data = {
      ...req.body,
      entries: JSON.parse(req.body.entries || "[]"),
    };

    let attachment = null;

    if (req.file) {
      const uploadedFile = await uploadFileToMinio(req.file, "txn_payments");

      attachment = uploadedFile.object_path;
    }

    const voucherData = await generateVoucherNo("PAYMENT");

    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    const paymentId = await paymentModel.createPayment(connection, {
      ...data,
      attachment,
      voucher_type_id,
      voucher_no,
      created_by: req.user.id,
    });

    for (const entry of data.entries) {
      const paymentEntryId = await paymentModel.insertPaymentEntry(
        connection,
        paymentId,
        entry,
      );

      if (entry.bill_references && entry.bill_references.length > 0) {
        for (const bill of entry.bill_references) {
          await paymentModel.insertBillReference(
            connection,
            paymentId,
            paymentEntryId,
            entry.ledger_id,
            bill,
          );

          if (
  bill.reference_type === "AGAINST REF" ||
  bill.reference_type === "AGST REF"
) {
            await paymentModel.updatePurchaseBillPendingAmount(
              connection,
              bill.reference_no,
              bill.reference_amount,
            );
          }
        };
      }

      await paymentModel.insertLedgerTransaction(connection, {
        transaction_type: "PAYMENT",
        reference_id: paymentId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.payment_date,
        ledger_id: entry.ledger_id,
        entry_type: "Dr",
        amount: Number(entry.amount),
        remarks: "Payment Entry",
        created_by: req.user.id,
      });
    }

    await paymentModel.insertLedgerTransaction(connection, {
      transaction_type: "PAYMENT",
      reference_id: paymentId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.payment_date,
      ledger_id: data.account_ledger_id,
      entry_type: "Cr",
      amount: Number(data.total_amount),
      remarks: "Payment Account",
      created_by: req.user.id,
    });

    await connection.query(
      `
      UPDATE voucher_types
      SET current_sequence = ?
      WHERE id = ?
      `,
      [nextSequence, voucher_type_id],
    );

    await connection.commit();

    res.status(201).json({
      success: true,
      message: "Payment created successfully",
      payment_id: paymentId,
      voucher_no,
      attachment,
    });
  } catch (error) {
    await connection.rollback();

    console.log("PAYMENT ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getPaymentVoucher =
async (req, res) => {

    try {

        const { id } = req.params;

        const data =
            await paymentModel
            .getPaymentVoucher(id);

        if (!data) {
            return res.status(404).json({
                success: false,
                message:
                    "Payment voucher not found"
            });
        }

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
