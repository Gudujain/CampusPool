const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Ride = require('../models/Ride');

let mongod, n = 0;
exports.connect = async () => { mongod = await MongoMemoryServer.create(); await mongoose.connect(mongod.getUri()); await Ride.syncIndexes(); };
exports.reset = async () => { for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({}); };
exports.close = async () => { await mongoose.disconnect(); await mongod.stop(); };

exports.makeUser = async (over = {}) => {
  n++;
  const user = await User.create({ name: `User ${n}`, email: `u${n}@college.test`, phone: String(9000000000 + n), password: 'x', emailVerified: true, ...over });
  return { user, token: jwt.sign({ id: user._id }, process.env.JWT_SECRET) };
};
exports.auth = (t) => ({ Authorization: `Bearer ${t}` });

const place = (label, c) => ({ label, location: { coordinates: c } });
exports.rideBody = (over = {}) => ({
  origin: place('IIIT Pune Campus', [73.7433, 18.7314]), destination: place('Pune Station', [73.8743, 18.5289]),
  departure: new Date(Date.now() + 5 * 3600e3).toISOString(), seats: 3, totalCost: 600, ...over,
});
// insert a ride directly (lets tests create rides in the past or very soon)
exports.insertRide = (driverId, over = {}) => Ride.create({
  driver: driverId, origin: { label: 'IIIT Pune Campus', location: { type: 'Point', coordinates: [73.7433, 18.7314] } },
  destination: { label: 'Pune Station', location: { type: 'Point', coordinates: [73.8743, 18.5289] } },
  departure: new Date(Date.now() + 5 * 3600e3), seats: 3, seatsLeft: 3, totalCost: 600, ...over,
});
