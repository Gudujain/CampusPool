const rateLimit = require('express-rate-limit');
const make = (windowMs, limit) => rateLimit({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { message: 'Too many requests. Please wait a few minutes and try again.' },
});
module.exports = {
  apiLimiter: make(15 * 60e3, 300),   // everything under /api
  authLimiter: make(15 * 60e3, 20),   // login + OTP verification (brute-force guard)
  otpLimiter: make(15 * 60e3, 6),     // anything that sends an email
};
