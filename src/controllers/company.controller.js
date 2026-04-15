const companyModel = require("../models/company.model");
const { uploadFileToMinio } = require("../utils/fileUpload");
const {getPresignedUrl} = require("../utils/fileUpload")

const createCompany = async (req, res) => {
  try {
    const {
      company_name, email, phone, country, state, pincode, address,
      financial_year_begin, books_begin_from, gstin, license_no,
      seeds_license_no, pesticide_license_no, fertilizer_license_no,
      cin_no, pan_no, bank_name, account_no, confirm_account_no, account_holder_name, ifsc_code, } = req.body;

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
      company_name, email, phone, country, state, pincode, address,
      financial_year_begin, books_begin_from,
      gstin, license_no, seeds_license_no, pesticide_license_no, fertilizer_license_no,
      cin_no, pan_no, bank_name, account_no,
      account_holder_name, ifsc_code, company_logo, signature,};

    const companyId = await companyModel.createCompany(companyData);

    return res.status(201).json({
      success: true,
      message: "Company created successfully",
      data: { id: companyId,
        data: companyData},
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getCompanies = async (req, res) => {
  try {
    let { page = 1, limit = 10, search } = req.query;

    const offset = (page - 1) * limit;

    const result = await companyModel.getCompanies({
      search,
      limit,
      offset,
    });

    const updatedData = await Promise.all(
      result.data.map(async (item) => {
        let logoUrl = null;
        let signUrl = null;

        if (item.company_logo) {
          logoUrl = await getPresignedUrl(item.company_logo);
        }

        if (item.signature) {
          signUrl = await getPresignedUrl(item.signature);
        }

        return {
          ...item,
          company_logo_url: logoUrl,
          signature_url: signUrl,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: updatedData,
      pagination: {
        total: result.total,
        page: Number(page),
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    const company = await companyModel.getCompanyById(id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // generate presigned URLs
    let logoUrl = null;
    let signatureUrl = null;

    if (company.company_logo) {
      logoUrl = await getPresignedUrl(company.company_logo);
    }

    if (company.signature) {
      signatureUrl = await getPresignedUrl(company.signature);
    }

    return res.status(200).json({
      success: true,
      data: {
        ...company,
        company_logo_url: logoUrl,
        signature_url: signatureUrl,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const updateCompany = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      account_no,
      confirm_account_no,
      ...rest
    } = req.body;

    if (account_no && confirm_account_no && account_no !== confirm_account_no) {
      return res.status(400).json({
        success: false,
        message: "Account numbers do not match",
      });
    }

    let company_logo;
    let signature;

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

    const updateData = {
      ...rest,
      ...(account_no && { account_no }),
      ...(company_logo && { company_logo }),
      ...(signature && { signature }),
    };

    await companyModel.updateCompany(id, updateData);

    return res.status(200).json({
      success: true,
      message: "Company updated successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

const deleteCompany = async (req, res) => {
  try {
    const { id } = req.params;

    await companyModel.deleteCompany(id);

    return res.status(200).json({
      success: true,
      message: "Company deleted successfully",
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

module.exports = { createCompany, getCompanies, updateCompany, deleteCompany, getCompanyById};