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
        starting_number
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
    ERP / TALLY STYLE LOGIC
    =====================================

    FIRST ENTRY:
        starting_number = 101
        current_sequence = 0

        NEXT = 101

    AFTER FIRST SAVE:
        current_sequence = 101

    NEXT PREVIEW:
        102
    =====================================
    */

    if (
        current_sequence &&
        current_sequence >= starting_number
    ) {

        // NORMAL FLOW

        nextSequence =
            current_sequence + 1;

    } else {

        // FIRST ENTRY

        nextSequence =
            starting_number || 1;
    }

    // FINAL VOUCHER NUMBER

    const voucher_no =
        `${prefix || ""}${nextSequence}${suffix || ""}`;

    return {

        voucher_no,

        voucher_type_id: id,

        nextSequence
    };
};

module.exports = generateVoucherNo;