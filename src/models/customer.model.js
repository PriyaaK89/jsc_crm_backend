const db = require("../config/db");

exports.createCustomer = async (data) => {
  const query = `INSERT INTO customers
    (type, name, firm_name, firm_address, contact_number, alt_contact_number,
     gst_number, address, area, town, state, district, pincode,
     retailer_id, distributor_ledger_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const [result] = await db.query(query, data);
  return result.insertId;
};

// A "distributor visit" needs a customers row to attach the visit to.
// One customers row of type='distributor' per ledger — created once, reused after.
exports.findOrCreateDistributorCustomer = async (ledgerId, employeeId) => {
  const [existing] = await db.query(
    `SELECT id FROM customers WHERE type = 'distributor' AND distributor_ledger_id = ? LIMIT 1`,
    [ledgerId]
  );
  if (existing[0]) return existing[0].id;

const [ledgerRows] = await db.query(
  `SELECT ledger_name, location, state, pincode, gst_no FROM ledgers WHERE id = ?`,
  [ledgerId]
);
  const ledger = ledgerRows[0];
  if (!ledger) throw new Error("Ledger not found");

  const [result] = await db.query(
    `INSERT INTO customers
      (type, name, firm_name, firm_address, contact_number, alt_contact_number,
       gst_number, address, area, town, state, district, pincode,
       retailer_id, distributor_ledger_id, created_by)
     VALUES ('distributor', ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)`,
    [
      ledger.ledger_name,
      ledger.ledger_name,
      ledger.gst_no || null,
      ledger.state || null,
      ledger.district || null,
      ledger.pincode || null,
      ledgerId,
      employeeId,
    ]
  );
  return result.insertId;
};

// ============================================================
// DROPDOWNS (assigned distributors / cascading retailer & farmer lists)
// ============================================================

// "Assigned ledger list" — used for visit_type = distributor, AND as the
// distributor picker whenever a new retailer or new farmer's retailer is created.
exports.getAssignedDistributorLedgers = async (employeeId) => {
  const [rows] = await db.query(
    `SELECT id, ledger_name, location, state, district
     FROM ledgers
     WHERE employee_under = ?
     ORDER BY ledger_name ASC`,
    [employeeId]
  );
  return rows;
};



// "Existing customer" dropdown for a visit — scoped to the employee unless admin.
exports.getCustomersByType = async (type, employeeId, isAdmin) => {
  let query = `
    SELECT id, name, firm_name, contact_number, type, retailer_id, distributor_ledger_id
    FROM customers
    WHERE type = ?
  `;
  const params = [type];

  if (!isAdmin) {
    query += " AND created_by = ?";
    params.push(employeeId);
  }
  query += " ORDER BY name ASC";

  const [rows] = await db.query(query, params);
  return rows;
};



exports.getCustomerById = async (id) => {
  const [rows] = await db.query("SELECT * FROM customers WHERE id = ?", [id]);
  return rows[0];
};

exports.findCustomer = async (contact_number, type) => {
  const [rows] = await db.query(
    `SELECT * FROM customers WHERE contact_number = ? AND type = ?`,
    [contact_number, type]
  );
  return rows[0];
};

// Idempotent: returns 1 if a new link was created, 0 if it already existed.
exports.linkRetailerToDistributor = async (retailerId, distributorLedgerId, createdBy) => {
  const [r] = await db.query(
    `INSERT IGNORE INTO retailer_distributors (retailer_id, distributor_ledger_id, created_by)
     VALUES (?, ?, ?)`,
    [retailerId, distributorLedgerId, createdBy || null]
  );
  return r.affectedRows;
};

exports.linkFarmerToRetailer = async (farmerId, retailerId, createdBy) => {
  const [r] = await db.query(
    `INSERT IGNORE INTO farmer_retailers (farmer_id, retailer_id, created_by)
     VALUES (?, ?, ?)`,
    [farmerId, retailerId, createdBy || null]
  );
  return r.affectedRows;
};

// includeAll = false -> only retailers linked to this distributor
// includeAll = true  -> also retailers NOT linked yet (flagged is_assigned = 0).
//   Non-admins see unlinked retailers only if they created them or visited them before.
exports.getRetailersByDistributor = async (
  distributorLedgerId, employeeId, isAdmin, includeAll = false
) => {
  let query = `
    SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district, c.pincode,
           (rd.id IS NOT NULL) AS is_assigned
    FROM customers c
    LEFT JOIN retailer_distributors rd
           ON rd.retailer_id = c.id AND rd.distributor_ledger_id = ?
    WHERE c.type = 'retailer'
  `;
  const params = [distributorLedgerId];

  if (!includeAll) {
    query += ` AND rd.id IS NOT NULL`;
  } else if (!isAdmin) {
    query += ` AND (
      rd.id IS NOT NULL
      OR c.created_by = ?
      OR EXISTS (SELECT 1 FROM visits v WHERE v.customer_id = c.id AND v.user_id = ?)
    )`;
    params.push(employeeId, employeeId);
  }

  query += ` ORDER BY is_assigned DESC, c.name ASC`;
  const [rows] = await db.query(query, params);
  return rows;
};

exports.getFarmersByRetailer = async (retailerId, employeeId, isAdmin) => {
  let query = `
    SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district, c.pincode,
           fr.retailer_id
    FROM farmer_retailers fr
    JOIN customers c ON c.id = fr.farmer_id
    WHERE c.type = 'farmer' AND fr.retailer_id = ?
  `;
  const params = [retailerId];
  if (!isAdmin) {
    query += ` AND c.created_by = ?`;
    params.push(employeeId);
  }
  query += ` ORDER BY c.name ASC`;
  const [rows] = await db.query(query, params);
  return rows;
};

exports.getUnmappedFarmers = async (employeeId, isAdmin) => {
  let query = `
    SELECT c.id, c.name, c.firm_name, c.contact_number
    FROM customers c
    WHERE c.type = 'farmer'
      AND NOT EXISTS (SELECT 1 FROM farmer_retailers fr WHERE fr.farmer_id = c.id)
  `;
  const params = [];
  if (!isAdmin) {
    query += ` AND c.created_by = ?`;
    params.push(employeeId);
  }
  query += ` ORDER BY c.name ASC`;
  const [rows] = await db.query(query, params);
  return rows;
};

// retailer_name / distributor_name are now comma-joined lists (many-to-many),
// so the Flutter "Customer Details" card keeps working unchanged.
exports.getCustomerMappingById = async (customerId) => {
  const [rows] = await db.query(
    `SELECT
       c.id, c.type, c.name, c.firm_name,
       c.retailer_id, c.distributor_ledger_id,
       (SELECT GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ')
          FROM farmer_retailers fr
          JOIN customers r ON r.id = fr.retailer_id
         WHERE fr.farmer_id = c.id) AS retailer_name,
       (SELECT GROUP_CONCAT(DISTINCT l.ledger_name ORDER BY l.ledger_name SEPARATOR ', ')
          FROM ledgers l
         WHERE l.id IN (
           SELECT rd.distributor_ledger_id
             FROM retailer_distributors rd WHERE rd.retailer_id = c.id
           UNION
           SELECT fd.distributor_ledger_id
             FROM farmer_distributors fd WHERE fd.farmer_id = c.id
           UNION
           SELECT rd2.distributor_ledger_id
             FROM farmer_retailers fr2
             JOIN retailer_distributors rd2 ON rd2.retailer_id = fr2.retailer_id
            WHERE fr2.farmer_id = c.id
         )) AS distributor_name
     FROM customers c
     WHERE c.id = ?`,
    [customerId]
  );
  return rows[0];
};

// Standalone mapping page: ADDS a link (never overwrites), and only fills the
// legacy columns if they are still empty.
exports.updateCustomerMapping = async ({ customerId, retailerId, distributorLedgerId, employeeId }) => {
  await exports.linkRetailerToDistributor(retailerId, distributorLedgerId, employeeId);
  await exports.linkFarmerToRetailer(customerId, retailerId, employeeId);
  const [result] = await db.query(
    `UPDATE customers
        SET retailer_id = COALESCE(retailer_id, ?),
            distributor_ledger_id = COALESCE(distributor_ledger_id, ?)
      WHERE id = ?`,
    [retailerId, distributorLedgerId, customerId]
  );
  return result.affectedRows;
};

// ============================================================
// MAPPING MANAGEMENT (old retailers / farmers)
// ============================================================

// Admin: any customer. Employee: only customers they created or have visited.
exports.canManageCustomer = async (customerId, employeeId, isAdmin) => {
  if (isAdmin) return true;
  const [rows] = await db.query(
    `SELECT 1
       FROM customers c
      WHERE c.id = ?
        AND (c.created_by = ?
             OR EXISTS (SELECT 1 FROM visits v WHERE v.customer_id = c.id AND v.user_id = ?))
      LIMIT 1`,
    [customerId, employeeId, employeeId]
  );
  return rows.length > 0;
};

// Admin: any existing ledger. Employee: only ledgers assigned to them.
exports.getLedgerForEmployee = async (ledgerId, employeeId, isAdmin) => {
  const [rows] = isAdmin
    ? await db.query(`SELECT id FROM ledgers WHERE id = ? LIMIT 1`, [ledgerId])
    : await db.query(
        `SELECT id FROM ledgers WHERE id = ? AND employee_under = ? LIMIT 1`,
        [ledgerId, employeeId]
      );
  return rows[0] || null;
};

exports.isRetailerLinkedToDistributor = async (retailerId, ledgerId) => {
  const [rows] = await db.query(
    `SELECT 1 FROM retailer_distributors
      WHERE retailer_id = ? AND distributor_ledger_id = ? LIMIT 1`,
    [retailerId, ledgerId]
  );
  return rows.length > 0;
};

// Current links of one customer.
//   retailer -> { distributors: [{id, ledger_name}] }
//   farmer   -> { retailers: [{id, name, firm_name, distributors: [...]}] }
exports.getCustomerLinks = async (customerId) => {
  const customer = await exports.getCustomerById(customerId);
  if (!customer) return null;

  const base = {
    id: customer.id,
    type: customer.type,
    name: customer.name,
    firm_name: customer.firm_name,
  };

  if (customer.type === "retailer") {
    const [distributors] = await db.query(
      `SELECT l.id, l.ledger_name
         FROM retailer_distributors rd
         JOIN ledgers l ON l.id = rd.distributor_ledger_id
        WHERE rd.retailer_id = ?
        ORDER BY l.ledger_name ASC`,
      [customerId]
    );
    const farmers = await exports.getLinkedFarmersForRetailer(customerId);
    return { ...base, distributors, farmers };
  }

  if (customer.type === "farmer") {
    const [retailers] = await db.query(
      `SELECT r.id, r.name, r.firm_name
         FROM farmer_retailers fr
         JOIN customers r ON r.id = fr.retailer_id
        WHERE fr.farmer_id = ?
        ORDER BY r.name ASC`,
      [customerId]
    );

    if (retailers.length > 0) {
      const ids = retailers.map((r) => r.id);
      const [dist] = await db.query(
        `SELECT rd.retailer_id, l.id, l.ledger_name
           FROM retailer_distributors rd
           JOIN ledgers l ON l.id = rd.distributor_ledger_id
          WHERE rd.retailer_id IN (${ids.map(() => "?").join(",")})
          ORDER BY l.ledger_name ASC`,
        ids
      );
      retailers.forEach((r) => {
        r.distributors = dist
          .filter((d) => d.retailer_id === r.id)
          .map((d) => ({ id: d.id, ledger_name: d.ledger_name }));
      });
    }
    return { ...base, retailers, distributors: directDistributors };
  }

  return base;
};

exports.unlinkRetailerFromDistributor = async (retailerId, ledgerId) => {
  const [r] = await db.query(
    `DELETE FROM retailer_distributors WHERE retailer_id = ? AND distributor_ledger_id = ?`,
    [retailerId, ledgerId]
  );
  return r.affectedRows;
};

exports.unlinkFarmerFromRetailer = async (farmerId, retailerId) => {
  const [r] = await db.query(
    `DELETE FROM farmer_retailers WHERE farmer_id = ? AND retailer_id = ?`,
    [farmerId, retailerId]
  );
  return r.affectedRows;
};

// Keeps the legacy single columns (used by old web screens) pointing at the
// earliest remaining link, or NULL when there are none.
exports.syncLegacyColumns = async (customerId, type) => {
  if (type === "retailer") {
    await db.query(
      `UPDATE customers
          SET distributor_ledger_id = (
            SELECT rd.distributor_ledger_id FROM retailer_distributors rd
             WHERE rd.retailer_id = ? ORDER BY rd.id LIMIT 1)
        WHERE id = ?`,
      [customerId, customerId]
    );
  } else if (type === "farmer") {
    await db.query(
      `UPDATE customers
          SET retailer_id = (
            SELECT fr.retailer_id FROM farmer_retailers fr
             WHERE fr.farmer_id = ? ORDER BY fr.id LIMIT 1)
        WHERE id = ?`,
      [customerId, customerId]
    );
  }
};


// ============================================================
// DISTRIBUTOR-SIDE MAPPING (used during a distributor visit)
// ============================================================

const DISTRIBUTOR_LINK_TABLES = {
  retailer: { table: "retailer_distributors", col: "retailer_id" },
  farmer: { table: "farmer_distributors", col: "farmer_id" },
};

// What is currently under this distributor.
exports.getDistributorLinks = async (ledgerId) => {
  const [retailers] = await db.query(
    `SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district
       FROM retailer_distributors rd
       JOIN customers c ON c.id = rd.retailer_id
      WHERE rd.distributor_ledger_id = ?
      ORDER BY c.name ASC`,
    [ledgerId]
  );

  const [farmers] = await db.query(
    `SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district
       FROM farmer_distributors fd
       JOIN customers c ON c.id = fd.farmer_id
      WHERE fd.distributor_ledger_id = ?
      ORDER BY c.name ASC`,
    [ledgerId]
  );

  // Read-only: farmers who reach this distributor through one of its retailers.
  const [farmersViaRetailers] = await db.query(
    `SELECT c.id, c.name, c.firm_name, c.contact_number,
            GROUP_CONCAT(DISTINCT r.name ORDER BY r.name SEPARATOR ', ') AS retailer_name
       FROM retailer_distributors rd
       JOIN farmer_retailers fr ON fr.retailer_id = rd.retailer_id
       JOIN customers c ON c.id = fr.farmer_id
       JOIN customers r ON r.id = rd.retailer_id
      WHERE rd.distributor_ledger_id = ?
      GROUP BY c.id, c.name, c.firm_name, c.contact_number
      ORDER BY c.name ASC`,
    [ledgerId]
  );

  return { retailers, farmers, farmers_via_retailers: farmersViaRetailers };
};

// Retailers or farmers that can be linked, flagged with is_assigned.
// Employees see: ones they created, ones they visited, and ones already linked.
exports.getDistributorCandidates = async (ledgerId, type, employeeId, isAdmin) => {
  const cfg = DISTRIBUTOR_LINK_TABLES[type];
  if (!cfg) throw new Error("Invalid type");

  let query = `
    SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district,
           (l.id IS NOT NULL) AS is_assigned
      FROM customers c
      LEFT JOIN ${cfg.table} l
             ON l.${cfg.col} = c.id AND l.distributor_ledger_id = ?
     WHERE c.type = ?
  `;
  const params = [ledgerId, type];

  if (!isAdmin) {
    query += ` AND (
      l.id IS NOT NULL
      OR c.created_by = ?
      OR EXISTS (SELECT 1 FROM visits v WHERE v.customer_id = c.id AND v.user_id = ?)
    )`;
    params.push(employeeId, employeeId);
  }

  query += ` ORDER BY c.name ASC LIMIT 500`;
  const [rows] = await db.query(query, params);
  return rows;
};

// Bulk add. Idempotent (INSERT IGNORE). Employees can only add customers they
// created or visited; anything else is counted in notAllowed.
exports.addDistributorLinks = async (ledgerId, type, ids, employeeId, isAdmin) => {
  const cfg = DISTRIBUTOR_LINK_TABLES[type];
  if (!cfg) throw new Error("Invalid type");
  if (ids.length === 0) return { requested: 0, added: 0, alreadyLinked: 0, notAllowed: 0 };

  let query = `SELECT c.id FROM customers c
                WHERE c.type = ? AND c.id IN (${ids.map(() => "?").join(",")})`;
  const params = [type, ...ids];

  if (!isAdmin) {
    query += ` AND (c.created_by = ?
                    OR EXISTS (SELECT 1 FROM visits v WHERE v.customer_id = c.id AND v.user_id = ?))`;
    params.push(employeeId, employeeId);
  }

  const [allowedRows] = await db.query(query, params);
  const allowed = allowedRows.map((r) => r.id);

  let added = 0;
  if (allowed.length > 0) {
    const values = allowed.map(() => "(?, ?, ?)").join(",");
    const flat = allowed.flatMap((id) => [id, ledgerId, employeeId || null]);
    const [r] = await db.query(
      `INSERT IGNORE INTO ${cfg.table} (${cfg.col}, distributor_ledger_id, created_by)
       VALUES ${values}`,
      flat
    );
    added = r.affectedRows;

    if (type === "retailer") {
      for (const id of allowed) {
        await exports.syncLegacyColumns(id, "retailer");
      }
    }
  }

  return {
    requested: ids.length,
    added,
    alreadyLinked: allowed.length - added,
    notAllowed: ids.length - allowed.length,
  };
};

exports.removeDistributorLink = async (ledgerId, type, customerId) => {
  const cfg = DISTRIBUTOR_LINK_TABLES[type];
  if (!cfg) throw new Error("Invalid type");

  const [r] = await db.query(
    `DELETE FROM ${cfg.table} WHERE ${cfg.col} = ? AND distributor_ledger_id = ?`,
    [customerId, ledgerId]
  );
  if (type === "retailer") {
    await exports.syncLegacyColumns(customerId, "retailer");
  }
  return r.affectedRows;
};

// ============================================================
// RETAILER-SIDE FARMER MAPPING (used during a retailer visit)
// ============================================================

// All farmers linked to this retailer — no permission filter, since the
// caller already verified the retailer itself is manageable.
exports.getLinkedFarmersForRetailer = async (retailerId) => {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district
       FROM farmer_retailers fr
       JOIN customers c ON c.id = fr.farmer_id
      WHERE fr.retailer_id = ?
      ORDER BY c.name ASC`,
    [retailerId]
  );
  return rows;
};

