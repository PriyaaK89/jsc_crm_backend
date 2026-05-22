const db = require("../config/db");

const getStockItemsDropdown = async () => {
  const [rows] = await db.query(
    ` SELECT id, item_name FROM stock_items WHERE is_active = 1 ORDER BY item_name ASC `,
  );

  return rows;
};

const getStockItemBatches = async (itemId, godownId) => {
  const [rows] = await db.query(
    `

        SELECT
            batch_no,
            MIN(transaction_date) AS mfg_date,
            NULL AS expiry_date,

            SUM(qty_in - qty_out) AS qty,

            AVG(rate) AS rate

        FROM stock_transactions

        WHERE stock_item_id = ?
        AND godown_id = ?
        AND batch_no IS NOT NULL
        GROUP BY batch_no
        HAVING qty > 0
        ORDER BY batch_no ASC
    `,
    [itemId, godownId],
  );

  return rows;
};

const createManufacturing = async (data) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `
           INSERT INTO manufacturing_entries (
    entry_date,
    finished_item_id,
    finished_godown_id,
    produced_qty,
    batch_no,
    mfg_date,
    expiry_date,
    total_component_cost,
    total_additional_cost,
    total_cost,
    effective_rate,
    narration,
    created_by
)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      [
        data.entry_date,
        data.finished_item_id,
        data.finished_godown_id,
        data.produced_qty,
        data.batch_no,
        data.mfg_date,
        data.expiry_date,
        data.total_component_cost,
        data.total_additional_cost,
        data.total_cost,
        data.effective_rate,
        data.narration || null,
        data.created_by || null,
      ],
    );

    const manufacturingId = result.insertId;

    for (const item of data.components) {
      await connection.query(
        `
    INSERT INTO manufacturing_components (
        manufacturing_id,
        item_id,
        godown_id,
        qty,
        unit_id,
        rate,
        amount
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
`,
        [
          manufacturingId,
          item.item_id,
          item.godown_id,
          item.qty,
          item.unit_id,
          item.rate,
          item.amount,
        ],
      );

      // STOCK OUT

      await connection.query(
        `
    INSERT INTO stock_transactions (
        transaction_type,
        reference_type,
        reference_id,
        transaction_date,
        stock_item_id,
        godown_id,
        batch_no,
        unit_id,
        qty_out,
        rate,
        amount
    )
    VALUES (
        'MANUFACTURING_CONSUMPTION',
        'manufacturing_entries',
        ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
`,
        [
          manufacturingId,
          data.entry_date,
          item.item_id,
          item.godown_id,
          item.batch_no || null,
          item.unit_id,
          item.qty,
          item.rate,
          item.amount,
        ],
      );
    }

    // =========================
    // CO PRODUCTS
    // =========================

    if (data.coproducts?.length) {
      for (const item of data.coproducts) {
        await connection.query(
          `
                    INSERT INTO manufacturing_coproducts (
                        manufacturing_id,
                        item_id,
                        godown_id,
                        qty,
                        cost_allocation_percent,
                        unit_id,
                        rate,
                        amount
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `,
          [
            manufacturingId,
            item.item_id,
            item.godown_id,
            item.qty,
            item.cost_allocation_percent,
            item.unit_id,
            item.rate,
            item.amount,
          ],
        );
      }
    }

    // =========================
    // ADDITIONAL COSTS
    // =========================

    if (data.additional_costs?.length) {
      for (const cost of data.additional_costs) {
        await connection.query(
          `
                    INSERT INTO manufacturing_additional_costs (
                        manufacturing_id,
                        ledger_id,
                        amount
                    )
                    VALUES (?, ?, ?)
                `,
          [manufacturingId, cost.ledger_id, cost.amount],
        );
      }
    }

    // =========================
    // FINISHED PRODUCT STOCK IN
    // =========================

    await connection.query(
      `
    INSERT INTO stock_transactions (
        transaction_type,
        reference_type,
        reference_id,
        transaction_date,
        stock_item_id,
        godown_id,
        batch_no,
        unit_id,
        qty_in,
        rate,
        amount
    )
    VALUES (
        'MANUFACTURING_PRODUCTION',
        'manufacturing_entries',
        ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
`,
      [
        manufacturingId,
        data.entry_date,
        data.finished_item_id,
        data.finished_godown_id,
        data.batch_no,
        data.finished_unit_id,
        data.produced_qty,
        data.effective_rate,
        data.total_cost,
      ],
    );

    // =========================
    // BATCH ENTRY
    // =========================

    await connection.query(
      `
    INSERT INTO stock_batches (
        stock_item_id,
        godown_id,
        batch_no,
        mfg_date,
        expiry_date,
        qty,
        rate,
        manufacturing_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`,
      [
        data.finished_item_id,
        data.finished_godown_id,
        data.batch_no,
        data.mfg_date,
        data.expiry_date,
        data.produced_qty,
        data.effective_rate,
        manufacturingId,
      ],
    );

    await connection.commit();

    return {
      success: true,
      manufacturingId,
    };
  } catch (error) {
    await connection.rollback();

    throw error;
  } finally {
    connection.release();
  }
};

const getAvailableStock = async (itemId, godownId, batchNo = null) => {
  let query = `
        SELECT
            COALESCE(SUM(qty_in), 0)
            -
            COALESCE(SUM(qty_out), 0)
            AS available_stock
        FROM stock_transactions
        WHERE stock_item_id = ?
        AND godown_id = ?
    `;
  const params = [itemId, godownId];
  if (batchNo) {
    query += `
            AND batch_no = ?
        `;
    params.push(batchNo);
  }

  const [rows] = await db.query(query, params);

  return rows[0];
};

const getManufacturingReport = async ({
  filter_type,
  item_id,
  godown_id,
  search = "",
  page = 1,
  limit = 10,
}) => {
  let whereConditions = [];
  let params = [];

  // =========================
  // FILTERS
  // =========================

  if (filter_type === "ITEM_WISE") {
    whereConditions.push(`me.finished_item_id = ?`);
    params.push(item_id);
  }

  if (filter_type === "GODOWN_WISE") {
    whereConditions.push(`me.finished_godown_id = ?`);
    params.push(godown_id);
  }

  // =========================
  // SEARCH FILTER
  // =========================

  if (search) {
    whereConditions.push(`
      (
        si.item_name LIKE ?
        OR g.godown_name LIKE ?
        OR me.batch_no LIKE ?
      )
    `);

    params.push(`%${search}%`);
    params.push(`%${search}%`);
    params.push(`%${search}%`);
  }

  // =========================
  // FINAL WHERE CONDITION
  // =========================

  let whereClause = "";

  if (whereConditions.length > 0) {
    whereClause = `WHERE ${whereConditions.join(" AND ")}`;
  }

  // =========================
  // PAGINATION
  // =========================

  const offset = (page - 1) * limit;

  // =========================
  // TOTAL COUNT QUERY
  // =========================

  const [countResult] = await db.query(
    `
      SELECT COUNT(*) AS total_records

      FROM manufacturing_entries me

      LEFT JOIN stock_items si
        ON si.id = me.finished_item_id

      LEFT JOIN godowns g
        ON g.id = me.finished_godown_id

      ${whereClause}
    `,
    params
  );

  const total_records = countResult[0].total_records;

  // =========================
  // MAIN DATA QUERY
  // =========================

  const [rows] = await db.query(
    `
      SELECT
          me.id,
          si.item_name,
          g.godown_name AS item_godown,
          me.produced_qty AS item_qty,
          me.batch_no AS item_batch,
          me.mfg_date,
          me.expiry_date AS exp_date,
          me.total_additional_cost AS additional_cost,
          me.total_cost AS effective_cost,

          (
              me.total_cost
              -
              me.total_additional_cost
          ) AS allocation_primary_item,

          me.effective_rate,
          me.created_at

      FROM manufacturing_entries me

      LEFT JOIN stock_items si
          ON si.id = me.finished_item_id

      LEFT JOIN godowns g
          ON g.id = me.finished_godown_id

      ${whereClause}

      ORDER BY me.id DESC

      LIMIT ?
      OFFSET ?
    `,
    [...params, Number(limit), Number(offset)]
  );

  return {
    total_records,
    current_page: Number(page),
    per_page: Number(limit),
    total_pages: Math.ceil(total_records / limit),
    data: rows,
  };
};

module.exports = {
  getStockItemsDropdown,
  getStockItemBatches,
  createManufacturing,
  getAvailableStock, getManufacturingReport
};
