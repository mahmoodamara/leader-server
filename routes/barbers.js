const express = require('express');
const router = express.Router();
const Barber = require('../models/Barber');
const Booking = require('../models/Booking');
const {generateTimeSlots} = require('../utils/slots');

// ✅ Get all barbers
router.get('/', async (req, res) => {
  try {
    const barbers = await Barber.find().populate('serviceIds');
    res.json(barbers);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch barbers', error: err.message });
  }
});

// ✅ Get barber by ID
router.get('/:id', async (req, res) => {
  try {
    const barber = await Barber.findById(req.params.id).populate('serviceIds');
    if (!barber) return res.status(404).json({ message: 'Barber not found' });
    res.json(barber);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch barber', error: err.message });
  }
});

// ✅ Create new barber
router.post('/', async (req, res) => {
  try {
    const newBarber = new Barber(req.body);
    const saved = await newBarber.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: 'Failed to create barber', error: err.message });
  }
});

// ✅ Update barber
router.put('/:id', async (req, res) => {
  try {
    const updated = await Barber.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: 'Barber not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: 'Failed to update barber', error: err.message });
  }
});

// ✅ Delete barber
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Barber.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Barber not found' });
    res.json({ message: 'Barber deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete barber', error: err.message });
  }
});


// ✅ Update working hours for a specific day
router.put('/:id/working-hours', async (req, res) => {
  const { day, intervals } = req.body;
  // مثال: { day: "Sunday", intervals: [ { from: "10:00", to: "14:00" }, { from: "16:00", to: "20:00" } ] }

  if (!day || !Array.isArray(intervals)) {
    return res.status(400).json({ message: 'Day and intervals are required' });
  }

  try {
    const barber = await Barber.findById(req.params.id);
    if (!barber) {
      return res.status(404).json({ message: 'Barber not found' });
    }

    // ✅ تحقق من صيغة الساعات
    for (const interval of intervals) {
      if (!/^\d{2}:\d{2}$/.test(interval.from) || !/^\d{2}:\d{2}$/.test(interval.to)) {
        return res.status(400).json({ message: 'Invalid time format, must be HH:MM' });
      }
    }

    // ✅ تحديث ساعات اليوم المطلوب
    barber.workingHours.set(day, intervals);

    await barber.save();
    res.json({
      message: `Working hours updated for ${day}`,
      workingHours: { [day]: barber.workingHours.get(day) }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to update working hours', error: err.message });
  }
});


router.get('/:id/available-slots', async (req, res) => {
    const { day } = req.query;
  
    if (!day) {
      return res.status(400).json({ message: 'Day query parameter is required' });
    }
  
    try {
      const barber = await Barber.findById(req.params.id);
      if (!barber) {
        return res.status(404).json({ message: 'Barber not found' });
      }
  
      const intervals = barber.workingHours.get(day); // ✅ Map accessor
  
      if (!Array.isArray(intervals) || intervals.length === 0) {
        return res.status(200).json({ slots: [] });
      }
  
      const allSlots = generateTimeSlots(intervals);
      res.status(200).json({ slots: allSlots });
    } catch (err) {
      res.status(500).json({ message: 'Failed to generate slots', error: err.message });
    }
  });

  router.get('/:barberId/working-days', async (req, res) => {
    const { barberId } = req.params;
  
    try {
      const barber = await Barber.findById(barberId);
      if (!barber) {
        return res.status(404).json({ message: 'Barber not found' });
      }
  
      const workingDays = Array.from(barber.workingHours?.keys() || []);
  
      res.json({ workingDays });
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch working days', error: err.message });
    }
  });
  

module.exports = router;
