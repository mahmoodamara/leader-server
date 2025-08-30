const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  barberId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Barber',
    required: true,
  },
  serviceIds: [ // ← مصفوفة من ObjectId
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    }
  ],
  customerName: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    required: true,
    match: /^\+972[0-9]{9}$/, // تنسيق دولي للهاتف
  },
  date: {
    type: String, // "YYYY-MM-DD"
    required: true,
  },
  time: {
    type: String, // "HH:mm"
    required: true,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Booking', BookingSchema);
