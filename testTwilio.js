require("dotenv").config();
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

(async () => {
  try {
    const acc = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log("✅ Auth OK. Account:", acc.friendlyName);
  } catch (err) {
    console.error("❌ Auth failed:", err.status, err.code, err.message);
  }
})();
