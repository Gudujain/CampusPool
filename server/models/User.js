const mongoose = require('mongoose');
module.exports = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  otpHash: String, otpExpires: Date, otpAttempts: { type: Number, default: 0 },
  // reputation (shown to other students before they book)
  ridesCompleted: { type: Number, default: 0 },
  noShows: { type: Number, default: 0 },
  lateCancels: { type: Number, default: 0 },
  ratingSum: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },
  bannedUntil: Date,
}, { timestamps: true }));
