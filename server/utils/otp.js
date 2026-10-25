const crypto = require('crypto');
exports.generate = () => String(crypto.randomInt(100000, 1000000));
exports.hash = (otp, email) => crypto.createHash('sha256').update(`${otp}:${email}:${process.env.JWT_SECRET}`).digest('hex');
exports.safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
