
const reportModel = require("../models/ledger-report/partyLedgerReportSummary")

exports.getPartyLedgerSummary = async (req, res) => {
    try {
        const { ledger_id } = req.query;

        if (!ledger_id) {
            return res.status(400).json({
                success: false,
                message: "ledger_id is required",
            });
        }

        const summary = await reportModel.getPartyLedgerSummary(ledger_id);

        if (!summary) {
            return res.status(404).json({
                success: false,
                message: "Ledger not found",
            });
        }

        res.status(200).json({
            success: true,
            data: summary,
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

