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
  OTP_BRAND = "LEADER",
  OTP_TTL_MINUTES = "5",
  // NEW: SMS mode -> 'otp-only' | 'all' | 'none'
  SMS_MODE = "otp-only",
} = process.env;

// نحتاج بيانات Twilio عندما نتوقع إرسال فعلي
const maySendAnySMS = SMS_MODE === "all" || SMS_MODE === "otp-only";
if (maySendAnySMS && (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN)) {
  throw new Error("Twilio credentials are missing in .env");
}
if (maySendAnySMS && !TWILIO_SMS_FROM && !TWILIO_MESSAGING_SERVICE_SID) {
  console.warn("⚠️ Set TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID in .env");
}

const client =
  maySendAnySMS && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

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

// تحويل الرقم إلى E.164 (IL)
function toE164(phone) {
  let p = normalizeDigits(phone || "").trim().replace(/[\s\-\(\)]/g, "");
  if (!p) throw new Error("Phone is required");
  if (p.startsWith("+")) return p;                    // +9725XXXXXXXX
  if (/^9725\d{8}$/.test(p)) return "+" + p;          // 9725XXXXXXXX
  if (/^0\d{9}$/.test(p)) return "+972" + p.slice(1); // 05XXXXXXXX
  throw new Error("Invalid phone format. Use +9725XXXXXXXX or local 05XXXXXXXX");
}

// Hash OTP
function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// Generate a 6-digit OTP
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

/* ====== NEW: Policy to decide if we actually send SMS ====== */
function shouldSendSMS(routeKey /* 'send-otp' | 'send-confirmation' | ... */) {
  if (SMS_MODE === "all") return true;
  if (SMS_MODE === "none") return false;
  // otp-only
  return routeKey === "send-otp";
}

/* ====== NEW: Unified sender that mocks when disabled ====== */
async function sendSMSUnified(routeKey, { to, body }) {
  const willSend = shouldSendSMS(routeKey);

  const msgOptions = {
    to,
    body,
    validityPeriod: Number(OTP_TTL_MINUTES) * 60,
  };

  if (!willSend) {
    // Mock response – لا ترسل شيء فعليًا
    return {
      sid: `mock_${routeKey}_${Date.now()}`,
      status: "mocked",
      to,
      bodyPreview: body.slice(0, 30),
      mode: SMS_MODE,
    };
  }

  // إرسال فعلي
  if (TWILIO_MESSAGING_SERVICE_SID) {
    msgOptions.messagingServiceSid = TWILIO_MESSAGING_SERVICE_SID;
  } else if (TWILIO_SMS_FROM) {
    msgOptions.from = TWILIO_SMS_FROM;
  } else {
    throw new Error("Please set TWILIO_SMS_FROM or TWILIO_MESSAGING_SERVICE_SID in .env");
  }
  if (TWILIO_STATUS_CALLBACK) msgOptions.statusCallback = TWILIO_STATUS_CALLBACK;

  return client.messages.create(msgOptions);
}

/* ========= Routes ========= */

// إرسال OTP عبر SMS (فعليًا فقط هنا)
router.post("/send-otp", async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone is required" });

    const to = toE164(phone);

    const throttle = canSend(to);
    if (!throttle.ok) return res.status(429).json({ message: throttle.reason });

    const code = generateOTP();
    const expiresAt = Date.now() + Number(OTP_TTL_MINUTES) * 60 * 1000;
const body = `كود التحقق من ${OTP_BRAND}: ${code}\nصالح لمدة ${OTP_TTL_MINUTES} دقائق.\n⚠️ لا تشاركه مع أحد.`;

    const resp = await sendSMSUnified("send-otp", { to, body });

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
      message: shouldSendSMS("send-otp") ? "OTP sent via SMS" : "OTP generated (SMS disabled)",
      sid: resp.sid,
      status: resp.status, // accepted/queued/mocked
      // للتطوير: يمكن إرجاع الكود عند SMS_MODE==='none' فقط لو أردت (احذف إن لا تريد كشفه)
      // devCode: SMS_MODE === 'none' ? code : undefined,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to process send-otp",
      error: error.message,
      code: error.code || undefined,
      moreInfo: error.moreInfo || undefined,
    });
  }
});

// التحقق من الـ OTP (بدون SMS أساسًا)
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

// إرسال رسالة تأكيد الحجز عبر SMS (Mock إلا إذا SMS_MODE='all')
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

    const resp = await sendSMSUnified("send-confirmation", { to, body });

    return res.status(200).json({
      message: shouldSendSMS("send-confirmation")
        ? "تم إرسال رسالة التأكيد عبر SMS"
        : "تمت معالجة التأكيد (SMS معطل في هذا المسار)",
      sid: resp.sid,
      status: resp.status, // mocked عندما يكون الإرسال معطل
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to process confirmation",
      error: error.message,
      code: error.code || undefined,
      moreInfo: error.moreInfo || undefined,
    });
  }
});

/* ===== Debug: جلب حالة رسالة عبر SID (يعمل فقط للمرسلة فعليًا) ===== */
router.get("/status/:sid", async (req, res) => {
  try {
    if (!client) {
      return res.status(400).json({ message: "Twilio client disabled in this SMS_MODE" });
    }
    const m = await client.messages(req.params.sid).fetch();
    res.json({
      sid: m.sid,
      to: m.to,
      from: m.from,
      status: m.status,
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
