const express = require("express");
const router = express.Router();
const Booking = require("../models/Booking");
const Barber = require("../models/Barber");
const { sendEmail } = require("../utils/email");
const { generateTimeSlots } = require("../utils/slots");

/* ---------------- Helpers ---------------- */

// تحويل أرقام عربية/فارسية إلى لاتينية
function normalizeDigits(s = '') {
  const map = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  };
  return String(s).replace(/[٠-٩۰-۹]/g, (d) => map[d] || d);
}

// يحول 05XXXXXXXX أو 9725XXXXXXXX إلى +9725XXXXXXXX
function toE164IL(phone) {
  let p = normalizeDigits(phone || '').trim().replace(/[\s\-()]/g, '');
  if (!p) throw new Error('Phone is required');

  if (p.startsWith('+')) return p;
  if (/^9725\d{8}$/.test(p)) return '+' + p;
  if (/^0\d{9}$/.test(p)) return '+972' + p.slice(1);

  throw new Error('Invalid phone format. Use +9725XXXXXXXX or 05XXXXXXXX');
}

/* ---------------- Routes ---------------- */

// 1) إنشاء حجز + إرسال بريد تأكيد
router.post("/", async (req, res) => {
  const { barberId, serviceIds, customerName, phone, date, time } = req.body;

  if (!barberId || !Array.isArray(serviceIds) || serviceIds.length === 0 || !customerName || !phone || !date || !time) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const exists = await Booking.findOne({ barberId, date, time });
    if (exists) return res.status(400).json({ message: "هذا الموعد محجوز بالفعل" });

    const newBooking = await Booking.create({
      barberId,
      serviceIds,
      customerName,
      phone,
      date,
      time,
    });

    const barber = await Barber.findById(barberId);
    const barberName = barber ? barber.name : "غير معروف";
    const phoneE164 = toE164IL(phone);

    const populated = await Booking.populate(newBooking, { path: "serviceIds" });
    const serviceNames = (populated.serviceIds || []).map(s => s.name).join(" + ");

    const messageBody = `📩 حجز جديد:

👤 الاسم: ${customerName}
📞 الهاتف: ${phoneE164}
✂️ الحلاق: ${barberName}
🧾 الخدمة: ${serviceNames}
📅 التاريخ: ${new Date(date).toLocaleDateString("ar-EG")}
🕒 الساعة: ${time}`;

    // إرسال ايميل إلى الايميل الثابت
    await sendEmail({
      subject: "📌 حجز جديد - صالون جهاد",
      body: messageBody,
    });

    res.status(201).json(newBooking);
  } catch (err) {
    console.error("❌ Booking creation or Email error:", err);
    res.status(500).json({ message: "Booking creation failed", error: err.message });
  }
});

// 2) جلب حجوزات مستخدم
function toMs(b) {
  const [y, m, d] = String(b.date).split('-').map(Number);
  const [hh, mm] = String(b.time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

router.get('/', async (req, res) => {
  const { phone, onlyUpcoming = 'false', sort = 'asc' } = req.query;
  if (!phone) return res.status(400).json({ message: 'Phone is required' });

  try {
    const phoneE164 = toE164IL(phone);
    const local = normalizeDigits(phone).trim().replace(/[\s\-()]/g, '');
    const candidates = [phoneE164];

    if (/^0\d{9}$/.test(local)) candidates.push(local);
    if (/^9725\d{8}$/.test(local)) candidates.push('+' + local);

    let bookings = await Booking.find({ phone: { $in: candidates } })
      .populate('barberId', 'name photoUrl')
      .populate('serviceIds', 'name price')
      .sort({
        date: sort === 'desc' ? -1 : 1,
        time: sort === 'desc' ? -1 : 1,
        createdAt: sort === 'desc' ? -1 : 1,
      });

    if (onlyUpcoming === 'true') {
      const now = Date.now();
      bookings = bookings.filter(b => toMs(b) >= now);
    }

    if (!bookings || bookings.length === 0) {
      return res.status(404).json({ message: 'لا توجد حجوزات لهذا الرقم' });
    }

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
});

// 2b) كل الحجوزات (للوحة الإدارة)
router.get('/all', async (_req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('barberId', 'name photoUrl')
      .populate('serviceIds', 'name price');
    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch all bookings', error: err.message });
  }
});

// 3) تعديل حجز
router.put('/:id', async (req, res) => {
  const { date, time } = req.body;

  try {
    const booking = await Booking.findById(req.params.id).populate('serviceIds');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const conflict = await Booking.findOne({
      barberId: booking.barberId,
      date,
      time,
      _id: { $ne: req.params.id },
    });
    if (conflict) return res.status(400).json({ message: 'هذا الموعد محجوز' });

    booking.date = date;
    booking.time = time;
    await booking.save();

    res.json({ message: 'تم تعديل الحجز بنجاح', booking });
  } catch (err) {
    console.error('❌ Error in update:', err);
    res.status(500).json({ message: 'Booking update failed', error: err.message });
  }
});

// 4) حذف حجز
router.delete('/:id', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('serviceIds');
    if (!booking) return res.status(404).json({ message: 'لم يتم العثور على الحجز' });

    await booking.deleteOne();
    res.json({ message: 'تم حذف الحجز بنجاح' });
  } catch (err) {
    console.error('❌ خطأ أثناء الحذف:', err);
    res.status(500).json({ message: 'فشل في حذف الحجز', error: err.message });
  }
});

// 5) المواعيد المتاحة
router.get('/:id/available-slots', async (req, res) => {
  const { day } = req.query;
  if (!day) return res.status(400).json({ message: 'Day query parameter is required' });

  try {
    const barber = await Barber.findById(req.params.id);
    if (!barber) return res.status(404).json({ message: 'Barber not found' });

    let intervals = [];
    if (barber.workingHours instanceof Map) {
      intervals = barber.workingHours.get(day);
    } else {
      intervals = barber.workingHours?.[day];
    }

    if (!Array.isArray(intervals) || intervals.length === 0) {
      return res.status(200).json({ slots: [] });
    }

    const availableSlots = generateTimeSlots(intervals);
    res.status(200).json({ slots: availableSlots });
  } catch (err) {
    res.status(500).json({ message: 'Failed to generate slots', error: err.message });
  }
});

// 6) حجوزات حلاق بتاريخ معيّن
router.get('/barber/:barberId', async (req, res) => {
  const { barberId } = req.params;
  const { date } = req.query;

  if (!date) return res.status(400).json({ message: 'Missing date query parameter' });

  try {
    const bookings = await Booking.find({
      barberId,
      date: { $regex: `^${date}` },
    }).populate('serviceIds', 'name price');

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
});

module.exports = router;
