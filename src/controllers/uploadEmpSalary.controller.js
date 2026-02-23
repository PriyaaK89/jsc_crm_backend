const uploadToS3 = require("../utils/S3Upload");
const SalaryModel = require("../models/uploadEmpSalary.model");

const uploadSalarySlip = async (req, res) => {
  try {
    const { emp_id, emp_name, month } = req.body;

    if (!emp_id || !emp_name || !month) {
      return res.status(400).json({
        success: false,
        message: "emp_id, emp_name and month are required"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Salary slip image required"
      });
    }

    const uploadResult = await uploadToS3(
      req.file,
      emp_id,
      "salary-slips"
    );

    await SalaryModel.createSalarySlip({
      emp_id,
      emp_name,
      salary_month: month, //  mapping
      salary_slip_url: uploadResult.url
    });

    return res.status(201).json({
      success: true,
      message: "Salary slip uploaded successfully"
    });

  } catch (error) {

    //  Handle duplicate month nicely
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Salary slip already uploaded for this month"
      });
    }

    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

module.exports = {
  uploadSalarySlip
};
