/**
 * ADD these functions to your existing `models/partyLedgerReport.model.js`
 * (it already has `getLedgerDetails`, reuse that — don't duplicate it).
 *
 * These power the new GET /party-ledger/summary endpoint used by the
 * mobile "Party Ledger" card + Aging Analysis section.
 */

const db = require("../../config/db");
const partyLedgerReportModel = require("../../models/partyLedgerReport.model")

// ==========================================
// TOTAL TRANSACTION COUNT (not date-filtered)
// Used for the "Transactions" stat tile on the mobile summary card.
// Your existing report's `totalRecords` is scoped to a from/to date
// range, which is NOT what the summary card wants.
// ==========================================
exports.getLedgerTransactionsCount = async (ledgerId) => {
    const [rows] = await db.query(
        `
        SELECT COUNT(*) AS total
        FROM ledger_transactions
        WHERE ledger_id = ?
        AND is_cancelled = 0
        `,
        [ledgerId]
    );

    return rows[0].total;
};

// ==========================================
// AGING ANALYSIS (FIFO)
// Walks every non-cancelled transaction in date order, matches each
// credit (Cr) against the oldest still-open debit (Dr) entries first,
// then buckets whatever debit amount remains unmatched by its age.
//
// NOTE: this assumes Dr = amount owed increases (invoice), Cr = amount
// owed decreases (payment) — the *conventional* reading. Your existing
// controller comment describes the opposite ("Dr => reduce balance").
// If your data actually follows that inverted convention, swap the
// `if (row.entry_type === "Dr")` branch below with the Cr branch.
//
// If you track bill-wise allocations (you mentioned `maintain_bill_by_bill`
// elsewhere), aging should ideally use that instead of this FIFO
// approximation — let me know and I'll rewrite it against that table.
// ==========================================
exports.getAgingAnalysis = async (ledgerId, asOfDate = new Date()) => {
    const [txnRows] = await db.query(
        `
        SELECT entry_type, amount, transaction_date
        FROM ledger_transactions
        WHERE ledger_id = ?
        AND is_cancelled = 0
        AND transaction_date <= ?
        ORDER BY transaction_date ASC, id ASC
        `,
        [ledgerId, asOfDate]
    );

    // FIFO queue of still-unpaid debit (Dr) entries
    const openDebits = [];

    for (const row of txnRows) {
        const amount = Number(row.amount);

        if (row.entry_type === "Dr") {
            openDebits.push({
                amount,
                date: row.transaction_date,
            });
        } else {
            // Credit knocks off the oldest open debits first
            let remainingCredit = amount;

            while (remainingCredit > 0 && openDebits.length > 0) {
                const oldest = openDebits[0];

                if (oldest.amount <= remainingCredit) {
                    remainingCredit -= oldest.amount;
                    openDebits.shift();
                } else {
                    oldest.amount -= remainingCredit;
                    remainingCredit = 0;
                }
            }
        }
    }

    const buckets = {
        "0-30": 0,
        "31-60": 0,
        "61+": 0,
    };

    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const today = new Date(asOfDate);

    for (const debit of openDebits) {
        const ageDays = Math.floor(
            (today - new Date(debit.date)) / MS_PER_DAY
        );

        if (ageDays <= 30) {
            buckets["0-30"] += debit.amount;
        } else if (ageDays <= 60) {
            buckets["31-60"] += debit.amount;
        } else {
            buckets["61+"] += debit.amount;
        }
    }

    const totalOutstanding =
        buckets["0-30"] + buckets["31-60"] + buckets["61+"];

    return { buckets, totalOutstanding };
};

// ==========================================
// COMBINED SUMMARY for the mobile party card
// Uses exports.getLedgerDetails from your existing report model —
// make sure this file is merged into that same module (or require it).
// ==========================================
exports.getPartyLedgerSummary = async (ledgerId) => {
    const ledger = await partyLedgerReportModel.getLedgerDetails(ledgerId);

    if (!ledger) return null;

    const [agingResult, transactionsCount] = await Promise.all([
        exports.getAgingAnalysis(ledgerId),
        exports.getLedgerTransactionsCount(ledgerId),
    ]);

    return {
        ledger_id: ledger.id,
        ledger_name: ledger.ledger_name,
        total_outstanding: agingResult.totalOutstanding,
        credit_limit: Number(ledger.credit_limit || 0),
        transactions_count: transactionsCount,
        gst_verified: !!ledger.gst_verified,

        // TODO: there's no dispatch/order-status table in this model.
        // "Dispatch: Clear" needs a real query once you tell me which
        // table tracks pending dispatches for a party — e.g. something
        // like `sales_orders WHERE ledger_id = ? AND dispatch_status != 'Cleared'`.
        // Hardcoded for now so the mobile UI has something to render.
        dispatch_status: "Clear",

        aging: {
            "0_30_days": agingResult.buckets["0-30"],
            "31_60_days": agingResult.buckets["31-60"],
            "61_plus_days": agingResult.buckets["61+"],
        },
    };
};