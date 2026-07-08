const generateVoucherNo = require("../utils/generateVoucherNo");

exports.getNextVoucherNo = async (req, res) => {
  try {
    const { voucher_type } = req.query;

    if (!voucher_type) {
      return res.status(400).json({
        success: false,
        message: "voucher_type is required",
      });
    }

    // if (!transaction_date) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "transaction_date is required",
    //   });
    // }

    const data = await generateVoucherNo( voucher_type );

    return res.status(200).json({
      success: true,
      ...data,
    });

  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};