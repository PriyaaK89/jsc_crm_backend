const db = require("../config/db");
const journalModel = require("../models/journal.modal");
const generateVoucherNo = require("../utils/generateVoucherNo");
const validateVoucherDate = require("../utils/validateVoucherDate");

exports.getJournalLedgerDropdown = async (req, res) => {
    try {
        const data = await journalModel.getJournalLedgerDropdown();

        return res.status(200).json({
            success: true,
            data,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

exports.getBillReferences = async (req, res) => {
    try {
        const { ledgerId } = req.params;

        const data = await journalModel.getBillReferences(ledgerId);

        return res.status(200).json({
            success: true,
            data,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

exports.createJournal = async (req, res) => {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();
       
        const data = req.body;

        console.log(data);
        console.log(data.entries);

        if (!data.entries || data.entries.length < 2) {
            throw new Error("Minimum two journal entries required");
        }

        const duplicateLedger = data.entries.some(
            (row, index) =>
                data.entries.findIndex(
                    x =>
                        Number(x.ledger_id) === Number(row.ledger_id) &&
                        x.entry_type === row.entry_type
                ) !== index
        );

        if (duplicateLedger) {
            throw new Error(
                "Duplicate ledger entry found on same Dr/Cr side"
            );
        }

        const totalDebit = data.entries
            .filter((x) => x.entry_type === "Dr")
            .reduce((sum, row) => sum + Number(row.amount), 0);

        const totalCredit = data.entries
            .filter((x) => x.entry_type === "Cr")
            .reduce((sum, row) => sum + Number(row.amount), 0);

        if (Number(totalDebit) !== Number(totalCredit)) {
            throw new Error("Total Debit and Total Credit must be equal");
        }

        await validateVoucherDate(
  connection,
  "JOURNAL",
  data.journal_date
);

        const voucherData = await generateVoucherNo("JOURNAL");

        const { voucher_no, voucher_type_id, nextSequence } = voucherData;

        const journalId = await journalModel.createJournal(connection, {
            voucher_type_id,
            voucher_no,
            journal_date: data.journal_date,
            employee_under_id: data.employee_under_id,
            total_debit: totalDebit,
            total_credit: totalCredit,
            narration: data.narration,
            created_by: req.user.id,
        });

        for (const entry of data.entries) {
            const journalEntryId = await journalModel.insertJournalEntry(
                connection,
                journalId,
                entry
            );

            if (entry.bill_references && entry.bill_references.length > 0) {
                for (const bill of entry.bill_references) {
                    await journalModel.insertJournalBillReference(
                        connection,
                        journalEntryId,
                        entry.ledger_id,
                        bill
                    );

                    if (
                        bill.reference_type === "AGAINST REF" ||
                        bill.reference_type === "AGST REF"
                    ) {
                        if (bill.source === "PURCHASE") {
                            await journalModel.updatePurchaseBillPendingAmount(
                                connection,
                                bill.reference_no,
                                bill.amount
                            );
                        } else if (bill.source === "SALES") {
                            await journalModel.updateSalesBillPendingAmount(
                                connection,
                                bill.reference_no,
                                bill.amount
                            );
                        }
                    }
                }
            }

            await journalModel.insertLedgerTransaction(connection, {
                transaction_type: "JOURNAL",
                reference_id: journalId,
                voucher_no,
                voucher_type_id,
                transaction_date: data.journal_date,
                ledger_id: entry.ledger_id,
                entry_type: entry.entry_type,
                amount: Number(entry.amount),
                remarks: entry.remarks || data.narration,
                created_by: req.user.id,
            });
        }

        await connection.query(
            `
            UPDATE voucher_types
            SET current_sequence = ?
            WHERE id = ?
            `,
            [nextSequence, voucher_type_id]
        );

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: "Journal voucher created successfully",

            journal_id: journalId,
            voucher_no,
        });
    } catch (error) {
        await connection.rollback();

        console.log("JOURNAL ERROR:", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    } finally {
        connection.release();
    }
};

exports.getJournalVoucher = async (req, res) => {
    try {
        const { id } = req.params;

        const data = await journalModel.getJournalVoucher(id);

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Journal voucher not found",
            });
        }

        return res.status(200).json({
            success: true,
            data,
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

exports.getJournalInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await journalModel.getJournalInvoice(id);
        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Journal voucher not found"
            });
        }
        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error(
            "Get Journal Invoice Error:",
            error
        );
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};