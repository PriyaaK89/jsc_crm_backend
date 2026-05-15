const db = require("../config/db");

const createLedger = async (ledgerData) => {

  const {
    ledger_name,
    group_id,
    employee_under,

    opening_balance,
    balance_type,
    opening_date,

    mailing_name,
    location,
    country,
    state,
    pincode,

    pan_no,
    gst_no,

    maintain_bill_by_bill,
    default_credit_period,
    check_credit_days,
    credit_limit,

    inventory_values_affected,
    use_for_payroll,

    activate_interest_calculation,

    od_limit,

    created_by,
  } = ledgerData;

  const [result] = await db.query(
    `
    INSERT INTO ledgers (
      ledger_name,
      group_id,
      employee_under,

      opening_balance,
      balance_type,
      opening_date,

      mailing_name,
      location,
      country,
      state,
      pincode,

      pan_no,
      gst_no,

      maintain_bill_by_bill,
      default_credit_period,
      check_credit_days,
      credit_limit,

      inventory_values_affected,
      use_for_payroll,

      activate_interest_calculation,

      od_limit,

      created_by
    )
    VALUES (
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?,
      ?,
      ?
    )
    `,
    [
      ledger_name,
      group_id,
      employee_under || null,

      opening_balance || 0,
      balance_type || "Dr",
      opening_date || null,

      mailing_name || null,
      location || null,
      country || null,
      state || null,
      pincode || null,

      pan_no || null,
      gst_no || null,

      maintain_bill_by_bill || 0,
      default_credit_period || 0,
      check_credit_days || 0,
      credit_limit || 0,

      inventory_values_affected || 0,
      use_for_payroll || 0,

      activate_interest_calculation || 0,

      od_limit || 0,

      created_by || null,
    ]
  );

  return result.insertId;
};

const createLedgerBankDetails = async (
  ledger_id,
  bankData
) => {

  const {
    account_holder_name,
    account_number,
    ifsc_code,
    bank_name,
    branch_name,
    cheque_book_enabled,
    cheque_printing_enabled,
  } = bankData;

  await db.query(
    `
    INSERT INTO ledger_bank_details (
      ledger_id,
      account_holder_name,
      account_number,
      ifsc_code,
      bank_name,
      branch_name,
      cheque_book_enabled,
      cheque_printing_enabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      ledger_id,
      account_holder_name || null,
      account_number || null,
      ifsc_code || null,
      bank_name || null,
      branch_name || null,
      cheque_book_enabled || 0,
      cheque_printing_enabled || 0,
    ]
  );
};

const createLedgerInterestConfig = async (
  ledger_id,
  interestData
) => {

  const {
    calculate_transaction_by_transaction,
    interest_based_on,

    amount_added,
    amount_deducted,

    rate,
    rate_per,
    rate_on,

    applicability,
    applicability_days,
    grace_period,

    security_enabled,
    security_amount,
  } = interestData;

  await db.query(
    `
    INSERT INTO ledger_interest_config (
      ledger_id,

      calculate_transaction_by_transaction,
      interest_based_on,

      amount_added,
      amount_deducted,

      rate,
      rate_per,
      rate_on,

      applicability,
      applicability_days,
      grace_period,

      security_enabled,
      security_amount
    )
    VALUES (
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
    `,
    [
      ledger_id,

      calculate_transaction_by_transaction || 0,
      interest_based_on || null,

      amount_added || 0,
      amount_deducted || 0,

      rate || 0,
      rate_per || null,
      rate_on || null,

      applicability || null,
      applicability_days || 0,
      grace_period || 0,

      security_enabled || 0,
      security_amount || 0,
    ]
  );
};

const findLedgerByName = async (ledger_name) => {

  const [rows] = await db.query(
    `
    SELECT * FROM ledgers
    WHERE ledger_name = ?
    `,
    [ledger_name]
  );

  return rows[0];
};

module.exports = {
  createLedger,
  createLedgerBankDetails,
  createLedgerInterestConfig,
  findLedgerByName,
};