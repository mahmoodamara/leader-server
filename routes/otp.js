const express = require("express");
const crypto = require("crypto");
const router = express.Router();

/* ========= الإعدادات العامة ========= */
const {
  OTP_BRAND = "LEADER",
  OTP_TTL_MINUTES = "5",
  SMS_MODE = "none", // none | otp-only | all (كلها mock)
} = process.env;

/* ========= In-Memory Store ========= */
const otpStore = new Map();

/* ========= Helpers ========= */

// تحويل الأرقام العربية/الفارسية إلى لاتينية
function normalizeDigits(s = "") {
  const map = {
    "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
    "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
  };
  return String(s).replace(/[٠-٩۰-۹]/g, (d) => map[d] || d);
}

// تحويل الرقم إلى صيغة +9725XXXXXXXX
function toE164(phone) {
  let p = normalizeDigits(phone || "").trim().replace(/[\s\-\(\)]/g, "");
  if (!p) throw new Error("Phone is required");
  if (p.startsWith("+")) return p;
  if (/^9725\d{8}$/.test(p)) return "+" + p;
  if (/^0\d{9}$/.test(p)) return "+972" + p.slice(1);
  throw new Error("Invalid phone format. Use +9725XXXXXXXX or 05XXXXXXXX");
}

// Hash OTP
function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Simple throttle
function canSend(phone) {
  const now = Date.now();
  const entry = otpStore.get(phone);
  if (!entry) return { ok: true };

  if (entry.lastSentAt && now - entry.lastSentAt < 30 * 1000) {
    const wait = Math.ceil((30 * 1000 - (now - entry.lastSentAt)) / 1000);
    return { ok: false, reason: `Please wait ${wait}s before requesting another OTP.` };
  }

  const hourAgo = now - 60 * 60 * 1000;
  if (!entry.firstAttemptAt || entry.firstAttemptAt < hourAgo) {
    entry.attempts = 0;
    entry.firstAttemptAt = now;
    otpStore.set(phone, entry);
    return { ok: true };
  }
  if ((entry.attempts || 0) >= 5) {
    return { ok: false, reason: "Too many OTP requests in the last hour. Please try later." };
  }
  return { ok: true };
}

/* ========= Mock SMS Sender ========= */
async function sendSMSMock(routeKey, { to, body }) {
  // لن يرسل أي شيء فعليًا، فقط يرجع استجابة وهمية
  console.log(`📨 [MOCK SMS] (${routeKey}) to ${to}: ${body}`);
  return {
    sid: `mock_${routeKey}_${Date.now()}`,
    status: "mocked",
    to,
    preview: body.slice(0, 40),
  };
}

/* ========= Routes ========= */

// إرسال OTP
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone is required" });

    const to = toE164(phone);
    const throttle = canSend(to);
    if (!throttle.ok) return res.status(429).json({ message: throttle.reason });

    const code = generateOTP();
    const expiresAt = Date.now() + Number(OTP_TTL_MINUTES) * 60 * 1000;
    const body = `[${OTP_BRAND}] كودك: ${code}\nصالح ${OTP_TTL_MINUTES} د.\n⚠️ لا تشاركه.`;

    const resp = await sendSMSMock("send-otp", { to, body });

    otpStore.set(to, {
      hash: hashCode(code),
      expiresAt,
      attempts: (otpStore.get(to)?.attempts || 0) + 1,
      firstAttemptAt: otpStore.get(to)?.firstAttemptAt || Date.now(),
      lastSentAt: Date.now(),
    });

    return res.status(200).json({
      message: "OTP generated (mocked SMS)",
      sid: resp.sid,
      status: resp.status,
      devCode: code, // رجعه فقط في البيئة التجريبية
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// التحقق من الـ OTP
router.post("/verify-otp", (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code)
      return res.status(400).json({ message: "Phone and code are required" });

    const to = toE164(phone);
    const entry = otpStore.get(to);
    if (!entry) return res.status(400).json({ message: "No OTP sent to this phone" });
    if (Date.now() > entry.expiresAt)
      return res.status(400).json({ message: "OTP expired, please request a new one" });

    if (hashCode(code) !== entry.hash)
      return res.status(400).json({ message: "Invalid OTP code" });

    otpStore.delete(to);
    return res.status(200).json({ message: "OTP verified successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// إرسال رسالة تأكيد (Mock)
router.post("/send-confirmation", async (req, res) => {
  try {
    const { phone, customerName, barberName, services, date, time } = req.body;
    if (!phone || !barberName || !services || !date || !time)
      return res.status(400).json({ message: "Missing required fields" });

    const to = toE164(phone);
    const body = `✅ تم تأكيد الحجز!
👤 الاسم: ${customerName || "غير محدد"}
✂️ الحلاق: ${barberName}
🧾 الخدمة: ${services}
📅 التاريخ: ${date}
🕒 الساعة: ${time}
📍 ${OTP_BRAND} – شكرًا لحجزك!`;

    const resp = await sendSMSMock("send-confirmation", { to, body });

    return res.status(200).json({
      message: "Confirmation processed (mocked SMS)",
      sid: resp.sid,
      status: resp.status,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
