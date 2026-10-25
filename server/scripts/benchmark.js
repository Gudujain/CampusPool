// Seeds 50k rides in a SEPARATE database, then compares the ride search with and without the index.
// Run:  npm run bench     (needs a local MongoDB; override with BENCH_URI)
const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const URI = process.env.BENCH_URI || 'mongodb://127.0.0.1:27017/campuspool_bench';

(async () => {
  await mongoose.connect(URI);
  await Ride.deleteMany({});
  const N = 50000, now = Date.now(), docs = [];
  for (let i = 0; i < N; i++) {
    const lng = 73.55 + Math.random() * 0.5, lat = 18.45 + Math.random() * 0.4;
    docs.push({ driver: new mongoose.Types.ObjectId(), origin: { label: 'x', location: { type: 'Point', coordinates: [lng, lat] } },
      destination: { label: 'Pune Station', location: { type: 'Point', coordinates: [73.87, 18.52] } },
      departure: new Date(now + Math.random() * 30 * 864e5), seats: 3, seatsLeft: 3, totalCost: 600, passengers: [], ratings: [] });
  }
  await Ride.collection.insertMany(docs);
  await Ride.syncIndexes();
  const c = [73.7433, 18.7314], t = +new Date(now + 5 * 864e5), win = 90 * 60e3;
  const time = { $gte: new Date(t - win), $lte: new Date(t + win) };
  const stat = (e) => { const s = e.executionStats; return { ms: s.executionTimeMillis, docsExamined: s.totalDocsExamined, returned: s.nReturned }; };

  const base = await Ride.find({ seatsLeft: { $gt: 0 }, departure: time, 'origin.location': { $geoWithin: { $centerSphere: [c, 5 / 6378.1] } } }).hint({ $natural: 1 }).explain('executionStats');
  const fast = await Ride.find({ seatsLeft: { $gt: 0 }, departure: time, 'origin.location': { $near: { $geometry: { type: 'Point', coordinates: c }, $maxDistance: 5000 } } }).explain('executionStats');
  console.log(`\nRides: ${N}`);
  console.log('Without index (collection scan):', stat(base));
  console.log('With 2dsphere + departure index :', stat(fast));
  await mongoose.connection.dropDatabase(); await mongoose.disconnect();
})();
