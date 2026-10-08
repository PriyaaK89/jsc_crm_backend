const OTHER_CATEGORIES = ["FOOD", "STATIONERY", "COMMUNICATION", "MISC"];
const TRAVEL_MODES = ["BUS", "TRAIN", "TOLL", "AUTO_CAB"];
const VEHICLE_TYPES = ["BIKE", "CAR"];
const FUEL_TYPES = ["PETROL", "DIESEL"];
const PAYMENT_MODES = ["CASH", "CARD", "UPI"];

const trim = (v) => (v === undefined || v === null ? "" : String(v).trim());
const upper = (v) => trim(v).toUpperCase().replace(/[\/\s-]+/g, "_"); // "Auto/Cab" -> "AUTO_CAB"

// Expects YYYY-MM-DD (also accepts a full ISO string). Slicing avoids timezone shifts.
const parseDate = (v) => {
  const s = trim(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return isNaN(new Date(s).getTime()) ? null : s;
};

// "today" in India, not UTC (toISOString() gives the wrong date between 12:00 and 5:30 AM IST)
const todayIST = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * Returns { error } or { expense_date, amount, remarks, details }
 * `details` keys are exactly the new DB column names.
 */
exports.validateExpensePayload = (expenseType, body) => {
  const amount = parseFloat(body.amount);
  if (isNaN(amount) || amount <= 0) {
    return { error: "Amount must be greater than 0" };
  }

  switch (expenseType) {
    case "HOTEL": {
      const hotel_name = trim(body.hotel_name);
      const city = trim(body.city);
      const check_in_date = parseDate(body.check_in_date);
      const check_out_date = parseDate(body.check_out_date);
      const payment_mode = upper(body.payment_mode);

      if (!hotel_name) return { error: "Hotel name is required" };
      if (!city) return { error: "City is required" };
      if (!check_in_date || !check_out_date) {
        return { error: "Valid check_in_date and check_out_date (YYYY-MM-DD) are required" };
      }
      if (check_out_date < check_in_date) {
        return { error: "Check-out date cannot be before check-in date" };
      }
      if (!PAYMENT_MODES.includes(payment_mode)) {
        return { error: `payment_mode must be one of ${PAYMENT_MODES.join(", ")}` };
      }

      return {
        // entry belongs to the day it was submitted; the stay dates live in `details`
        expense_date: todayIST(),
        amount,
        remarks: trim(body.remarks) || null,
        details: { hotel_name, city, check_in_date, check_out_date, payment_mode }
      };
    }

    case "BUS_TRAIN_TOLL": {
      const travel_mode = upper(body.travel_mode);
      const from_location = trim(body.from_location);
      const to_location = trim(body.to_location);
      const expense_date = parseDate(body.expense_date);

      if (!TRAVEL_MODES.includes(travel_mode)) {
        return { error: `travel_mode must be one of ${TRAVEL_MODES.join(", ")}` };
      }
      if (!from_location || !to_location) {
        return { error: "from_location and to_location are required" };
      }
      if (!expense_date) {
        return { error: "Valid expense_date (YYYY-MM-DD) is required" };
      }

      return {
        expense_date,
        amount,
        remarks: trim(body.remarks) || null,
        details: { travel_mode, from_location, to_location }
      };
    }

    case "PETROL_DIESEL": {
      const vehicle_type = upper(body.vehicle_type);
      const fuel_type = upper(body.fuel_type);
      const odometer_km = parseFloat(body.odometer_km);
      const fuel_liters = parseFloat(body.fuel_liters);

      if (!VEHICLE_TYPES.includes(vehicle_type)) {
        return { error: `vehicle_type must be one of ${VEHICLE_TYPES.join(", ")}` };
      }
      if (!FUEL_TYPES.includes(fuel_type)) {
        return { error: `fuel_type must be one of ${FUEL_TYPES.join(", ")}` };
      }
      if (isNaN(odometer_km) || odometer_km <= 0) {
        return { error: "Odometer reading must be greater than 0" };
      }
      if (isNaN(fuel_liters) || fuel_liters <= 0) {
        return { error: "Liters must be greater than 0" };
      }

      return {
        expense_date: parseDate(body.expense_date) || todayIST(), // screen has no date field
        amount,
        remarks: trim(body.remarks) || null,
        details: { vehicle_type, fuel_type, odometer_km, fuel_liters }
      };
    }

    case "OTHER": {
      const other_category = upper(body.category);
      const description = trim(body.description) || trim(body.remarks);

      if (!OTHER_CATEGORIES.includes(other_category)) {
        return { error: `category must be one of ${OTHER_CATEGORIES.join(", ")}` };
      }
      if (!description) return { error: "Description is required" };

      return {
        expense_date: parseDate(body.expense_date) || todayIST(),
        amount,
        remarks: description,
        details: { other_category }
      };
    }

    default:
      return { error: "Invalid expense type" };
  }
};