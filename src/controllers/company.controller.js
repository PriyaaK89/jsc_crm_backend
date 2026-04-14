const companyModel = require("../models/company.model");
const { uploadFileToMinio } = require("../utils/fileUpload");

const createCompany = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      company_name,
      country,
      state,
      pincode,
      address,
      financial_year_begin,
      books_begin_from,
      gstin,
      license_no,
      seeds_license_no,
      pesticide_license_no,
      fertilizer_license_no,
      cin_no,
      pan_no,
      bank_name,
      account_no,
      confirm_account_no,
      account_holder_name,
      ifsc_code,
    } = req.body;

    //  validation
    if (!company_name || !phone) {
      return res.status(400).json({
        success: false,
        message: "Company Name and Phone are required",
      });
    }

    if (account_no !== confirm_account_no) {
      return res.status(400).json({
        success: false,
        message: "Account numbers do not match",
      });
    }

    //  upload files
    let company_logo = null;
    let signature = null;

    if (req.files?.company_logo) {
      const uploadLogo = await uploadFileToMinio(
        req.files.company_logo[0],
        "company"
      );
      company_logo = uploadLogo.object_path;
    }

    if (req.files?.signature) {
      const uploadSign = await uploadFileToMinio(
        req.files.signature[0],
        "company"
      );
      signature = uploadSign.object_path;
    }

    //  prepare data
    const companyData = {
      name,
      email,
      phone,
      company_name,
      country,
      state,
      pincode,
      address,
      financial_year_begin,
      books_begin_from,
      gstin,
      license_no,
      seeds_license_no,
      pesticide_license_no,
      fertilizer_license_no,
      cin_no,
      pan_no,
      bank_name,
      account_no,
      account_holder_name,
      ifsc_code,
      company_logo,
      signature,
    };

    const companyId = await companyModel.createCompany(companyData);

    return res.status(201).json({
      success: true,
      message: "Company created successfully",
      data: { id: companyId },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports = {
  createCompany,
};