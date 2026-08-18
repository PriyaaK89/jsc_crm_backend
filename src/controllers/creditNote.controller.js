const db = require("../config/db");
const creditNoteModel = require("../models/creditNote.model");
const purchaseModel = require("../models/purchaseTxnMaster.model");
const generateVoucherNo = require("../utils/generateVoucherNo");
const { uploadFileToMinio } = require("../utils/fileUpload");
const validateVoucherDate = require("../utils/validateVoucherDate");
const { sendTemplateMessage } = require("../services/whatsapp.service");
const { formatMobileForWhatsapp, formatDocNoForWhatsapp,formatAmountForWhatsapp, formatDateForWhatsapp, } = require("../utils/helper");

  // const formatAmountForWhatsapp = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;

exports.createCreditNote = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const data = {
      ...req.body,
      items: JSON.parse(req.body.items || "[]"),
      bill_references: JSON.parse(
        req.body.bill_references || "[]"
      ),
      assign_employee_id:
        req.body.assign_employee_id &&
          req.body.assign_employee_id !== "null"
          ? Number(req.body.assign_employee_id)
          : null,

      employee_under_id:
        req.body.employee_under_id &&
          req.body.employee_under_id !== "null"
          ? Number(req.body.employee_under_id)
          : null,
    };

    let bill_t_image = null;

    if (req.files?.bill_t_image?.[0]) {
      const uploadedBill = await uploadFileToMinio(
        req.files.bill_t_image[0],
        "txn_creditNote"
      );

      bill_t_image = uploadedBill.object_path;
    }

    // Upload Dispatch Document File
    let dispatch_doc_image = null;

    if (req.files?.dispatch_doc_image?.[0]) {
      const uploadedDispatch = await uploadFileToMinio(
        req.files.dispatch_doc_image[0],
        "txn_creditNote"
      );

      dispatch_doc_image = uploadedDispatch.object_path;
    }

    await validateVoucherDate(
      connection,
      "CREDIT_NOTE",
      data.credit_note_date
    );

    const voucherData = await generateVoucherNo("CREDIT_NOTE");
    const { voucher_no, voucher_type_id, nextSequence } = voucherData;

    /* RETURN QTY VALIDATION */

    for (const item of data.items) {
      const soldQty = await creditNoteModel.getSoldQtyByInvoice(
        connection,
        data.original_sale_id,
        item.stock_item_id,
        item.godown_id,
        item.batch_no || null,
      );

      const alreadyReturnedQty = await creditNoteModel.getReturnedQtyByInvoice(
        connection,
        data.original_sale_id,
        item.stock_item_id,
        item.godown_id,
        item.batch_no || null,
      );

      const availableToReturn = soldQty - alreadyReturnedQty;

      if (Number(item.return_qty) > Number(availableToReturn)) {
        throw new Error(
          `Return Qty exceeds sold qty for Item ID ${item.stock_item_id}.
            Sold Qty: ${soldQty},
            Already Returned: ${alreadyReturnedQty},
            Available To Return: ${availableToReturn},
            Trying To Return: ${item.return_qty}`,
        );
      }
    }

    const creditNoteId = await creditNoteModel.createCreditNote(connection, {
      ...data,
      voucher_no,
      bill_t_image,
      assign_employee_id: data.assign_employee_id || null,
      employee_under_id: data.employee_under_id || null,
      dispatch_doc_image,
      voucher_type_id,
      created_by: req.user.id,
    });

    for (const item of data.items) {
      await creditNoteModel.insertCreditNoteItem(
        connection,
        item,
        creditNoteId,
      );

      await creditNoteModel.insertCreditNoteStockTransaction(
        connection,
        item,
        creditNoteId,
        data.credit_note_date,
        req.user.id,
      );
    }

    await creditNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "CREDIT_NOTE",
      reference_id: creditNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.credit_note_date,
      ledger_id: data.customer_ledger_id,
      entry_type: "Cr",
      amount: data.total_amount,
      remarks: "Customer Account",
      created_by: req.user.id,
    });

    /* SALES RETURN DR */

    await creditNoteModel.insertLedgerTransaction(connection, {
      transaction_type: "CREDIT_NOTE",
      reference_id: creditNoteId,
      voucher_no,
      voucher_type_id,
      transaction_date: data.credit_note_date,
      ledger_id: data.sales_return_ledger_id,
      entry_type: "Dr",
      amount: data.subtotal,
      remarks: "Sales Return",
      created_by: req.user.id,
    });

    /* GST LEDGERS */

    const cgstLedger = await purchaseModel.getLedgerByName(connection, "CGST");
    const sgstLedger = await purchaseModel.getLedgerByName(connection, "SGST");
    const igstLedger = await purchaseModel.getLedgerByName(connection, "IGST");

    /* IGST DR */

    if (Number(data.igst_total) > 0 && igstLedger) {
      await creditNoteModel.insertLedgerTransaction(connection, {
        transaction_type: "CREDIT_NOTE",
        reference_id: creditNoteId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.credit_note_date,
        ledger_id: igstLedger.id,
        entry_type: "Dr",
        amount: data.igst_total,
        remarks: "IGST Reversal",
        created_by: req.user.id,
      });
    }

    /* =========================== CGST DR =========================== */

    if (Number(data.cgst_total) > 0 && cgstLedger) {
      await creditNoteModel.insertLedgerTransaction(connection, {
        transaction_type: "CREDIT_NOTE",
        reference_id: creditNoteId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.credit_note_date,
        ledger_id: cgstLedger.id,
        entry_type: "Dr",
        amount: data.cgst_total,
        remarks: "CGST Reversal",
        created_by: req.user.id,
      });
    }

    /* =========================== SGST DR =========================== */

    if (Number(data.sgst_total) > 0 && sgstLedger) {
      await creditNoteModel.insertLedgerTransaction(connection, {
        transaction_type: "CREDIT_NOTE",
        reference_id: creditNoteId,
        voucher_no,
        voucher_type_id,
        transaction_date: data.credit_note_date,
        ledger_id: sgstLedger.id,
        entry_type: "Dr",
        amount: data.sgst_total,
        remarks: "SGST Reversal",
        created_by: req.user.id,
      });
    }

    /* =========================== BILL REFERENCES =========================== */

    if (Array.isArray(data.bill_references)) {
      for (const billRef of data.bill_references) {
        await creditNoteModel.insertCreditNoteBillReference(connection, {
          credit_note_id: creditNoteId,
          customer_ledger_id: data.customer_ledger_id,
          sales_bill_reference_id: billRef.sales_bill_reference_id,
          amount: billRef.amount,
        });

        await creditNoteModel.updateSalesBillReference(
          connection,
          billRef.sales_bill_reference_id,
          billRef.amount,
        );
      }
    }

    await connection.query(
      ` UPDATE voucher_types SET current_sequence = ? WHERE id = ? `,
      [nextSequence, voucher_type_id],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Credit Note created successfully",
      credit_note_id: creditNoteId,
      voucher_no,
    });
  } catch (error) {
    await connection.rollback();

    console.log("CREDIT NOTE ERROR =>", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getSalesByCustomer = async (req, res) => {
  try {
    const { customer_ledger_id } = req.query;

    if (!customer_ledger_id) {
      return res.status(400).json({
        success: false,
        message: "customer_ledger_id is required",
      });
    }

    const sales = await creditNoteModel.getSalesByCustomer(customer_ledger_id);

    return res.status(200).json({
      success: true,
      data: sales,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getSaleItemsById = async ( req, res ) => {
  try {
   const { saleId } = req.params;
   const data = await creditNoteModel.getSaleItemsById( db, saleId );

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

exports.getCreditNoteInvoice = async (req, res) => {
  try {
    const creditNoteId = req.params.id;
    const invoice = await creditNoteModel.getCreditNoteInvoice(creditNoteId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Credit Note Invoice not found"
      });
    }
    return res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getSalesReturnLedgerDropdown = async (req, res) => {
  try {
    const data = await creditNoteModel.getSalesReturnLedgerDropdown();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getOriginalSale = async (req, res) => {
  try {
    const sale = await creditNoteModel.getSaleById(req.params.saleId);
    if (!sale) {
      return res.status(404).json({ success: false, message: "Sale not found" });
    }
    return res.status(200).json({ success: true, data: sale });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSalesBillReferences = async (req, res) => {
  try {
    const { customer_ledger_id, sale_id } = req.query;
    if (!customer_ledger_id || !sale_id) {
      return res.status(400).json({
        success: false,
        message: "customer_ledger_id and sale_id are required",
      });
    }
    const data = await creditNoteModel.getSalesBillReferences(customer_ledger_id, sale_id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.sendCreditNoteWhatsApp = async (req, res) => {
  try {
    const { id: creditNoteId } = req.params;

    const invoiceData = await creditNoteModel.getCreditNoteInvoice(creditNoteId);

    if (!invoiceData || !invoiceData.creditNote) {
      return res.status(404).json({
        success: false,
        message: "Credit Note not found",
      });
    }

    const { creditNote, items } = invoiceData;

    if (!creditNote.customer_mobile) {
      return res.status(400).json({
        success: false,
        message: "Customer mobile number not available.",
      });
    }

    // Format values using helpers
    const mobile = formatMobileForWhatsapp(creditNote.customer_mobile);
    const creditNoteNo = formatDocNoForWhatsapp(creditNote.voucher_no, "JSC-CN");
    const amount = formatAmountForWhatsapp(creditNote.total_amount); // must NOT include ₹ — template already has it
    const date = formatDateForWhatsapp(creditNote.credit_note_date);

    const productNames =
  items
    ?.map((item) => {
      const qty = Number(item.return_qty || 0);
      // Strip trailing zeros: 20.0000 → 20, 12.5000 → 12.5
      const cleanQty = qty % 1 === 0 ? qty.toString() : qty.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      const unit = item.unit_name ? ` ${item.unit_name}` : "";
      return `${item.item_name} (${cleanQty}${unit})`;
    })
    .join(", ") || "-";

    // Order MUST match template placeholders exactly:
    // {{1}} name  {{2}} credit note no  {{3}} date  {{4}} products  {{5}} amount
    const components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: creditNote.customer_name || "" }, // {{1}}
          { type: "text", text: creditNoteNo },                    // {{2}}
          { type: "text", text: date },                            // {{3}}
          { type: "text", text: productNames },                    // {{4}}
          { type: "text", text: amount },                          // {{5}}
        ],
      },
    ];
    console.log("WhatsApp params being sent:", JSON.stringify(components[0].parameters, null, 2));

    const waResponse = await sendTemplateMessage(
      mobile,
      "credit_note_confirmation_1",
      "en_US",
      components
    );

    return res.status(200).json({
      success: true,
      message: "WhatsApp message sent successfully.",
      data: waResponse,
    });
  } catch (error) {
    console.error("SEND CREDIT NOTE WHATSAPP ERROR:", error?.response?.data || error);

    return res.status(500).json({
      success: false,
      message: error?.response?.data?.error?.message || "Failed to send WhatsApp message.",
    });
  }
};

// exports.sendCreditNoteWhatsApp = async (req, res) => {
//   try {
//     const { id: creditNoteId } = req.params;

//     const invoiceData = await creditNoteModel.getCreditNoteInvoice( creditNoteId );

//     if (!invoiceData || !invoiceData.creditNote) {
//       return res.status(404).json({
//         success: false,
//         message: "Credit Note not found",
//       });
//     }

//     const { creditNote } = invoiceData;

//     if (!creditNote.customer_mobile) {
//       return res.status(400).json({
//         success: false,
//         message: "Customer mobile number not available.",
//       });
//     }

//     // Format values using helpers
//     const mobile = formatMobileForWhatsapp(creditNote.customer_mobile);
//     const creditNoteNo = formatDocNoForWhatsapp(
//       creditNote.voucher_no,
//       "JSC-CN"
//     );
//     const amount = formatAmountForWhatsapp(creditNote.total_amount);
//     const date = formatDateForWhatsapp(creditNote.credit_note_date);

//     const components = [
//       {
//         type: "body",
//         parameters: [
//           {
//             type: "text",
//             text: creditNote.customer_name || "",
//           },
//           {
//             type: "text",
//             text: creditNoteNo,
//           },
//           {
//             type: "text",
//             text: amount,
//           },
//           {
//             type: "text",
//             text: date,
//           },
//         ],
//       },
//     ];

//     // Future: Add product names in template
    
//     const productNames = invoiceData.items
//       ?.map(item => `${item.item_name} x ${item.return_qty}`)
//       .join(", ");

//     components[0].parameters.push({
//       type: "text",
//       text: productNames || "-"
//     });
    

//     const waResponse = await sendTemplateMessage(
//       mobile,
//       "credit_note_confirmation",
//       "en_US",
//       components
//     );

//     return res.status(200).json({
//       success: true,
//       message: "WhatsApp message sent successfully.",
//       data: waResponse,
//     });
//   } catch (error) {
//     console.error(
//       "SEND CREDIT NOTE WHATSAPP ERROR:",
//       error?.response?.data || error
//     );

//     return res.status(500).json({
//       success: false,
//       message:
//         error?.response?.data?.error?.message ||
//         "Failed to send WhatsApp message.",
//     });
//   }
// };

// exports.getSalesBillReferences = async (req, res) => {
//   try {
//     const { sale_id } = req.query;
//     console.log("sale_id received:", sale_id);

//     if (!sale_id) {
//       return res.status(400).json({
//         success: false,
//         message: "sale_id is required",
//       });
//     }

//     const [rows] = await db.query(
//       ` SELECT
//         id, reference_no, reference_amount, pending_amount, due_date
//       FROM sales_bill_references
//       WHERE sale_id = ?
//       AND pending_amount > 0
//       ORDER BY id DESC `, [sale_id] );

//     return res.status(200).json({
//       success: true,
//       data: rows,
//     });
//   } catch (error) {
//     console.log(error);
//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };
