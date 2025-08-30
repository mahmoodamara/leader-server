const mongoose = require('mongoose');
require('dotenv').config();

const Barber = require('./models/Barber');
const Service = require('./models/Service');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to DB');
  } catch (err) {
    console.error('❌ DB Connection failed', err.message);
    process.exit(1);
  }
};

const seedData = async () => {
  await connectDB();

  const services = await Service.insertMany([
    { name: 'قص شعر', price: 50 },
    { name: 'تحديد لحية', price: 30 },
    { name: 'تصفيف شعر', price: 40 },
  ]);

const barber = new Barber({
  name: 'جهاد مصطفى',
  photoUrl: 'https://randomuser.me/api/portraits/men/32.jpg',
  serviceIds: services.map(s => s._id),
  rating: 4.8,
  experience: '4 سنوات خبرة',
  city: 'كفركنا',
  startingPrice: 50,
  nextAvailability: 'اليوم 3:00 م',
  isAvailable: true,
  workingHours: {
    Sunday:    [{ from: "12:00", to: "21:00" }],
    Monday:    [{ from: "12:00", to: "21:00" }],
    Tuesday:   [{ from: "12:00", to: "21:00" }],
    Wednesday: [{ from: "12:00", to: "21:00" }],
    Thursday:  [{ from: "12:00", to: "21:00" }],
    Friday:    [{ from: "12:00", to: "21:00" }],
    Saturday:  [{ from: "12:00", to: "21:00" }]
  }
});


  await barber.save();

  console.log('✅ Seed Done');
  process.exit();
};

seedData();
