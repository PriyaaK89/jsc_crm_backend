const db = require("../config/db");

const createLedger = async (ledgerData) => {
  const {
    ledger_name, group_id, employee_under,
    opening_balance, balance_type, opening_date,
    mailing_name, location, country, state, pincode, pan_no, gst_no,
    maintain_bill_by_bill,
    default_credit_period,
    check_credit_days,
    credit_limit,
    inventory_values_affected, use_for_payroll,
    activate_interest_calculation,
    od_limit, created_by,
  } = ledgerData;

  const [result] = await db.query(
    ` INSERT INTO ledgers (
      ledger_name, group_id, employee_under,
      opening_balance, balance_type, opening_date,
      mailing_name, location, country, state, pincode,
      pan_no, gst_no,
      maintain_bill_by_bill, default_credit_period, check_credit_days, credit_limit,
      inventory_values_affected, use_for_payroll,
      activate_interest_calculation,
      od_limit,
      created_by
    )
    VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ) `,
    [
      ledger_name, group_id, employee_under || null,
      opening_balance || 0, balance_type || "Dr", opening_date || null,
      mailing_name || null, location || null, country || null, state || null, pincode || null,
      pan_no || null, gst_no || null,
      maintain_bill_by_bill || 0, default_credit_period || 0, check_credit_days || 0, credit_limit || 0,
      inventory_values_affected || 0, use_for_payroll || 0,
      activate_interest_calculation || 0,
      od_limit || 0, created_by || null,
    ]
  );

  return result.insertId;
};

const createLedgerBankDetails = async ( ledger_id, bankData ) => {

  const {
    account_holder_name, account_number, ifsc_code,
    bank_name, branch_name, cheque_book_enabled, cheque_printing_enabled, } = bankData;

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

const createLedgerInterestConfigs = async ( ledger_id, interestConfigs ) => {

  if (!Array.isArray(interestConfigs) || interestConfigs.length === 0) {
    return;
  }

  for (const interestData of interestConfigs) {

    const {
      slab_no,
      slab_type,
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
        slab_no,
        slab_type,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ledger_id,
        slab_no ?? 1,
        slab_type ?? null,
        calculate_transaction_by_transaction ?? 0,
        interest_based_on ?? null,
        amount_added ?? 0,
        amount_deducted ?? 0,
        rate ?? 0,
        rate_per ?? null,
        rate_on ?? null,
        applicability ?? null,
        applicability_days ?? 0,
        grace_period ?? 0,
        security_enabled ?? 0,
        security_amount ?? 0,
      ]
    );
  }
};

const createLedgerOtherDetails = async (ledger_id, crmData) => {
  const {
    customer_name, customer_dob,
    firm_name, firm_type, firm_email, firm_since,
    firm_pan, firm_aadhar, firm_gstn_type,
    firm_annual_turnover, expected_sale_per_year, other_company_detail,
    address, state, district, tehsil, pincode, landmark, branch,
    contact,
    responsible_person_name, responsible_person_address, responsible_person_contact,
    seed_licence_no, fert_licence_no, pest_licence_no,
    transport_name,
    bank_name, bank_acc_number, bank_ifsc, bank_branch,
    security_cheque_no1, security_cheque_no2,
  } = crmData;

  await db.query(
    `INSERT INTO ledger_other_details (
      ledger_id,
      customer_name, customer_dob,
      firm_name, firm_type, firm_email, firm_since,
      firm_pan, firm_aadhar, firm_gstn_type,
      firm_annual_turnover, expected_sale_per_year, other_company_detail,
      address, state, district, tehsil, pincode, landmark, branch,
      contact,
      responsible_person_name, responsible_person_address, responsible_person_contact,
      seed_licence_no, fert_licence_no, pest_licence_no,
      transport_name,
      bank_name, bank_acc_number, bank_ifsc, bank_branch,
      security_cheque_no1, security_cheque_no2
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )`,
    [
      ledger_id,
      customer_name || null,
      customer_dob || null,
      firm_name || null,
      firm_type || null,
      firm_email || null,
      firm_since || null,
      firm_pan || null,
      firm_aadhar || null,
      firm_gstn_type || null,
      firm_annual_turnover || null,
      expected_sale_per_year || null,
      other_company_detail || null,
      address || null,
      state || null,
      district || null,
      tehsil || null,
      pincode || null,
      landmark || null,
      branch || null,
      contact || null,
      responsible_person_name || null,
      responsible_person_address || null,
      responsible_person_contact || null,
      seed_licence_no || null,
      fert_licence_no || null,
      pest_licence_no || null,
      transport_name || null,
      bank_name || null,
      bank_acc_number || null,
      bank_ifsc || null,
      bank_branch || null,
      security_cheque_no1 || null,
      security_cheque_no2 || null,
    ]
  );
};

