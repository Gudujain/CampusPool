const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const otp = require('../utils/otp');
const { sendMail } = require('../utils/mailer');
const { HttpError } = require('../utils/http');
const { validate, schemas } = require('../middleware/validate');
const { authLimiter, otpLimiter } = require('../middleware/limits');

const sign = (u) => ({
  token: jwt.sign({ id: u._id }, process.env.JWT_SECRET, { expiresIn: '7d' }),
  user: { id: u._id, name: u.name, email: u.email },
});

async function issueOtp(user) {
  const code = otp.generate();
  user.otpHash = otp.hash(code, user.email);
  user.otpExpires = new Date(Date.now() + 10 * 60e3);
  user.otpAttempts = 0;
  await user.save();
  await sendMail(user.email, 'Your CampusPool verification code', `Your code is ${code}. It expires in 10 minutes. If this wasn't you, ignore this email.`);
}

router.post('/register', otpLimiter, validate(schemas.register), async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!email.endsWith('@' + process.env.ALLOWED_DOMAIN.toLowerCase())) throw new HttpError(403, `Use your @${process.env.ALLOWED_DOMAIN} email`);
  let user = await User.findOne({ email });
  if (user?.emailVerified) throw new HttpError(409, 'Email already registered');
  const hash = await bcrypt.hash(password, 10);
  if (user) Object.assign(user, { name, phone, password: hash }); else user = new User({ name, email, phone, password: hash });
  await issueOtp(user);
  res.status(201).json({ message: 'We sent a 6-digit code to your college email', email });
});

router.post('/verify-otp', authLimiter, validate(schemas.otp), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !user.otpHash || user.otpExpires < new Date()) throw new HttpError(400, 'Code is invalid or expired. Request a new one.');
  if (user.otpAttempts >= 5) throw new HttpError(429, 'Too many wrong attempts. Request a new code.');
  if (!otp.safeEqual(user.otpHash, otp.hash(req.body.otp, user.email))) {
    await User.updateOne({ _id: user._id }, { $inc: { otpAttempts: 1 } });
    throw new HttpError(400, 'Wrong code');
  }
  user.emailVerified = true; user.otpHash = undefined; user.otpExpires = undefined; user.otpAttempts = 0;
  await user.save();
  res.json(sign(user));
});

router.post('/resend-otp', otpLimiter, validate(schemas.emailOnly), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user && !user.emailVerified) await issueOtp(user);
  res.json({ message: 'If that account needs verification, a new code was sent.' }); // same reply either way
});

router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user || !(await bcrypt.compare(req.body.password, user.password))) throw new HttpError(401, 'Wrong email or password');
  if (!user.emailVerified) {
    await issueOtp(user);
    throw new HttpError(403, 'Verify your email first. We sent you a new code.', { needsVerification: true, email: user.email });
  }
  res.json(sign(user));
});

module.exports = router;
