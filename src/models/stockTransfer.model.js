const connection = require("../config/db");

const createStockTransfer = async (data) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [transferResult] = await connection.query(
      `
      INSERT INTO stock_transfers (
        transfer_date,
        voucher_no,
        narration,
        total_source_amount,
        total_destination_amount,
        total_additional_cost,
        total_transport_cost,
        grand_total,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.transfer_date,
        data.voucher_no || null,
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

module.exports = {
    createStockTransfer
}