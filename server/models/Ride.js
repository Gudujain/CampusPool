const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const place = {
  label: { type: String, required: true },
  location: { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], required: true } }, // [lng, lat]
};

const rideSchema = new mongoose.Schema({
  driver: { type: ObjectId, ref: 'User', required: true },
  origin: place,
  destination: place,
  departure: { type: Date, required: true },
  seats: { type: Number, required: true, min: 1, max: 6 },
  seatsLeft: { type: Number, required: true, min: 0 },   // stored counter => atomic, index-friendly booking
  totalCost: { type: Number, required: true, min: 0 },
  passengers: [{
    _id: false,
    user: { type: ObjectId, ref: 'User' },
    joinedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['booked', 'attended', 'no_show'], default: 'booked' },
  }],
  completedAt: Date,                                      // set once the driver marks attendance
  ratings: [{ _id: false, from: ObjectId, to: ObjectId, stars: Number }],
}, { timestamps: true });

// Compound index: geo filter + time filter are answered from ONE index.
rideSchema.index({ 'origin.location': '2dsphere', departure: 1 });
rideSchema.index({ driver: 1, departure: 1 });
rideSchema.index({ 'passengers.user': 1, departure: 1 });

module.exports = mongoose.model('Ride', rideSchema);
