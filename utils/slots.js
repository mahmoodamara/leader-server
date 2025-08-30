// utils/slotsGenerator.js
function generateTimeSlots(intervals, slotDuration = 30) {
    const slots = [];
  
    intervals.forEach(interval => {
      const [startHour, startMinute] = interval.from.split(':').map(Number);
      const [endHour, endMinute] = interval.to.split(':').map(Number);
  
      let start = new Date();
      start.setHours(startHour, startMinute, 0, 0);
  
      let end = new Date();
      end.setHours(endHour, endMinute, 0, 0);
  
      while (start < end) {
        const slot = start.toTimeString().slice(0, 5); // HH:MM format
        slots.push(slot);
  
        start = new Date(start.getTime() + slotDuration * 60000); // add slot duration
      }
    });
  
    return slots;
  }
  
  module.exports = { generateTimeSlots };
  