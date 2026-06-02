const db = require("../config/db");

const generateVoucherNo = async (voucherType) => {

    // GET ACTIVE VOUCHER

    const [voucherRows] = await db.query(
        `
        SELECT *
        FROM voucher_types
        WHERE voucher_type = ?
        AND status = 'ACTIVE'
        AND CURDATE() BETWEEN voucher_start_date
        AND voucher_end_date
        LIMIT 1
        `,
        [voucherType]
    );

    // VALIDATION

    if (!voucherRows.length) {
        throw new Error(
            `Active voucher not found for ${voucherType}`
        );
    }

    const voucher = voucherRows[0];

    const {
        id,
        prefix,
        suffix,
        numbering_method,
        current_sequence,
        starting_number,
        decimal_digit
    } = voucher;

    // MANUAL NUMBERING

    if (numbering_method === "MANUAL") {
        return {
            voucher_no: null,
            voucher_type_id: id,
            nextSequence: null
        };
    }

    let nextSequence;

    /*
    =====================================
    FIRST ENTRY
    =====================================

    starting_number = 1
    current_sequence = 0

    nextSequence = 1

    =====================================
    */

    if (
        current_sequence &&
        current_sequence >= starting_number
    ) {
        nextSequence = current_sequence + 1;
    } else {
        nextSequence = starting_number || 1;
    }

    // FORMAT NUMBER WITH LEADING ZEROS

    const formattedSequence =
    "0".repeat(decimal_digit || 0) +
    nextSequence;

    // BUILD VOUCHER NUMBER

    const parts = [];

    if (prefix?.trim()) {
        parts.push(prefix.trim());
    }

    if (suffix?.trim()) {
        parts.push(suffix.trim());
    }

    parts.push(formattedSequence);

    const voucher_no = parts.join("/");

    return {
        voucher_no,
        voucher_type_id: id,
        nextSequence
    };
};

module.exports = generateVoucherNo;