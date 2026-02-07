const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

exports.sendUserRegisteredMail = async (email, name) => {
  await transporter.sendMail({
    from: `"HR System" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your account has been created",
    html: `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your employee account has been created successfully.</p>
      <p><strong>Email:</strong> ${email}</p>
      <p>Your password will be created by the Admin shortly.</p>
      <p>You will receive another email once your password is set.</p>
      <br/>
      <p>Regards,<br/>HR Team</p>
    `
  });
};
