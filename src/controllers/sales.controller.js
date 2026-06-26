const db = require("../config/db");
const salesModel = require("../models/sales.model");
const generateVoucherNo = require("../utils/generateVoucherNo");
const purchaseModal = require("../models/purchaseTxnMaster.model");
const { uploadFileToMinio } = require("../utils/fileUpload");
const validateVoucherDate = require("../utils/validateVoucherDate");

exports.createSales = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const data = req.body;
      
        data.items = JSON.parse( data.items || "[]" );
        // data.extra_ledgers = JSON.parse( data.extra_ledgers || "[]" );
        data.extra_ledgers = JSON.parse(data.extra_ledgers || "[]")
    .filter(
        ledger =>
            ledger.ledger_id !== "" &&
            ledger.ledger_id !== null &&
            ledger.ledger_id !== undefined
    );
await validateVoucherDate(
  connection,
  "SALES",
  data.sales_date
);
        const voucherData = await generateVoucherNo("SALES");
        const { voucher_no, voucher_type_id, nextSequence } = voucherData;

        /* STOCK VALIDATION */

        for (const item of data.items) {
            const availableStock =
                await salesModel.getAvailableStock(
                    connection,
                    item.stock_item_id,
                    item.godown_id,
                    item.batch_no || null
                );

            if (  Number(availableStock) < Number(item.billed_qty) ) {
                throw new Error(
                    `Insufficient stock for Item ID ${item.stock_item_id}.
                    Available: ${availableStock},
                    Required: ${item.billed_qty}`
                );
            }
        }

        let dispatchDocImage = null;
        let billTImage = null;

        if (req.files?.dispatch_doc_image?.[0]) {
            const uploaded = await uploadFileToMinio( req.files.dispatch_doc_image[0], "txn_sales" );
            dispatchDocImage = uploaded.object_path;
        }

        if ( req.files?.bill_t_image?.[0] ) {
            const uploaded = await uploadFileToMinio( req.files.bill_t_image[0], "txn_sales" );
            billTImage = uploaded.object_path;
        }

        /* CREATE SALES MASTER */

        const saleId = await salesModel.createSales( connection,
                {
                    ...data,
                    dispatch_doc_image: dispatchDocImage,
                    bill_t_image: billTImage,
                    voucher_no,
                    created_by: req.user.id
                }
            );

        /* SALES ITEMS */

        for (const item of data.items) {
            const salesItemId = await salesModel.insertSalesItem( connection, item, saleId );

            if (item.batch_no) { await salesModel.insertSalesBatch( connection, item, salesItemId); }

            await salesModel.insertSalesStockTransaction(
                connection,
                item,
                saleId,
                data.sales_date,
                req.user.id
            );
        }

        /* CUSTOMER DR */
        if (  data.extra_ledgers?.length ) {
            for ( const ledger of data.extra_ledgers ) {
                 if (!ledger.ledger_id) {
            continue;
        }
                await salesModel.insertExtraLedger(
                    connection,
                    {
                        sale_id: saleId,
                        ledger_id: ledger.ledger_id,
                        amount: ledger.amount,
                        operation: ledger.operation,
                        comments: ledger.comments
                    }
                );

                await salesModel.insertLedgerTransaction(
                    connection,
                    {
                        transaction_type: "SALES",
                        reference_id: saleId,
                        voucher_no,
                        voucher_type_id,
                        transaction_date: data.sales_date,
                        ledger_id: ledger.ledger_id,
                        entry_type: ledger.operation === "PLUS" ? "Cr" : "Dr",
                        amount: ledger.amount,
                        remarks: ledger.comments,
                        created_by: req.user.id
                    }
                );
            }
        }

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

        /* SALES ACCOUNT CR */

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

        /* GST LEDGERS */
        const cgstLedger = await purchaseModal.getLedgerByName(connection, "CGST");
        const sgstLedger = await purchaseModal.getLedgerByName(connection, "SGST");
        const igstLedger = await purchaseModal.getLedgerByName(connection, "IGST");

        /*  IGST CR  */
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

        /* CGST CR */
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

        const customerLedger = await purchaseModal.getLedgerById( connection, data.customer_ledger_id );

        if ( customerLedger?.maintain_bill_by_bill ) {
            await salesModel.insertSalesBillReference(
                connection,
                {
                    sale_id: saleId,
                    ledger_id: data.customer_ledger_id,
                    reference_type: data.reference_type || "NEW REF",
                    reference_no: data.reference_no || voucher_no,
                    reference_amount: data.total_amount,
                    bill_amount: data.total_amount,
                    pending_amount: data.total_amount,
                    due_date: data.due_date || null
                }
            );
        }

        await connection.query(
            ` UPDATE voucher_types SET current_sequence = ? WHERE id = ? `,
            [ nextSequence, voucher_type_id ]
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



exports.getSalesLedgerList = async (req, res) => {
    try {
        const data = await salesModel.getSalesLedgerDropdown();

        res.status(200).json({
            success: true,
            data,
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        })
    }
}

exports.getSalesInvoice = async (req, res) => {
    try {
        const saleId = req.params.id;
        const invoice = await salesModel.getSalesInvoice(saleId);

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Sales invoice not found"
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