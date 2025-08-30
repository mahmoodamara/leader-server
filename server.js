require("dotenv").config();
const express = require("express");
const cors = require("cors");
const os = require("os");

const connectDB = require("./db");
connectDB();

// Routes
const otpRoutes = require("./routes/otp");
const barberRoutes = require("./routes/barbers");
const bookingRoutes = require("./routes/bookings");
const serviceRoutes = require("./routes/services");

const app = express();

/* ---------- Middlewares ---------- */
app.use(express.json());

// افتح مؤقتًا لجميع المصادر أثناء التطوير.
// لاحقًا خصّص origin إلى نطاقاتك فقط.
app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ---------- Healthcheck ---------- */
app.get("/health", (_req, res) => res.status(200).send("OK"));

/* ---------- API Routes ---------- */
app.use("/api", otpRoutes); // /api/send-otp, /api/verify-otp
app.use("/api/barbers", barberRoutes); // /api/barbers
app.use("/api/bookings", bookingRoutes); // /api/bookings
app.use("/api/services", serviceRoutes); // /api/services

/* ---------- Error Handler (basic) ---------- */
app.use((err, _req, res, _next) => {
  console.error("❌ Error:", err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

/* ---------- Server Start ---------- */
const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";

// احصل على IPv4 المحلي للوج فقط (يساعدك بضبط الواجهة)
function getLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

const twilio = require("twilio");
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

(async () => {
  const list = await client.messaging.v1
    .services("MG9219b4ea2617744814a75aa180ccdca9")
    .phoneNumbers.list({ limit: 50 });
  const hasNumber = list.some((n) => n.phoneNumber === "+972533624275");
  console.log("In Sender Pool?", hasNumber);
})();

app.listen(PORT, HOST, () => {
  const lan = getLanIP();
  console.log("✅ Server is up");
  console.log(`   Local:   http://localhost:${PORT}`);
  if (lan)
    console.log(`   LAN:     http://${lan}:${PORT}   (Expo on real Android)`);
  console.log(`   Emulator Android: http://10.0.2.2:${PORT}`);
  console.log(`   Health:  /health`);
});
