const db = require("../config/db");
const salesModel = require("../models/sales.model");
const generateVoucherNo = require("../utils/generateVoucherNo");
const purchaseModal = require("../models/purchaseTxnMaster.model")

exports.getSalesLedgerList = async (req, res)=>{
     try{
        const data = await salesModel.getSalesLedgerDropdown();

        res.status(200).json({
            success: true,
            data,
        });

     }catch(error){
        res.status(500).json({
            success: false,
            message: error.message
        })
     }
}

exports.createSales = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const data = req.body;
        const voucherData =
        await generateVoucherNo("SALES");

        const {
            voucher_no,
            voucher_type_id,
            nextSequence
        } = voucherData;

        /*
        ===========================
        STOCK VALIDATION
        ===========================
        */

        for (const item of data.items) {

            const availableStock =
                await salesModel.getAvailableStock(
                    connection,
                    item.stock_item_id,
                    item.godown_id,
                    item.batch_no || null
                );

            if (
                Number(availableStock) <
                Number(item.billed_qty)
            ) {

                throw new Error(
                    `Insufficient stock for Item ID ${item.stock_item_id}.
                    Available: ${availableStock},
                    Required: ${item.billed_qty}`
                );
            }
        }

        /*
        ===========================
        CREATE SALES MASTER
        ===========================
        */

        const saleId =
        await salesModel.createSales(
            connection,
            {
                ...data,
                voucher_no,
                created_by: req.user.id
            }
        );

        /*
        ===========================
        SALES ITEMS
        ===========================
        */

        for (const item of data.items) {

            const salesItemId =
            await salesModel.insertSalesItem(
                connection,
                item,
                saleId
            );

            if (item.batch_no) {

                await salesModel.insertSalesBatch(
                    connection,
                    item,
                    salesItemId
                );
            }

            await salesModel.insertSalesStockTransaction(
                connection,
                item,
                saleId,
                data.sales_date,
                req.user.id
            );
        }

        /*
        ===========================
        CUSTOMER DR
        ===========================
        */

        await salesModel.insertLedgerTransaction(
            connection,
            {
                transaction_type: "SALES",
                reference_id: saleId,
                voucher_no,
                voucher_type_id,
                transaction_date: data.sales_date,
                ledger_id: data.customer_ledger_id,
                entry_type: "Dr",
                amount: data.total_amount,
                remarks: "Customer Account",
                created_by: req.user.id
            }
        );

        /*
        ===========================
        SALES ACCOUNT CR
        ===========================
        */

        await salesModel.insertLedgerTransaction(
            connection,
            {
                transaction_type: "SALES",
                reference_id: saleId,
                voucher_no,
                voucher_type_id,
                transaction_date: data.sales_date,
                ledger_id: data.sales_ledger_id,
                entry_type: "Cr",
                amount: data.subtotal,
                remarks: "Sales Account",
                created_by: req.user.id
            }
        );

        /*
        ===========================
        GST LEDGERS
        ===========================
        */

        const cgstLedger =
        await purchaseModal.getLedgerByName(
            connection,
            "CGST"
        );

        const sgstLedger =
        await purchaseModal.getLedgerByName(
            connection,
            "SGST"
        );

        const igstLedger =
        await purchaseModal.getLedgerByName(
            connection,
            "IGST"
        );

        /*
        IGST CR
        */

        if (Number(data.igst_total) > 0) {

            await salesModel.insertLedgerTransaction(
                connection,
                {
                    transaction_type: "SALES",
                    reference_id: saleId,
                    voucher_no,
                    voucher_type_id,
                    transaction_date: data.sales_date,
                    ledger_id: igstLedger.id,
                    entry_type: "Cr",
                    amount: data.igst_total,
                    remarks: "IGST Output",
                    created_by: req.user.id
                }
            );
        }

        /*
        CGST CR
        */

        if (Number(data.cgst_total) > 0) {

            await salesModel.insertLedgerTransaction(
                connection,
                {
                    transaction_type: "SALES",
                    reference_id: saleId,
                    voucher_no,
                    voucher_type_id,
                    transaction_date: data.sales_date,
                    ledger_id: cgstLedger.id,
                    entry_type: "Cr",
                    amount: data.cgst_total,
                    remarks: "CGST Output",
                    created_by: req.user.id
                }
            );
        }


        if (Number(data.sgst_total) > 0) {
            await salesModel.insertLedgerTransaction(
                connection,
                {
                    transaction_type: "SALES",
                    reference_id: saleId,
                    voucher_no,
                    voucher_type_id,
                    transaction_date: data.sales_date,
                    ledger_id: sgstLedger.id,
                    entry_type: "Cr",
                    amount: data.sgst_total,
                    remarks: "SGST Output",
                    created_by: req.user.id
                }
            );
        }

        const customerLedger =
        await purchaseModal.getLedgerById(
            connection,
            data.customer_ledger_id
        );

        if (
            customerLedger?.maintain_bill_by_bill
        ) {

await salesModel.insertSalesBillReference(
  connection,
  {
    sale_id: saleId,
    ledger_id: data.customer_ledger_id,

    reference_type:
      data.reference_type || "NEW REF",

    reference_no:
      data.reference_no || voucher_no,

    reference_amount:
      data.total_amount,

    bill_amount:
      data.total_amount,

    pending_amount:
      data.total_amount,

    due_date:
      data.due_date || null
  }
);
        }

        await connection.query(
            `
            UPDATE voucher_types
            SET current_sequence = ?
            WHERE id = ?
            `,
            [
                nextSequence,
                voucher_type_id
            ]
        );

        await connection.commit();

        return res.status(201).json({
            success: true,
            message:
                "Sales created successfully",
            sales_id: saleId,
            voucher_no
        });

    } catch (error) {

        await connection.rollback();

        console.log(error);

        return res.status(500).json({
            success: false,
            message: error.message
        });

    } finally {
        connection.release();
    }
};