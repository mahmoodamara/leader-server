const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const twilio = require("twilio");

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_SMS_FROM,
  TWILIO_MESSAGING_SERVICE_SID,
  TWILIO_STATUS_CALLBACK,
  OTP_BRAND = "Salon Jihad",
  OTP_TTL_MINUTES = "5",
} = process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
  throw new Error("Twilio credentials are missing in .env");
}
if (!TWILIO_SMS_FROM && !TWILIO_MESSAGING_SERVICE_SID) {
  console.warn("⚠️ Set TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID in .env");
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/* ========= In-Memory Store =========
   phone -> { hash, expiresAt, attempts, firstAttemptAt, lastSentAt }
   ملاحظة: استبدل هذا بمخزن دائم (Redis مثلاً) في الإنتاج.
==================================== */
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

// تحويل الرقم إلى E.164 (IL)
// يدعم: +9725XXXXXXXX | 05XXXXXXXX | 9725XXXXXXXX
function toE164(phone) {
  let p = normalizeDigits(phone || "").trim().replace(/[\s\-\(\)]/g, "");
  if (!p) throw new Error("Phone is required");

  if (p.startsWith("+")) return p;                    // +9725XXXXXXXX
  if (/^9725\d{8}$/.test(p)) return "+" + p;          // 9725XXXXXXXX
  if (/^0\d{9}$/.test(p)) return "+972" + p.slice(1); // 05XXXXXXXX

  throw new Error("Invalid phone format. Use +9725XXXXXXXX or local 05XXXXXXXX");
}

// Hash OTP (avoid storing in plain text)
function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Simple throttle (per phone): min interval 30s between sends, max 5 attempts/hour
function canSend(phone) {
  const now = Date.now();
  const entry = otpStore.get(phone);
  if (!entry) return { ok: true };

  if (entry.lastSentAt && now - entry.lastSentAt < 30 * 1000) {
    const wait = Math.ceil((30 * 1000 - (now - entry.lastSentAt)) / 1000);
    return { ok: false, reason: `Please wait ${wait}s before requesting another OTP.` };
  }

  const hourAgo = now - 60 * 60 * 1000;
  // إذا انتهت نافذة الساعة، صفّر العداد
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

async function sendSMS({ to, body }) {
  const msgOptions = {
    to,
    body,
    validityPeriod: Number(OTP_TTL_MINUTES) * 60, // يسقط بعد مدة الـ OTP
  };

  if (TWILIO_MESSAGING_SERVICE_SID) {
    msgOptions.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
  } else if (TWILIO_SMS_FROM) {
    msgOptions.from = TWILIO_SMS_FROM;
  } else {
    throw new Error("Please set TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID in .env");
  }

  if (TWILIO_STATUS_CALLBACK) {
    msgOptions.statusCallback = TWILIO_STATUS_CALLBACK;
  }

  return client.messages.create(msgOptions);
}

/* ========= Routes ========= */

// إرسال OTP عبر SMS
router.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone is required" });

    const to = toE164(phone);

    const throttle = canSend(to);
    if (!throttle.ok) return res.status(429).json({ message: throttle.reason });

    const code = generateOTP();
    const expiresAt = Date.now() + Number(OTP_TTL_MINUTES) * 60 * 1000;
    const body = `[${OTP_BRAND}] كود التحقق: ${code}. صالح ${OTP_TTL_MINUTES} دقائق. لا تشاركه مع أحد.`;

    const resp = await sendSMS({ to, body });

    const prev = otpStore.get(to) || {};
    const now = Date.now();
    otpStore.set(to, {
      hash: hashCode(code),
      expiresAt,
      attempts: (prev.attempts || 0) + 1,
      firstAttemptAt: prev.firstAttemptAt || now,
      lastSentAt: now,
    });

    return res.status(200).json({
      message: "OTP sent via SMS",
      sid: resp.sid,
      status: resp.status, // accepted/queued...
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to send OTP via SMS",
      error: error.message,
      code: error.code || undefined,
      moreInfo: error.moreInfo || undefined,
    });
  }
});

// التحقق من الـ OTP
router.post("/verify-otp", (req, res) => {
  try {
    let { phone, code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ message: "Phone and code are required" });
    }

    const to = toE164(phone);
    const entry = otpStore.get(to);
    if (!entry) {
      return res.status(400).json({ message: "No OTP sent to this phone" });
    }

    if (Date.now() > entry.expiresAt) {
      otpStore.delete(to);
      return res.status(400).json({ message: "OTP expired, please request a new one" });
    }

    if (hashCode(code) !== entry.hash) {
      return res.status(400).json({ message: "Invalid OTP code" });
    }

    otpStore.delete(to);
    return res.status(200).json({ message: "OTP verified successfully" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

// إرسال رسالة تأكيد الحجز عبر SMS
router.post("/send-confirmation", async (req, res) => {
  try {
    let { phone, customerName, barberName, services, date, time } = req.body;

    if (!phone || !barberName || !services || !date || !time) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const to = toE164(phone);
    const body = `✅ تم تأكيد الحجز!
👤 الاسم: ${customerName || "غير محدد"}
✂️ الحلاق: ${barberName}
🧾 الخدمة: ${services}
📅 التاريخ: ${date}
🕒 الساعة: ${time}
📍 ${OTP_BRAND} – شكرًا لحجزك!`;

    const resp = await sendSMS({ to, body });

    return res.status(200).json({
      message: "تم إرسال رسالة التأكيد عبر SMS",
      sid: resp.sid,
      status: resp.status,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to send confirmation SMS",
      error: error.message,
      code: error.code || undefined,
      moreInfo: error.moreInfo || undefined,
    });
  }
});

/* ===== Debug: جلب حالة رسالة عبر SID ===== */
router.get("/status/:sid", async (req, res) => {
  try {
    const m = await client.messages(req.params.sid).fetch();
    res.json({
      sid: m.sid,
      to: m.to,
      from: m.from,
      status: m.status,        // queued/sending/sent/delivered/undelivered/failed
      errorCode: m.errorCode,
      errorMessage: m.errorMessage,
      dateCreated: m.dateCreated,
      dateSent: m.dateSent,
      dateUpdated: m.dateUpdated,
    });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message, code: e.code, moreInfo: e.moreInfo });
  }
});

module.exports = router;
