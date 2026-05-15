const {
  createLedger,
  createLedgerBankDetails,
  createLedgerInterestConfig,
  findLedgerByName,
} = require("../models/ledger.model");

const {
  getGroupById,
} = require("../models/accountGroup.model");

const isValidBoolean = (value) => {
  return value === 0 || value === 1;
};

const createLedgerController = async (req, res) => {

  try {

    const {

      // BASIC DETAILS
      ledger_name,
      group_id,
      employee_under,

      // OPENING DETAILS
      opening_balance,
      balance_type,
      opening_date,

      // MAILING DETAILS
      mailing_name,
      location,
      country,
      state,
      pincode,

      // TAX DETAILS
      pan_no,
      gst_no,

      // CREDIT DETAILS
      maintain_bill_by_bill,
      default_credit_period,
      check_credit_days,
      credit_limit,

      // OTHER FEATURES
      inventory_values_affected,
      use_for_payroll,
      activate_interest_calculation,
      od_limit,

      // NESTED OBJECTS
      bank_details,
      interest_config,

    } = req.body;

    // ===============================
    // REQUIRED VALIDATIONS
    // ===============================

    if (!ledger_name || !ledger_name.trim()) {

      return res.status(400).json({
        success: false,
        message: "Ledger name is required",
      });
    }

    if (!group_id) {

      return res.status(400).json({
        success: false,
        message: "Group is required",
      });
    }

    // ===============================
    // GROUP VALIDATION
    // ===============================

    const group = await getGroupById(group_id);

    if (!group) {

      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    // ===============================
    // DUPLICATE CHECK
    // ===============================

    const existingLedger = await findLedgerByName(
      ledger_name.trim()
    );

    if (existingLedger) {

      return res.status(400).json({
        success: false,
        message: "Ledger already exists",
      });
    }

    // ===============================
    // BOOLEAN VALIDATION
    // ===============================

    const booleanFields = [

      maintain_bill_by_bill,
      check_credit_days,
      inventory_values_affected,
      use_for_payroll,
      activate_interest_calculation,

      bank_details?.cheque_book_enabled,
      bank_details?.cheque_printing_enabled,

      interest_config?.calculate_transaction_by_transaction,
      interest_config?.amount_added,
      interest_config?.amount_deducted,
      interest_config?.security_enabled,
    ];

    for (const value of booleanFields) {

      if (
        value !== undefined &&
        value !== null &&
        !isValidBoolean(value)
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Boolean fields must contain only 0 or 1",
        });
      }
    }

    // ===============================
    // BALANCE TYPE VALIDATION
    // ===============================

    if (
      balance_type &&
      !["Cr", "Dr"].includes(balance_type)
    ) {

      return res.status(400).json({
        success: false,
        message:
          "Balance type must be either Cr or Dr",
      });
    }

    // ===============================
    // INTEREST ENUM VALIDATIONS
    // ===============================

    if (interest_config) {

      if (
        interest_config.interest_based_on &&
        ![
          "Bank/Reco date",
          "Voucher date",
        ].includes(
          interest_config.interest_based_on
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid interest_based_on value",
        });
      }

      if (
        interest_config.rate_per &&
        ![
          "Calendar Month",
          "Calendar Year",
        ].includes(
          interest_config.rate_per
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid rate_per value",
        });
      }

      if (
        interest_config.rate_on &&
        ![
          "Credit Balances Only",
          "Debit Balances Only",
        ].includes(
          interest_config.rate_on
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid rate_on value",
        });
      }

      if (
        interest_config.applicability &&
        ![
          "Always",
          "Past Due Date",
        ].includes(
          interest_config.applicability
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid applicability value",
        });
      }
    }

    // ===============================
    // CREATE LEDGER
    // ===============================

    const ledgerId = await createLedger({

      ledger_name: ledger_name.trim(),

      group_id,

      employee_under:
        employee_under || null,

      opening_balance:
        opening_balance || 0,

      balance_type:
        balance_type || "Dr",

      opening_date:
        opening_date || null,

      // MAILING
      mailing_name:
        mailing_name || null,

      location:
        location || null,

      country:
        country || null,

      state:
        state || null,

      pincode:
        pincode || null,

      // TAX
      pan_no:
        pan_no || null,

      gst_no:
        gst_no || null,

      // CREDIT
      maintain_bill_by_bill:
        maintain_bill_by_bill ?? 0,

      default_credit_period:
        default_credit_period || 0,

      check_credit_days:
        check_credit_days ?? 0,

      credit_limit:
        credit_limit || 0,

      // FEATURES
      inventory_values_affected:
        inventory_values_affected ?? 0,

      use_for_payroll:
        use_for_payroll ?? 0,

      activate_interest_calculation:
        activate_interest_calculation ?? 0,

      od_limit:
        od_limit || 0,

      created_by:
        req.user?.id || null,
    });

    // ===============================
    // CREATE BANK DETAILS
    // ===============================

    if (bank_details) {

      await createLedgerBankDetails(
        ledgerId,
        {

          account_holder_name:
            bank_details.account_holder_name || null,

          account_number:
            bank_details.account_number || null,

          ifsc_code:
            bank_details.ifsc_code || null,

          bank_name:
            bank_details.bank_name || null,

          branch_name:
            bank_details.branch_name || null,

          cheque_book_enabled:
            bank_details.cheque_book_enabled ?? 0,

          cheque_printing_enabled:
            bank_details.cheque_printing_enabled ?? 0,
        }
      );
    }

    // ===============================
    // CREATE INTEREST CONFIG
    // ===============================

    if (
      activate_interest_calculation === 1 &&
      interest_config
    ) {

      await createLedgerInterestConfig(
        ledgerId,
        {

          calculate_transaction_by_transaction:
            interest_config.calculate_transaction_by_transaction ?? 0,

          interest_based_on:
            interest_config.interest_based_on || null,

          amount_added:
            interest_config.amount_added ?? 0,

          amount_deducted:
            interest_config.amount_deducted ?? 0,

          rate:
            interest_config.rate || 0,

          rate_per:
            interest_config.rate_per || null,

          rate_on:
            interest_config.rate_on || null,

          applicability:
            interest_config.applicability || null,

          applicability_days:
            interest_config.applicability_days || 0,

          grace_period:
            interest_config.grace_period || 0,

          security_enabled:
            interest_config.security_enabled ?? 0,

          security_amount:
            interest_config.security_amount || 0,
        }
      );
    }

    // ===============================
    // SUCCESS RESPONSE
    // ===============================

    return res.status(201).json({
      success: true,
      message: "Ledger created successfully",
      ledger_id: ledgerId,
    });

  } catch (error) {

    console.log(
      "CREATE LEDGER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  createLedgerController,
};