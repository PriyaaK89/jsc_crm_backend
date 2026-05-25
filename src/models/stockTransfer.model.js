const db = require("../config/db");

const createStockTransfer = async (data) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [transferResult] = await connection.query(
      `
      INSERT INTO stock_transfers (
        transfer_date,
        narration,
        total_source_amount,
        total_destination_amount,
        total_additional_cost,
        total_transport_cost,
        grand_total,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.transfer_date,
        data.narration || null,
        data.total_source_amount || 0,
        data.total_destination_amount || 0,
        data.total_additional_cost || 0,
        data.total_transport_cost || 0,
        data.grand_total || 0,
        data.created_by || null,
      ]
    );

    const transferId = transferResult.insertId;

    // =========================
    // SOURCE ITEMS
    // =========================

    for (const item of data.source_items) {
      await connection.query(
        `
        INSERT INTO stock_transfer_source_items (
          transfer_id,
          item_id,
          godown_id,
          batch_no,
          qty,
          unit_id,
          rate,
          amount,
          remarks
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          transferId,
          item.item_id,
          item.godown_id,
          item.batch_no || null,
          item.qty,
          item.unit_id,
          item.rate || 0,
          item.amount || 0,
          item.remarks || null,
        ]
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
          amount,
          remarks,
          created_by
        )
        VALUES (
          'STOCK_TRANSFER_OUT',
          'stock_transfers',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        `,
        [
          transferId,
          data.transfer_date,
          item.item_id,
          item.godown_id,
          item.batch_no || null,
          item.unit_id,
          item.qty,
          item.rate || 0,
          item.amount || 0,
          item.remarks || null,
          data.created_by || null,
        ]
      );
    }

    // =========================
    // DESTINATION ITEMS
    // =========================

    for (const item of data.destination_items) {

      // SAVE DESTINATION ITEM

      await connection.query(
        `
        INSERT INTO stock_transfer_destination_items (
          transfer_id,
          item_id,
          godown_id,
          batch_no,
          mfg_date,
          expiry_date,
          qty,
          unit_id,
          rate,
          amount,
          remarks
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          transferId,
          item.item_id,
          item.godown_id,
          item.batch_no || null,
          item.mfg_date || null,
          item.expiry_date || null,
          item.qty,
          item.unit_id,
          item.rate || 0,
          item.amount || 0,
          item.remarks || null,
        ]
      );

      // STOCK IN

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
          amount,
          remarks,
          created_by
        )
        VALUES (
          'STOCK_TRANSFER_IN',
          'stock_transfers',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        `,
        [
          transferId,
          data.transfer_date,
          item.item_id,
          item.godown_id,
          item.batch_no || null,
          item.unit_id,
          item.qty,
          item.rate || 0,
          item.amount || 0,
          item.remarks || null,
          data.created_by || null,
        ]
      );
    }

    // =========================
    // ADDITIONAL COSTS
    // =========================

    if (data.additional_costs?.length) {

      for (const cost of data.additional_costs) {

        await connection.query(
          `
          INSERT INTO stock_transfer_additional_costs (
            transfer_id,
            ledger_id,
            amount
          )
          VALUES (?, ?, ?)
          `,
          [
            transferId,
            cost.ledger_id,
            cost.amount,
          ]
        );
      }
    }

    // =========================
    // TRANSPORT
    // =========================

    if (data.transportation) {

      await connection.query(
        `
        INSERT INTO stock_transfer_transportation (
          transfer_id,
          dispatch_doc_no,
          transport_name,
          destination,
          bill_no,
          vehicle_no,
          transport_freight,
          local_freight,
          load_unload_freight
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          transferId,
          data.transportation.dispatch_doc_no || null,
          data.transportation.transport_name || null,
          data.transportation.destination || null,
          data.transportation.bill_no || null,
          data.transportation.vehicle_no || null,
          data.transportation.transport_freight || 0,
          data.transportation.local_freight || 0,
          data.transportation.load_unload_freight || 0,
        ]
      );
    }

    await connection.commit();

    return {
      success: true,
      transferId,
    };

  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const getStockTransferReport = async ({
  item_id,
  from_date,
  to_date,
  search = "",
  page = 1,
  limit = 10,
}) => {

  const currentPage = Number(page) || 1;
  const perPage = Number(limit) || 10;
  const offset = (currentPage - 1) * perPage;

  let whereConditions = [];
  let countParams = [];
  let params = [];

  // =========================
  // DATE FILTER
  // =========================

  if (from_date && to_date) {
    whereConditions.push(`st.transfer_date BETWEEN ? AND ?`);
    countParams.push(from_date, to_date);
    params.push(from_date, to_date);
  }

  // =========================
  // SEARCH
  // =========================

  if (search) {
    whereConditions.push(`
      (
        st.voucher_no LIKE ?
        OR
        st.narration LIKE ?
      )
    `);
    countParams.push(`%${search}%`, `%${search}%`);
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause =
    whereConditions.length
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  // =========================
  // COUNT TOTAL TRANSFERS
  // (paginate by transfer, not by item rows)
  // =========================

  const [[{ total_records }]] = await db.query(
    `SELECT COUNT(*) AS total_records FROM stock_transfers st ${whereClause}`,
    countParams
  );

  const total_pages = Math.ceil(total_records / perPage);

  // =========================
  // GET TRANSFERS (paginated)
  // =========================

  const [transfers] = await db.query(
    `
    SELECT st.*
    FROM stock_transfers st
    ${whereClause}
    ORDER BY st.transfer_date DESC, st.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, perPage, offset]
  );

  if (!transfers.length) {
    return {
      data: [],
      pagination: {
        total_records: Number(total_records),
        total_pages,
        current_page: currentPage,
        per_page: perPage,
      },
    };
  }

  const transferIds = transfers.map((t) => t.id);
  const placeholders = transferIds.map(() => "?").join(",");

  // =========================
  // SOURCE ITEMS
  // =========================

  const [sourceItems] = await db.query(
    `
    SELECT
      ssi.*,
      si.item_name AS source_item_name,
      g.godown_name AS source_godown
    FROM stock_transfer_source_items ssi
    LEFT JOIN stock_items si ON ssi.item_id = si.id
    LEFT JOIN godowns g ON ssi.godown_id = g.id
    WHERE ssi.transfer_id IN (${placeholders})
    ORDER BY ssi.id ASC
    `,
    transferIds
  );

  // =========================
  // DESTINATION ITEMS
  // =========================

  const [destinationItems] = await db.query(
    `
    SELECT
      dsi.*,
      si.item_name AS destination_item_name,
      g.godown_name AS destination_godown
    FROM stock_transfer_destination_items dsi
    LEFT JOIN stock_items si ON dsi.item_id = si.id
    LEFT JOIN godowns g ON dsi.godown_id = g.id
    WHERE dsi.transfer_id IN (${placeholders})
    ORDER BY dsi.id ASC
    `,
    transferIds
  );

  // =========================
  // ADDITIONAL COSTS
  // =========================

  const [additionalCosts] = await db.query(
    `
    SELECT
      ac.*,
      l.ledger_name AS cost_component_item
    FROM stock_transfer_additional_costs ac
    LEFT JOIN ledgers l ON ac.ledger_id = l.id
    WHERE ac.transfer_id IN (${placeholders})
    `,
    transferIds
  );

  // =========================
  // TRANSPORT
  // =========================

  const [transportations] = await db.query(
    `
    SELECT *
    FROM stock_transfer_transportation
    WHERE transfer_id IN (${placeholders})
    `,
    transferIds
  );

  // =========================
  // BUILD GROUPED RESPONSE
  // One object per transfer, arrays for item-level fields
  // =========================

  const data = transfers.map((transfer) => {

    const sourceRows = sourceItems.filter(
      (s) => s.transfer_id === transfer.id
    );

    const destinationRows = destinationItems.filter(
      (d) => d.transfer_id === transfer.id
    );

    const costRows = additionalCosts.filter(
      (c) => c.transfer_id === transfer.id
    );

    const transport =
      transportations.find(
        (t) => t.transfer_id === transfer.id
      ) || {};

    return {

      id: transfer.id,
      transfer_date: transfer.transfer_date,
      narration: transfer.narration,

      // ── SOURCE ITEMS (arrays) ──────────────────────
      source_items: sourceRows.map((s) => ({
        item_name:  s.source_item_name || null,
        godown:     s.source_godown    || null,
        batch:      s.batch_no         || null,
        qty:        Number(s.qty    || 0),
        rate:       Number(s.rate   || 0),
        amount:     Number(s.amount || 0),
      })),

      // ── DESTINATION ITEMS (arrays) ─────────────────
      destination_items: destinationRows.map((d) => ({
        item_name:  d.destination_item_name || null,
        godown:     d.destination_godown    || null,
        batch:      d.batch_no              || null,
        qty:        Number(d.qty    || 0),
        rate:       Number(d.rate   || 0),
        amount:     Number(d.amount || 0),
      })),

      // ── ADDITIONAL COSTS (arrays) ──────────────────
      cost_components: costRows.map((c) => ({
        item:   c.cost_component_item || null,
        amount: Number(c.amount || 0),
      })),

      // ── TRANSPORT (single object) ──────────────────
      transport: {
        name:                 transport.transport_name    || null,
        destination:          transport.destination       || null,
        vehicle_no:           transport.vehicle_no        || null,
        transport_freight:    Number(transport.transport_freight    || 0),
        local_freight:        Number(transport.local_freight        || 0),
        load_unload_freight:  Number(transport.load_unload_freight  || 0),
      },

      // ── TOTALS (single values) ─────────────────────
      total_source_amount:      Number(transfer.total_source_amount      || 0),
      total_destination_amount: Number(transfer.total_destination_amount || 0),
      total_additional_cost:    Number(transfer.total_additional_cost    || 0),
      total_transport_cost:     Number(transfer.total_transport_cost     || 0),
      grand_total:              Number(transfer.grand_total              || 0),
    };
  });

  return {
    data,
    pagination: {
      total_records: Number(total_records),
      total_pages,
      current_page:  currentPage,
      per_page:      perPage,
    },
  };
};


module.exports = {
    createStockTransfer, getStockTransferReport
}