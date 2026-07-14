const connection = require("../config/db")

const validateVoucherDate = async ( connection, voucherType, transactionDate ) => {

  const [rows] = await connection.execute(
    ` SELECT id,
      voucher_name,
      voucher_start_date,
      voucher_end_date,
      status
    FROM voucher_types
    WHERE voucher_type = ?
      AND status = 'ACTIVE'
    LIMIT 1
    `, [voucherType]
  );

  if (!rows.length) {
    throw new Error( `Active voucher not found for ${voucherType}` );
  }

  const voucher = rows[0];

  // const formatDate = (date) => {
  //   const year = date.getFullYear();
  //   const month = String(date.getMonth() + 1).padStart(2, "0");
  //   const day = String(date.getDate()).padStart(2, "0");

  //   return `${year}-${month}-${day}`;
  // };
  const formatDate = (date) => {
  // If mysql2 already returned a string (dateStrings: true), just normalize it.
  if (typeof date === "string") {
    return date.split("T")[0].split(" ")[0]; // handles "2026-01-01" or "2026-01-01T00:00:00.000Z"
  }

  // Fallback for actual Date objects (in case config changes back later)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

  const startDate = formatDate(voucher.voucher_start_date);
  const endDate = formatDate(voucher.voucher_end_date);

  console.log("========== VOUCHER DATE VALIDATION ==========");
  console.log("voucherType =", voucherType);
  console.log("transactionDate =", transactionDate);
  console.log("startDate =", startDate);
  console.log("endDate =", endDate);

  console.log(
    "transactionDate < startDate =",
    transactionDate < startDate
  );

  console.log(
    "transactionDate > endDate =",
    transactionDate > endDate
  );

  if (
    transactionDate < startDate ||
    transactionDate > endDate
  ) {
    throw new Error(
      `${voucherType} entries are allowed only between ${startDate} and ${endDate}`
    );
  }

  console.log("Voucher date validation passed.");
  console.log("============================================");

  return voucher;
};

module.exports = validateVoucherDate;