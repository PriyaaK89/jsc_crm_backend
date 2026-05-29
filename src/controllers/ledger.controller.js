const {
  createLedger,
  createLedgerBankDetails,
  createLedgerOtherDetails,
  createLedgerInterestConfigs,
  findLedgerByName,
  getLedgersModel,
  getLedgerCountModel,
  getLedgerByIdModel,
  updateLedgerModel,
  updateLedgerBankDetailsModel,
  replaceLedgerInterestConfigsModel,
  updateLedgerOtherDetailsModel,
  deleteLedgerModel, getLedgerDropdownModel, reassignLedgerEmployeeModel
} = require("../models/ledger.model");

const { getGroupById } = require("../models/accountGroup.model");

// FIX: import db so controllers can use getConnection()
const db = require("../config/db");

const isValidBoolean = (value) => {
  return value === 0 || value === 1;
};


// ===============================
// CREATE LEDGER
// ===============================

const createLedgerController = async (req, res) => {
  try {
    const {
      ledger_name, group_id, employee_under,
      opening_balance, balance_type, opening_date,
      mailing_name, location, country, state, pincode, pan_no, gst_no,
      maintain_bill_by_bill, default_credit_period, check_credit_days, credit_limit,
      inventory_values_affected, use_for_payroll, activate_interest_calculation, od_limit,
      bank_details, interest_configs, crm_details,
    } = req.body;

    // --- Validations ---

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

    const group = await getGroupById(group_id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group not found",
      });
    }

    const existingLedger = await findLedgerByName(ledger_name.trim());

    if (existingLedger) {
      return res.status(400).json({
        success: false,
        message: "Ledger already exists",
      });
    }

    // Boolean field validation
    const booleanFields = [
      maintain_bill_by_bill,
      check_credit_days,
      inventory_values_affected,
      use_for_payroll,
      activate_interest_calculation,
      bank_details?.cheque_book_enabled,
      bank_details?.cheque_printing_enabled,
      ...(interest_configs || []).flatMap((config) => [
        config?.calculate_transaction_by_transaction,
        config?.amount_added,
        config?.amount_deducted,
        config?.security_enabled,
      ]),
    ];

    for (const value of booleanFields) {
      if (value !== undefined && value !== null && !isValidBoolean(value)) {
        return res.status(400).json({
          success: false,
          message: "Boolean fields must contain only 0 or 1",
        });
      }
    }

    if (balance_type && !["Cr", "Dr"].includes(balance_type)) {
      return res.status(400).json({
        success: false,
        message: "Balance type must be either Cr or Dr",
      });
    }

    // CRM validation
    if (crm_details) {
      if (
        crm_details.firm_type &&
        !["proprietor", "partner"].includes(crm_details.firm_type)
      ) {
        return res.status(400).json({
          success: false,
          message: "firm_type must be either proprietor or partner",
        });
      }

      if (
        crm_details.firm_gstn_type &&
        !["Composition", "Consumer", "Regular", "Unregistered"].includes(
          crm_details.firm_gstn_type
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid firm_gstn_type value",
        });
      }
    }

    // --- Create Ledger ---
    // FIX: ledgerId is now created FIRST before any sub-table inserts

    const ledgerId = await createLedger({
      ledger_name: ledger_name.trim(),
      group_id,
      employee_under: employee_under || null,
      opening_balance: opening_balance || 0,
      balance_type: balance_type || "Dr",
      opening_date: opening_date || null,
      mailing_name: mailing_name || null,
      location: location || null,
      country: country || null,
      state: state || null,
      pincode: pincode || null,
      pan_no: pan_no || null,
      gst_no: gst_no || null,
      maintain_bill_by_bill: maintain_bill_by_bill ?? 0,
      default_credit_period: default_credit_period || 0,
      check_credit_days: check_credit_days ?? 0,
      credit_limit: credit_limit || 0,
      inventory_values_affected: inventory_values_affected ?? 0,
      use_for_payroll: use_for_payroll ?? 0,
      activate_interest_calculation: activate_interest_calculation ?? 0,
      od_limit: od_limit || 0,
      created_by: req.user?.id || null,
    });

    // --- Bank Details ---

    if (bank_details) {
      await createLedgerBankDetails(ledgerId, {
        account_holder_name: bank_details.account_holder_name || null,
        account_number: bank_details.account_number || null,
        ifsc_code: bank_details.ifsc_code || null,
        bank_name: bank_details.bank_name || null,
        branch_name: bank_details.branch_name || null,
        cheque_book_enabled: bank_details.cheque_book_enabled ?? 0,
        cheque_printing_enabled: bank_details.cheque_printing_enabled ?? 0,
      });
    }

    // --- Interest Configs ---
    // FIX: removed the duplicate early block that used ledgerId before it existed.
    // FIX: now correctly passes an array of config objects (not a plain object).

    if (
      Array.isArray(interest_configs) &&
      interest_configs.length > 0 &&
      activate_interest_calculation === 1
    ) {
      await createLedgerInterestConfigs(
        ledgerId,
        interest_configs.map((config, index) => ({
          slab_no: config.slab_no ?? index + 1,
          calculate_transaction_by_transaction:
            config.calculate_transaction_by_transaction ?? 0,
          interest_based_on: config.interest_based_on ?? null,
          amount_added: config.amount_added ?? 0,
          amount_deducted: config.amount_deducted ?? 0,
          rate: config.rate ?? 0,
          rate_per: config.rate_per ?? null,
          rate_on: config.rate_on ?? null,
          applicability: config.applicability ?? null,
          applicability_days: config.applicability_days ?? 0,
          grace_period: config.grace_period ?? 0,
          security_enabled: config.security_enabled ?? 0,
          security_amount: config.security_amount ?? 0,
        }))
      );
    }

    // --- CRM / Other Details ---

    if (crm_details) {
      await createLedgerOtherDetails(ledgerId, {
        customer_name: crm_details.customer_name || null,
        customer_dob: crm_details.customer_dob || null,
        firm_name: crm_details.firm_name || null,
        firm_type: crm_details.firm_type || null,
        firm_email: crm_details.firm_email || null,
        firm_since: crm_details.firm_since || null,
        firm_pan: crm_details.firm_pan || null,
        firm_aadhar: crm_details.firm_aadhar || null,
        firm_gstn_type: crm_details.firm_gstn_type || null,
        firm_annual_turnover: crm_details.firm_annual_turnover || null,
        expected_sale_per_year: crm_details.expected_sale_per_year || null,
        other_company_detail: crm_details.other_company_detail || null,
        address: crm_details.address || null,
        state: crm_details.state || null,
        district: crm_details.district || null,
        tehsil: crm_details.tehsil || null,
        pincode: crm_details.pincode || null,
        landmark: crm_details.landmark || null,
        branch: crm_details.branch || null,
        contact: crm_details.contact || null,
        responsible_person_name: crm_details.responsible_person_name || null,
        responsible_person_address: crm_details.responsible_person_address || null,
        responsible_person_contact: crm_details.responsible_person_contact || null,
        seed_licence_no: crm_details.seed_licence_no || null,
        fert_licence_no: crm_details.fert_licence_no || null,
        pest_licence_no: crm_details.pest_licence_no || null,
        transport_name: crm_details.transport_name || null,
        bank_name: crm_details.bank_name || null,
        bank_acc_number: crm_details.bank_acc_number || null,
        bank_ifsc: crm_details.bank_ifsc || null,
        bank_branch: crm_details.bank_branch || null,
        security_cheque_no1: crm_details.security_cheque_no1 || null,
        security_cheque_no2: crm_details.security_cheque_no2 || null,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Ledger created successfully",
      ledger_id: ledgerId,
    });

  } catch (error) {
    console.log("CREATE LEDGER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// ===============================
// GET LEDGERS
// ===============================

const getLedgers = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      search = "",
      group_id,
      state,
      activate_interest_calculation,
    } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    const offset = (page - 1) * limit;

    const filters = {
      search,
      group_id,
      state,
      activate_interest_calculation,
    };

    const totalRecords = await getLedgerCountModel(filters);
    const rows = await getLedgersModel(filters, limit, offset);

    const formattedData = rows.map((row) => ({
      id: row.id,
      ledger_name: row.ledger_name,

      group: {
        id: row.group_id,
        name: row.group_name,
      },

      basic_details: {
        employee_under: row.employee_under,
        opening_balance: Number(row.opening_balance || 0),
        balance_type: row.balance_type,
        opening_date: row.opening_date,
      },

      address_details: {
        mailing_name: row.mailing_name,
        location: row.location,
        country: row.country,
        state: row.state,
        pincode: row.pincode,
      },

      tax_details: {
        pan_no: row.pan_no,
        gst_no: row.gst_no,
      },

      credit_details: {
        maintain_bill_by_bill: row.maintain_bill_by_bill,
        default_credit_period: row.default_credit_period,
        check_credit_days: row.check_credit_days,
        credit_limit: Number(row.credit_limit || 0),
      },

      payroll_and_inventory: {
        inventory_values_affected: row.inventory_values_affected,
        use_for_payroll: row.use_for_payroll,
        activate_interest_calculation: row.activate_interest_calculation,
        od_limit: Number(row.od_limit || 0),
      },

      bank_details: row.bank_detail_id
        ? {
            id: row.bank_detail_id,
            account_holder_name: row.account_holder_name,
            account_number: row.account_number,
            ifsc_code: row.ifsc_code,
            bank_name: row.bank_name,
            branch_name: row.branch_name,
            cheque_book_enabled: row.cheque_book_enabled,
            cheque_printing_enabled: row.cheque_printing_enabled,
          }
        : null,

      interest_configs: row.interest_configs
        ? typeof row.interest_configs === "string"
          ? JSON.parse(row.interest_configs)
          : row.interest_configs
        : [],

      crm_details: row.crm_detail_id
        ? {
            id: row.crm_detail_id,
            customer_name: row.customer_name,
            customer_dob: row.customer_dob,

            firm_details: {
              firm_name: row.firm_name,
              firm_type: row.firm_type,
              firm_email: row.firm_email,
              firm_since: row.firm_since,
              firm_pan: row.firm_pan,
              firm_aadhar: row.firm_aadhar,
              firm_gstn_type: row.firm_gstn_type,
              firm_annual_turnover: Number(row.firm_annual_turnover || 0),
              expected_sale_per_year: Number(row.expected_sale_per_year || 0),
              other_company_detail: row.other_company_detail,
            },

            address_details: {
              address: row.address,
              state: row.crm_state,
              district: row.district,
              tehsil: row.tehsil,
              pincode: row.crm_pincode,
              landmark: row.landmark,
              branch: row.branch,
            },

            contact: row.contact,

            responsible_person: {
              name: row.responsible_person_name,
              address: row.responsible_person_address,
              contact: row.responsible_person_contact,
            },

            licence_details: {
              seed_licence_no: row.seed_licence_no,
              fert_licence_no: row.fert_licence_no,
              pest_licence_no: row.pest_licence_no,
            },

            transport_name: row.transport_name,

            bank_details: {
              bank_name: row.crm_bank_name,
              bank_acc_number: row.bank_acc_number,
              bank_ifsc: row.bank_ifsc,
              bank_branch: row.bank_branch,
            },

            security_cheques: {
              cheque_1: row.security_cheque_no1,
              cheque_2: row.security_cheque_no2,
            },
          }
        : null,

      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return res.status(200).json({
      success: true,
      pagination: {
        total_records: totalRecords,
        current_page: page,
        total_pages: Math.ceil(totalRecords / limit),
        per_page: limit,
      },
      data: formattedData,
    });

  } catch (error) {
    console.log("GET LEDGERS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// ===============================
// GET LEDGER BY ID
// ===============================

const getLedgerByIdController = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;

    const ledger = await getLedgerByIdModel(connection, id);

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: ledger,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch ledger",
      error: error.message,
    });
  }
};


const updateLedgerController = async (req, res) => {
  // FIX: db is now imported at the top, so getConnection() works correctly
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { ledger, bank_details, interest_configs, other_details } = req.body;

    const existingLedger = await getLedgerByIdModel(connection, id);

    if (!existingLedger) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Ledger not found",
      });
    }

    if (ledger) {
      await updateLedgerModel(connection, id, ledger);
    }

    if (bank_details) {
      await updateLedgerBankDetailsModel(connection,id, bank_details);
    }

    if (interest_configs && Array.isArray(interest_configs)) {
      await replaceLedgerInterestConfigsModel(connection, id, interest_configs);
    }

    if (other_details) {
      await updateLedgerOtherDetailsModel(connection, id, other_details);
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Ledger updated successfully",
    });

  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to update ledger",
      error: error.message,
    });

  } finally {
    connection.release();
  }
};


