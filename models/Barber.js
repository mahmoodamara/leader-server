// models/Barber.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const WorkingHourSchema = new Schema({
  from: { type: String, required: true }, // HH:MM
  to: { type: String, required: true },
});

const BarberSchema = new Schema({
  name: { type: String, required: true },
  image: { type: String }, // رابط الصورة للعرض
  photoUrl: { type: String }, // رابط صورة شخصية (بديل/مخصص)
  services: [String], // أسماء الخدمات كنصوص حرة (اختياري)
  serviceIds: [{ type: Schema.Types.ObjectId, ref: 'Service' }], // مراجع للخدمات الحقيقية
  rating: { type: Number, default: 0 },
  experience: { type: String }, // مثال: "10 سنوات"
  city: { type: String },
  startingPrice: { type: Number }, // السعر الابتدائي لأي خدمة
  nextAvailability: { type: String }, // متى متاح الحلاق
  isAvailable: { type: Boolean, default: true },
  workingHours: {
    type: Map,
    of: [WorkingHourSchema], // مثال: { Sunday: [ { from, to }, ... ] }
  },
}, { timestamps: true });

module.exports = mongoose.model('Barber', BarberSchema);
