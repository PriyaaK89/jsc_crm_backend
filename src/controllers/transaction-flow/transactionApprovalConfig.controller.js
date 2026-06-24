const approvalConfigModel = require("../../models/transaction-flow/transactionApprovalConfig.model");

exports.createApprovalConfig = async (req, res) => {
    try {
        const { employee_id, junior_accountant_id, dispatcher_id, senior_accountant_id } = req.body;
        const existing = await approvalConfigModel.getApprovalConfigByEmployee( employee_id );

        if (existing) {
            return res.status(400).json({
                success: false,
                message: "Approval configuration already exists for this employee"
            });
        }

        const id = await approvalConfigModel.createApprovalConfig({
                    employee_id,
                    junior_accountant_id,
                    dispatcher_id,
                    senior_accountant_id,
                    created_by: req.user.id
                });

        return res.status(201).json({
            success: true,
            message: "Approval configuration created successfully",
            id
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getAllApprovalConfigs = async (req, res) => {

    try {
        const data =  await approvalConfigModel.getAllApprovalConfigs();

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

exports.getApprovalConfigByEmployee = async (req, res) => {

    try { const data = await approvalConfigModel.getApprovalConfigByEmployee( req.params.employee_id );

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

exports.updateApprovalConfig = async (req, res) => {
    try {
        await approvalConfigModel.updateApprovalConfig(
                req.params.id,
                {
                    ...req.body,
                    updated_by: req.user.id
                }
            );

        return res.status(200).json({
            success: true,
            message:
                "Approval configuration updated successfully"
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
