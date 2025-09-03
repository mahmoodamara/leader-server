// utils/email.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // App Password في Gmail
  },
});

async function sendEmail({ subject, body }) {
  await transporter.sendMail({
    from: `"صالون جهاد" <${process.env.EMAIL_USER}>`,
    to: "mostafajehad8@gmail.com", // ايميل ثابت
    subject,
    text: body,
    html: `<pre>${body}</pre>`,
  });
}

module.exports = { sendEmail };
