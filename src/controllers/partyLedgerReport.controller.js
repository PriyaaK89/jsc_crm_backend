const reportModel = require("../models/partyLedgerReport.model");


// ==========================================
// GET PARTY LEDGER REPORT
// ==========================================

exports.getPartyLedgerReport = async (req, res) => {

  try {

    let {
      ledger_id,
      from_date,
      to_date,
      search = "",
      page = 1,
      limit = 200,
    } = req.query;

    // ==========================================
    // VALIDATION
    // ==========================================

    if (!ledger_id) {

      return res.status(400).json({
        success: false,
        message: "ledger_id is required",
      });
    }

    if (!from_date || !to_date) {

      return res.status(400).json({
        success: false,
        message: "from_date and to_date are required",
      });
    }

    page = Number(page);
    limit = Number(limit);

    // ==========================================
    // GET LEDGER DETAILS
    // ==========================================

    const ledgerDetails =
      await reportModel.getLedgerDetails(
        ledger_id
      );

    // ==========================================
    // GET OPENING BALANCE
    // ==========================================

    const openingBalance =
      await reportModel.getOpeningBalance(
        ledger_id,
        from_date
      );

    let runningBalance =
      openingBalance;

    // ==========================================
    // GET REPORT DATA
    // ==========================================

    const result =
      await reportModel.getPartyLedgerReport({

        ledger_id,
        from_date,
        to_date,
        search,
        page,
        limit,
      });

    const rows = result.rows;

    const formattedRows = [];

    let totalDebit = 0;
    let totalCredit = 0;

    // ==========================================
    // PROCESS REPORT ROWS
    // ==========================================

    for (const row of rows) {

      const amount =
        Number(row.amount);

      let debit = 0;
      let credit = 0;

      // ==========================================
      // SUPPLIER ACCOUNT LOGIC
      // CR => INCREASE
      // DR => DECREASE
      // ==========================================

      if (row.entry_type === "Dr") {

        debit = amount;

        totalDebit += amount;

        runningBalance -= amount;

      } else {

        credit = amount;

        totalCredit += amount;

        runningBalance += amount;
      }

      formattedRows.push({

        id: row.id,

        transaction_date:
          row.transaction_date,

        particulars:
          row.remarks,

        transaction_type:
          row.transaction_type,

        voucher_no:
          row.voucher_no,

        reference_id:
          row.reference_id,

        purchase_ledger_id:
          row.purchase_ledger_id || null,

        purchase_ledger_name:
          row.purchase_ledger_name || null,

        debit,

        credit,

        balance:
          Math.abs(runningBalance),

        balance_type:
          runningBalance >= 0
            ? "Cr"
            : "Dr",
      });
    }

    // ==========================================
    // APPLY PAGINATION
    // ==========================================

    const startIndex =
      (page - 1) * limit;

    const paginatedRows =
      formattedRows.slice(
        startIndex,
        startIndex + limit
      );

    // ==========================================
    // CLOSING BALANCE
    // ==========================================

    const closingBalance =
      runningBalance;

    // ==========================================
    // FINAL RESPONSE
    // ==========================================

    res.status(200).json({

      success: true,

      // ======================================
      // LEDGER DETAILS
      // ======================================

      ledger: ledgerDetails,

      // ======================================
      // OPENING BALANCE
      // ======================================

      opening_balance: {

        amount:
          Math.abs(openingBalance),

        type:
          openingBalance >= 0
            ? "Cr"
            : "Dr",
      },

      // ======================================
      // TOTALS
      // ======================================

      totals: {

        total_debit:
          totalDebit,

        total_credit:
          totalCredit,

        over_due_interest:
          0,

        closing_balance:
          Math.abs(closingBalance),

        closing_type:
          closingBalance >= 0
            ? "Cr"
            : "Dr",
      },

      // ======================================
      // PAGINATION
      // ======================================

      pagination: {

        current_page:
          page,

        per_page:
          limit,

        total_records:
          result.totalRecords,

        total_pages:
          Math.ceil(
            result.totalRecords / limit
          ),
      },

      // ======================================
      // TABLE DATA
      // ======================================

      data:
        paginatedRows,
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({

      success: false,

      message:
        error.message,
    });
  }
};