// ===============================
// DELETE LEDGER
// ===============================

const deleteLedgerController = async (req, res) => {
  // FIX: db is now imported at the top, so getConnection() works correctly
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;

    const ledger = await getLedgerByIdModel(connection, id);

    if (!ledger) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Ledger not found",
      });
    }

    await deleteLedgerModel(connection, id);

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Ledger deleted successfully",
    });

  } catch (error) {
    await connection.rollback();
    return res.status(500).json({
      success: false,
      message: "Failed to delete ledger",
      error: error.message,
    });

  } finally {
    connection.release();
  }
};

const getLedgerDropdown = async (req, res) => {

  try {

    const { search = "" } = req.query;

    const rows = await getLedgerDropdownModel(search);

    const formattedData = rows.map((row) => ({
      id: row.id,
      ledger_name: row.ledger_name,

      group: {
        id: row.group_id,
        name: row.group_name,
      },
      emp_name: row.employee_name,

      state: row.state,
      gst_no: row.gst_no,
    }));

    return res.status(200).json({
      success: true,
      total: formattedData.length,
      data: formattedData,
    });

  } catch (error) {

    console.log("GET LEDGER DROPDOWN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const reassignLedgerEmployee = async (
  req,
  res
) => {

  const connection = await db.getConnection();

  try {

    console.log("BODY:", req.body);

    const {
      ledger_id,
      employee_under,
    } = req.body;

    console.log(
      "CONTROLLER ledger_id:",
      ledger_id
    );

    console.log(
      "CONTROLLER employee_under:",
      employee_under
    );

    if (
      ledger_id === undefined ||
      ledger_id === null ||
      ledger_id === ""
    ) {
      return res.status(400).json({
        success: false,
        message: "ledger_id is required",
      });
    }

    const ledger =
      await getLedgerByIdModel(
        connection,
        Number(ledger_id)
      );

    if (!ledger) {
      return res.status(404).json({
        success: false,
        message: "Ledger not found",
      });
    }

    await reassignLedgerEmployeeModel(
      ledger_id,
      employee_under
    );

    return res.status(200).json({
      success: true,
      message:
        "Ledger reassigned successfully",
    });

  } catch (error) {

    console.log(
      "Reassign Ledger Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });

  } finally {

    connection.release();

  }
};


module.exports = {
  createLedgerController,
  getLedgers,
  getLedgerByIdController,
  updateLedgerController,
  deleteLedgerController, getLedgerDropdown, reassignLedgerEmployee
};