// Farmers this employee can offer to link, flagged is_assigned.
exports.getFarmerCandidatesForRetailer = async (retailerId, employeeId, isAdmin) => {
  let query = `
    SELECT c.id, c.name, c.firm_name, c.contact_number, c.area, c.district,
           (fr.id IS NOT NULL) AS is_assigned
      FROM customers c
      LEFT JOIN farmer_retailers fr
             ON fr.farmer_id = c.id AND fr.retailer_id = ?
     WHERE c.type = 'farmer'
  `;
  const params = [retailerId];

  if (!isAdmin) {
    query += ` AND (
      fr.id IS NOT NULL
      OR c.created_by = ?
      OR EXISTS (SELECT 1 FROM visits v WHERE v.customer_id = c.id AND v.user_id = ?)
    )`;
    params.push(employeeId, employeeId);
  }

  query += ` ORDER BY is_assigned DESC, c.name ASC LIMIT 500`;
  const [rows] = await db.query(query, params);
  return rows;
};

// Bulk add. Idempotent. Employees can only add farmers they created or visited.
exports.addFarmersToRetailer = async (retailerId, farmerIds, employeeId, isAdmin) => {
  if (farmerIds.length === 0) return { requested: 0, added: 0, alreadyLinked: 0, notAllowed: 0 };

  let query = `SELECT c.id FROM customers c
                WHERE c.type = 'farmer' AND c.id IN (${farmerIds.map(() => "?").join(",")})`;
  const params = [...farmerIds];

  if (!isAdmin) {
    query += ` AND (c.created_by = ?
                    OR EXISTS (SELECT 1 FROM visits v WHERE v.customer_id = c.id AND v.user_id = ?))`;
    params.push(employeeId, employeeId);
  }

  const [allowedRows] = await db.query(query, params);
  const allowed = allowedRows.map((r) => r.id);

  let added = 0;
  if (allowed.length > 0) {
    const values = allowed.map(() => "(?, ?, ?)").join(",");
    const flat = allowed.flatMap((id) => [id, retailerId, employeeId || null]);
    const [r] = await db.query(
      `INSERT IGNORE INTO farmer_retailers (farmer_id, retailer_id, created_by) VALUES ${values}`,
      flat
    );
    added = r.affectedRows;
    for (const id of allowed) {
      await exports.syncLegacyColumns(id, "farmer");
    }
  }

  return {
    requested: farmerIds.length,
    added,
    alreadyLinked: allowed.length - added,
    notAllowed: farmerIds.length - allowed.length,
  };
};