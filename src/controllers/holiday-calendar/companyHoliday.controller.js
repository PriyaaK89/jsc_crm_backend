const Holiday = require("../../models/companyHoliday.model");

exports.getHolidays = async (req, res) => {
  try {
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: "Month and year are required" });
    }

    const holidays = await Holiday.getHolidaysByMonth(Number(month), Number(year));

    return res.json({
      month: Number(month),
      year: Number(year),
      total: holidays.length,
      holidays,
    });
  } catch (error) {
    console.error("Get Holidays Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.addHolidays = async (req, res) => {
  try {
    // TODO: role check — e.g. if (req.user.role !== 'hr') return res.status(403)...

    const { holidays } = req.body;
    // Expected shape: { holidays: [{ date: "2026-10-02", name: "Gandhi Jayanti" }, ...] }

    if (!Array.isArray(holidays) || holidays.length === 0) {
      return res.status(400).json({ message: "holidays array is required" });
    }

    for (const h of holidays) {
      if (!h.date || !h.name) {
        return res.status(400).json({
          message: "Each holiday needs a date and a name",
        });
      }
    }

    const createdBy = req.user?.id || null;
    const insertedCount = await Holiday.bulkCreateHolidays(holidays, createdBy);

    return res.json({
      message: `${insertedCount} holiday(s) added. ${holidays.length - insertedCount} skipped (already existed).`,
      inserted: insertedCount,
      skipped: holidays.length - insertedCount,
    });
  } catch (error) {
    console.error("Add Holidays Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.updateHoliday = async (req, res) => {
  try {
    // TODO: role check

    const { id } = req.params;
    const { date, name } = req.body;

    if (!date || !name) {
      return res.status(400).json({ message: "date and name are required" });
    }

    const existing = await Holiday.getHolidayById(id);
    if (!existing) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    await Holiday.updateHoliday(id, { date, name });

    return res.json({ message: "Holiday updated successfully" });
  } catch (error) {
    // MySQL will throw ER_DUP_ENTRY if the new date collides with another holiday
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "A holiday already exists on that date" });
    }
    console.error("Update Holiday Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.deleteHoliday = async (req, res) => {
  try {
    // TODO: role check

    const { id } = req.params;

    const existing = await Holiday.getHolidayById(id);
    if (!existing) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    await Holiday.deleteHoliday(id);

    return res.json({ message: "Holiday removed successfully" });
  } catch (error) {
    console.error("Delete Holiday Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.getYearlyHolidays = async (req, res) => {
  try {
    const { year } = req.query;

    if (!year) {
      return res.status(400).json({ message: "year is required" });
    }

    const holidays = await Holiday.getHolidaysByYear(Number(year));

    return res.json({
      year: Number(year),
      total: holidays.length,
      holidays,
    });
  } catch (error) {
    console.error("Get Yearly Holidays Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};