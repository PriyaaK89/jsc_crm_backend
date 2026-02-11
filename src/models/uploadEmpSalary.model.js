const db = require("../config/db");

const createSalarySlip = async ({
  emp_id,
  emp_name,
  salary_month,
  salary_slip_url
}) => {

  const query = `
    INSERT INTO employee_salary_slips
    (emp_id, emp_name, salary_month, salary_slip_url)
    VALUES (?, ?, ?, ?)
  `;

  return db.query(query, [
    emp_id,
    emp_name,
    salary_month,
    salary_slip_url
  ]);
};

module.exports = {
  createSalarySlip
};