const findLedgerByName = async (ledger_name) => {
  const [rows] = await db.query( ` SELECT * FROM ledgers WHERE ledger_name = ? `, [ledger_name] );
  return rows[0];
};

const getLedgersModel = async (filters, limit, offset) => {
  const { search, group_id, state, activate_interest_calculation, } = filters;

  let whereConditions = [];
  let queryParams = [];

  if (search && search.trim() !== "") {
    whereConditions.push(` (
        l.ledger_name LIKE ?
        OR l.mailing_name LIKE ?
        OR l.location LIKE ?
        OR l.gst_no LIKE ?
        OR l.pan_no LIKE ?
        OR lod.customer_name LIKE ?
        OR lod.firm_name LIKE ?
        OR lod.contact LIKE ?
      ) `);

    const searchValue = `%${search.trim()}%`;

    queryParams.push(
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue
    );
  }

  if (group_id) {
    whereConditions.push(`l.group_id = ?`);
    queryParams.push(group_id);
  }

  if (state) {
    whereConditions.push(`l.state = ?`);
    queryParams.push(state);
  }

  if (
    activate_interest_calculation !== undefined &&
    activate_interest_calculation !== ""
  ) {
    whereConditions.push(`l.activate_interest_calculation = ?`);
    queryParams.push(Number(activate_interest_calculation));
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const [rows] = await db.query(
    ` SELECT

      -- ==========================
      -- LEDGER DETAILS
      -- ==========================

      l.id,
      l.ledger_name,
      l.group_id,
      ag.group_name,

      l.employee_under,

      l.opening_balance,
      l.balance_type,
      l.opening_date,

      l.mailing_name,
      l.location,
      l.country,
      l.state,
      l.pincode,

      l.pan_no,
      l.gst_no,

      l.maintain_bill_by_bill,
      l.default_credit_period,
      l.check_credit_days,
      l.credit_limit,

      l.inventory_values_affected,
      l.use_for_payroll,
      l.activate_interest_calculation,
      l.od_limit,

      l.created_by,
      l.created_at,
      l.updated_at,

      -- ==========================
      -- BANK DETAILS
      -- ==========================

      lbd.id AS bank_detail_id,
      lbd.account_holder_name,
      lbd.account_number,
      lbd.ifsc_code,
      lbd.bank_name,
      lbd.branch_name,
      lbd.cheque_book_enabled,
      lbd.cheque_printing_enabled,

      -- ==========================
      -- CRM DETAILS
      -- ==========================

      lod.id AS crm_detail_id,
      lod.customer_name,
      lod.customer_dob,
      lod.contact,

      lod.firm_name,
      lod.firm_type,
      lod.firm_email,
      lod.firm_since,
      lod.firm_pan,
      lod.firm_aadhar,
      lod.firm_gstn_type,
      lod.firm_annual_turnover,
      lod.expected_sale_per_year,
      lod.other_company_detail,

      lod.address,
      lod.state AS crm_state,
      lod.district,
      lod.tehsil,
      lod.pincode AS crm_pincode,
      lod.landmark,
      lod.branch,

      lod.contact,

      lod.responsible_person_name,
      lod.responsible_person_address,
      lod.responsible_person_contact,

      lod.seed_licence_no,
      lod.fert_licence_no,
      lod.pest_licence_no,

      lod.transport_name,

      lod.bank_name AS crm_bank_name,
      lod.bank_acc_number,
      lod.bank_ifsc,
      lod.bank_branch,

      lod.security_cheque_no1,
      lod.security_cheque_no2,

      -- ==========================
      -- INTEREST CONFIGS
      -- ==========================

      (
        SELECT COALESCE(
          JSON_ARRAYAGG(
            JSON_OBJECT(
              'interest_config_id', lic.id,
              'slab_no', lic.slab_no,
              'slab_type', lic.slab_type,
              'calculate_transaction_by_transaction', lic.calculate_transaction_by_transaction,
              'interest_based_on', lic.interest_based_on,
              'amount_added', lic.amount_added,
              'amount_deducted', lic.amount_deducted,
              'rate', lic.rate,
              'rate_per', lic.rate_per,
              'rate_on', lic.rate_on,
              'applicability', lic.applicability,
              'applicability_days', lic.applicability_days,
              'grace_period', lic.grace_period,
              'security_enabled', lic.security_enabled,
              'security_amount', lic.security_amount
            )
          ),
          JSON_ARRAY()
        )
        FROM ledger_interest_config lic WHERE lic.ledger_id = l.id
      ) AS interest_configs

    FROM ledgers l

    LEFT JOIN account_groups ag ON ag.id = l.group_id
    LEFT JOIN ledger_bank_details lbd ON lbd.ledger_id = l.id
    LEFT JOIN ledger_other_details lod ON lod.ledger_id = l.id

    ${whereClause}

    ORDER BY l.id DESC

    LIMIT ? OFFSET ? `,
    [...queryParams, limit, offset]
  );

  return rows;
};
const getLedgerCountModel = async (filters) => {

  const { search, group_id, state, activate_interest_calculation, } = filters;

  let whereConditions = [];
  let queryParams = [];

  if (search && search.trim() !== "") {
    whereConditions.push(` ( l.ledger_name LIKE ? OR lod.customer_name LIKE ? OR lod.firm_name LIKE ? ) `);
    const searchValue = `%${search.trim()}%`;
    queryParams.push(searchValue, searchValue, searchValue);
  }

  if (group_id) {
    whereConditions.push(`l.group_id = ?`);
    queryParams.push(group_id);
  }

  if (state) {
    whereConditions.push(`l.state = ?`);
    queryParams.push(state);
  }

  if (
    activate_interest_calculation !== undefined && activate_interest_calculation !== ""
  ) {
    whereConditions.push(`l.activate_interest_calculation = ?`);
    queryParams.push(Number(activate_interest_calculation));
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const [rows] = await db.query( ` SELECT COUNT(DISTINCT l.id) AS total FROM ledgers l
    LEFT JOIN ledger_other_details lod ON lod.ledger_id = l.id ${whereClause} `, queryParams
  );

  return rows[0].total;
};


// ===============================
// GET LEDGER BY ID
// ===============================

const getLedgerByIdModel = async (connection,id) => {

  const [ledgerRows] = await connection.query(
    `
    SELECT

      -- LEDGER
      l.id,
      l.ledger_name,
      l.group_id,
      ag.group_name,
      l.employee_under,
      u.name AS employee_under_name,
      l.opening_balance,
      l.balance_type,
      l.opening_date,
      l.mailing_name,
      l.location,
      l.country,
      l.state,
      l.pincode,
      l.pan_no,
      l.gst_no,
      l.maintain_bill_by_bill,
      l.default_credit_period,
      l.check_credit_days,
      l.credit_limit,
      l.inventory_values_affected,
      l.use_for_payroll,
      l.activate_interest_calculation,
      l.od_limit,
      l.created_by,
      l.created_at,
      l.updated_at,

      -- BANK DETAILS
      lbd.id AS bank_detail_id,
      lbd.account_holder_name,
      lbd.account_number,
      lbd.ifsc_code,
      lbd.bank_name,
      lbd.branch_name,
      lbd.cheque_book_enabled,
      lbd.cheque_printing_enabled,

      -- OTHER DETAILS
      lod.id AS other_detail_id,
      lod.customer_name,
      lod.customer_dob,
      lod.firm_name,
      lod.firm_type,
      lod.firm_email,
      lod.firm_since,
      lod.firm_pan,
      lod.firm_aadhar,
      lod.firm_gstn_type,
      lod.firm_annual_turnover,
      lod.expected_sale_per_year,
      lod.other_company_detail,
      lod.address,
      lod.state AS crm_state,
      lod.district,
      lod.tehsil,
      lod.pincode AS crm_pincode,
      lod.landmark,
      lod.branch,
      lod.contact,
      lod.responsible_person_name,
      lod.responsible_person_address,
      lod.responsible_person_contact,
      lod.seed_licence_no,
      lod.fert_licence_no,
      lod.pest_licence_no,
      lod.transport_name,
      lod.bank_name AS crm_bank_name,
      lod.bank_acc_number,
      lod.bank_ifsc,
      lod.bank_branch,
      lod.security_cheque_no1,
      lod.security_cheque_no2

    FROM ledgers l

    LEFT JOIN account_groups ag
    ON ag.id = l.group_id

    LEFT JOIN users u
    ON u.id = l.employee_under

    LEFT JOIN ledger_bank_details lbd
    ON lbd.ledger_id = l.id

    LEFT JOIN ledger_other_details lod
    ON lod.ledger_id = l.id

    WHERE l.id = ?
    `,
    [id]
  );

  if (ledgerRows.length === 0) {
    return null;
  }

  const [interestConfigs] = await connection.query(
    ` SELECT

      id AS interest_config_id, slab_no, slab_type,
      calculate_transaction_by_transaction, interest_based_on,
      amount_added, amount_deducted,
      rate, rate_per, rate_on,
      applicability, applicability_days, grace_period,
      security_enabled, security_amount

    FROM ledger_interest_config
    WHERE ledger_id = ?
    ORDER BY slab_no ASC `,
    [id]
  );

  return {
    ...ledgerRows[0],
    interest_configs: interestConfigs,
  };
};


// ===============================
// UPDATE LEDGER
// ===============================

const updateLedgerModel = async ( connection,  id, ledgerData ) => {

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
  } = ledgerData;

  // FIX: was db.query — must use connection.query to run inside the transaction
  await connection.query(
    `
    UPDATE ledgers SET

      ledger_name = ?,
      group_id = ?,
      employee_under = ?,

      opening_balance = ?,
      balance_type = ?,
      opening_date = ?,

      mailing_name = ?,
      location = ?,
      country = ?,
      state = ?,
      pincode = ?,

      pan_no = ?,
      gst_no = ?,

      maintain_bill_by_bill = ?,
      default_credit_period = ?,
      check_credit_days = ?,
      credit_limit = ?,

      inventory_values_affected = ?,
      use_for_payroll = ?,
      activate_interest_calculation = ?,

      od_limit = ?

    WHERE id = ?
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

      id,
    ]
  );
};

const updateLedgerBankDetailsModel = async (connection, ledger_id, bankData) => {
  const {
    account_holder_name, account_number, ifsc_code,
    bank_name, branch_name, cheque_book_enabled, cheque_printing_enabled,
  } = bankData;

  const [result] = await connection.query(
    `UPDATE ledger_bank_details SET
      account_holder_name = ?,
      account_number = ?,
      ifsc_code = ?,
      bank_name = ?,
      branch_name = ?,
      cheque_book_enabled = ?,
      cheque_printing_enabled = ?
    WHERE ledger_id = ?`,
    [
      account_holder_name || null,
      account_number || null,
      ifsc_code || null,
      bank_name || null,
      branch_name || null,
      cheque_book_enabled || 0,
      cheque_printing_enabled || 0,
      ledger_id,
    ]
  );

  // FIX: if creation never inserted a row for this ledger (bank section
  // wasn't filled/visible at create time), UPDATE matches 0 rows and
  // silently does nothing. Insert instead when that happens.
  if (result.affectedRows === 0) {
    await connection.query(
      `INSERT INTO ledger_bank_details (
        ledger_id, account_holder_name, account_number, ifsc_code,
        bank_name, branch_name, cheque_book_enabled, cheque_printing_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  }
};

const replaceLedgerInterestConfigsModel = async ( connection, ledger_id, interestConfigs ) => {

  await db.query( ` DELETE FROM ledger_interest_config WHERE ledger_id = ? `, [ledger_id] );

  for (const interestData of interestConfigs) {

    const {
      slab_no,
      slab_type,
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

    await connection.query(
      `
      INSERT INTO ledger_interest_config (
        ledger_id,
        slab_no,
        slab_type,

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
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
      `,
      [
        ledger_id,
        slab_no || 1,
        slab_type || null,

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
  }
};

const updateLedgerOtherDetailsModel = async (connection, ledger_id, crmData ) => {

  const {
    customer_name,
    customer_dob,
    firm_name,
    firm_type,
    firm_email,
    firm_since,
    firm_pan,
    firm_aadhar,
    firm_gstn_type,
    firm_annual_turnover,
    expected_sale_per_year,
    other_company_detail,
    address,
    state,
    district,
    tehsil,
    pincode,
    landmark,
    branch,
    contact,
    responsible_person_name,
    responsible_person_address,
    responsible_person_contact,
    seed_licence_no,
    fert_licence_no,
    pest_licence_no,
    transport_name,
    bank_name,
    bank_acc_number,
    bank_ifsc,
    bank_branch,
    security_cheque_no1,
    security_cheque_no2,
  } = crmData;

  await connection.query(
    ` UPDATE ledger_other_details SET

      customer_name = ?,
      customer_dob = ?,
      firm_name = ?,
      firm_type = ?,
      firm_email = ?,
      firm_since = ?,
      firm_pan = ?,
      firm_aadhar = ?,
      firm_gstn_type = ?,
      firm_annual_turnover = ?,
      expected_sale_per_year = ?,
      other_company_detail = ?,
      address = ?,
      state = ?,
      district = ?,
      tehsil = ?,
      pincode = ?,
      landmark = ?,
      branch = ?,
      contact = ?,
      responsible_person_name = ?,
      responsible_person_address = ?,
      responsible_person_contact = ?,
      seed_licence_no = ?,
      fert_licence_no = ?,
      pest_licence_no = ?,
      transport_name = ?,
      bank_name = ?,
      bank_acc_number = ?,
      bank_ifsc = ?,
      bank_branch = ?,
      security_cheque_no1 = ?,
      security_cheque_no2 = ?

    WHERE ledger_id = ? `,
    [
      customer_name || null,
      customer_dob || null,
      firm_name || null,
      firm_type || null,
      firm_email || null,
      firm_since || null,
      firm_pan || null,
      firm_aadhar || null,
      firm_gstn_type || null,
      firm_annual_turnover || null,
      expected_sale_per_year || null,
      other_company_detail || null,
      address || null,
      state || null,
      district || null,
      tehsil || null,
      pincode || null,
      landmark || null,
      branch || null,
      contact || null,
      responsible_person_name || null,
      responsible_person_address || null,
      responsible_person_contact || null,
      seed_licence_no || null,
      fert_licence_no || null,
      pest_licence_no || null,
      transport_name || null,
      bank_name || null,
      bank_acc_number || null,
      bank_ifsc || null,
      bank_branch || null,
      security_cheque_no1 || null,
      security_cheque_no2 || null,
      ledger_id,
    ]
  );
};


// ===============================
// DELETE LEDGER
// ===============================

// FIX: accepts connection so all deletes run inside the controller's transaction.
// Previously used db.query independently — if the final DELETE FROM ledgers
// failed, child rows would already be gone with no way to roll back.
const deleteLedgerModel = async (connection, id) => {
  await connection.query( `DELETE FROM ledger_bank_details WHERE ledger_id = ?`, [id] );
  await connection.query( `DELETE FROM ledger_interest_config WHERE ledger_id = ?`, [id] );
  await connection.query( `DELETE FROM ledger_other_details WHERE ledger_id = ?`, [id] );
  await connection.query( `DELETE FROM ledgers WHERE id = ?`, [id] );
};

const getLedgerDropdownModel = async (search = "") => {

  let whereCondition = "";
  let queryParams = [];

  if (search && search.trim() !== "") {

    whereCondition = `
      WHERE
        l.ledger_name LIKE ?
        OR l.mailing_name LIKE ?
        OR l.gst_no LIKE ?
        OR u.name LIKE ?
    `;

    const searchValue = `%${search.trim()}%`;

    queryParams.push(
      searchValue,
      searchValue,
      searchValue,
      searchValue
    );
  }

  const [rows] = await db.query(
    `
    SELECT
      l.id,
      l.ledger_name,
      l.employee_under,

      COALESCE(u.name, '') AS employee_name,

      l.group_id,
      ag.group_name,
      l.state,
      l.gst_no

    FROM ledgers l

    LEFT JOIN account_groups ag
    ON ag.id = l.group_id

    LEFT JOIN users u
    ON u.id = l.employee_under

    ${whereCondition}

    ORDER BY l.ledger_name ASC
    `,
    queryParams
  );

  return rows;
};

const reassignLedgerEmployeeModel = async (
  ledger_id,
  employee_under
) => {

  console.log("MODEL ledger_id:", ledger_id);
  console.log(
    "MODEL employee_under:",
    employee_under
  );

  const parsedLedgerId = Number(ledger_id);

  const parsedEmployeeUnder =
    employee_under !== undefined &&
    employee_under !== null &&
    employee_under !== ""
      ? Number(employee_under)
      : null;

  console.log(
    "parsedLedgerId:",
    parsedLedgerId
  );

  console.log(
    "parsedEmployeeUnder:",
    parsedEmployeeUnder
  );

  if (Number.isNaN(parsedLedgerId)) {
    throw new Error("Invalid ledger_id");
  }

  if (
    parsedEmployeeUnder !== null &&
    Number.isNaN(parsedEmployeeUnder)
  ) {
    throw new Error("Invalid employee_under");
  }

  const [result] = await db.query(
    `
    UPDATE ledgers
    SET
      employee_under = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      parsedEmployeeUnder,
      parsedLedgerId,
    ]
  );

  return result;
};

// models/ledgerModel.js

const getCurrentLedgerBalance = async ( connection, ledgerId ) => {

  const [[ledger]] = await connection.query( ` SELECT opening_balance, balance_type FROM ledgers WHERE id = ? `, [ledgerId] );

  if (!ledger) return 0;

  let balance = Number(ledger.opening_balance);

  const [transactions] = await connection.query(
    ` SELECT entry_type, amount FROM ledger_transactions WHERE ledger_id = ? AND is_cancelled = 0 `, [ledgerId]
  );

  for (const trx of transactions) {

    if (trx.entry_type === "Dr") { balance += Number(trx.amount);
    } else { balance -= Number(trx.amount); }
  }

  return balance;
};

const getMyAssignedLedgersModel = async (employeeId) => {
  const [rows] = await db.query(
    ` SELECT
      l.id,
      l.ledger_name,
      l.group_id,
      l.employee_under,
      l.opening_balance,
      l.balance_type,
      l.mailing_name,
      l.location,
      l.country,
      l.state,
      l.pincode,
      l.pan_no,
      l.gst_no,
      l.credit_limit,

      (
        SELECT lic.security_amount
        FROM ledger_interest_config lic
        WHERE lic.ledger_id = l.id AND lic.slab_type = 'security'
        LIMIT 1
      ) AS security_amount,

      (
        SELECT lic.rate
        FROM ledger_interest_config lic
        WHERE lic.ledger_id = l.id AND lic.slab_type = 'debit'
        LIMIT 1
      ) AS debit_interest_rate,

      (
        SELECT lic.rate
        FROM ledger_interest_config lic
        WHERE lic.ledger_id = l.id AND lic.slab_type = 'credit'
        LIMIT 1
      ) AS credit_interest_rate,

      l.created_at
    FROM ledgers l
    WHERE l.employee_under = ?
    ORDER BY l.ledger_name ASC
    `,
    [employeeId]
  );

  return rows;
};

const getLedgerWhatsappData = async (ledgerId) => {

    const [rows] = await db.query(
        `
        SELECT
            l.id,
            l.ledger_name,
            lo.customer_name,
            lo.contact

        FROM ledgers l

        LEFT JOIN ledger_other_details lo
            ON lo.ledger_id = l.id

        WHERE l.id = ?
        `,
        [ledgerId]
    );

    return rows[0];
};

const getLedgerContactById = async (ledger_id) => {
  const [rows] = await db.query(
    `SELECT contact FROM ledger_other_details WHERE ledger_id = ? LIMIT 1`,
    [ledger_id]
  );
  return rows[0]?.contact || null;
};


module.exports = { createLedger, createLedgerBankDetails, createLedgerInterestConfigs, createLedgerOtherDetails,
  findLedgerByName, getLedgersModel, getLedgerCountModel, getLedgerByIdModel, updateLedgerModel,
  updateLedgerBankDetailsModel, replaceLedgerInterestConfigsModel, updateLedgerOtherDetailsModel,
  deleteLedgerModel, getLedgerDropdownModel, reassignLedgerEmployeeModel, getCurrentLedgerBalance, getMyAssignedLedgersModel, getLedgerWhatsappData ,getLedgerContactById };