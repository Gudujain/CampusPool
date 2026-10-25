const { z } = require('zod');
const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ message: r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  req.body = r.data; next();
};
const email = z.string().trim().toLowerCase().email().max(100);
const place = z.object({
  label: z.string().trim().min(2).max(60),
  location: z.object({ coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }),
});
const schemas = {
  register: z.object({
    name: z.string().trim().min(2).max(60), email,
    phone: z.string().trim().regex(/^\+?[0-9]{10,13}$/, 'enter a valid phone number'),
    password: z.string().min(8).max(72),
  }),
  login: z.object({ email, password: z.string().min(1).max(72) }),
  otp: z.object({ email, otp: z.string().regex(/^\d{6}$/, 'code must be 6 digits') }),
  emailOnly: z.object({ email }),
  ride: z.object({
    origin: place, destination: place, departure: z.coerce.date(),
    seats: z.number().int().min(1).max(6), totalCost: z.number().int().min(0).max(20000),
  }),
  complete: z.object({ noShows: z.array(z.string()).max(6).default([]) }),
  rate: z.object({ to: z.string(), stars: z.number().int().min(1).max(5) }),
};
module.exports = { validate, schemas };
