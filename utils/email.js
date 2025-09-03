const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail", 
  auth: {
    user: process.env.EMAIL_USER, // بريدك المرسل
    pass: process.env.EMAIL_PASS, // App Password من Gmail
  },
});

export async function sendEmail({ subject, body }) {
  await transporter.sendMail({
    from: `"صالون جهاد" <${process.env.EMAIL_USER}>`,
    to: "leaderbarbershop66@gmail.com", // 📌 ايميل ثابت
    subject,
    text: body,
    html: `<pre>${body}</pre>`,
  });
}
module.exports = { sendEmail };
