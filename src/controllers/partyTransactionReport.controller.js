const reportModel = require("../models/partyTransactionReport.modal");
const db = require("../config/db");

exports.getBillsDropdown = async (
    req,
    res
) => {

    try {

        const {
            transaction_type,
            ledger_id
        } = req.query;

        if (!transaction_type || !ledger_id) {

            return res.status(400).json({
                success: false,
                message: "transaction_type and ledger_id are required"
            });
        }

        const data =
            await reportModel
            .getBillDropdown(
                transaction_type,
                ledger_id
            );

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getPartyTransactionReport =
async (req, res) => {
    try {
        const {
            transaction_type,
            employee_id,
            ledger_id,
            voucher_no,
            bill_id,
            from_date,
            to_date,
            page,
            limit
        } = req.query;

        if (!ledger_id) {
            return res.status(400).json({
                success: false,
                message: "ledger_id is required"
            });
        }

        const pageNum = Math.max( 1, parseInt(page, 10) || 1 );
        const limitNum = Math.max( 1, parseInt(limit, 10) || 20 );

        const data =
            await reportModel
            .getPartyTransactionReport({
                transaction_type,
                employee_id,
                ledger_id,
                voucher_no,
                bill_id,
                from_date,
                to_date,
                page: pageNum,
                limit: limitNum
            });

        return res.status(200).json({
            success: true,
            data
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.deleteTransaction = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      transaction_type,
      reference_id
    } = req.body;

    const userId = req.user.id;

    await reportModel.deleteTransaction(
      connection,
      transaction_type,
      reference_id,
      userId
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Transaction cancelled successfully"
    });

  } catch (error) {

    await connection.rollback();

    return res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {
    connection.release();
  }
};