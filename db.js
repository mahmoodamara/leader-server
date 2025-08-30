const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // اتصال بـ MongoDB
    await mongoose.connect(process.env.MONGO_URI);

    console.log("✅ MongoDB connected");

    // أحداث مساعدة لمراقبة الاتصال
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected");
    });

    // إغلاق الاتصال عند إيقاف السيرفر
    process.on("SIGINT", async () => {
      await mongoose.connection.close();
      console.log("🔌 MongoDB connection closed due to app termination");
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ DB connection failed:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
