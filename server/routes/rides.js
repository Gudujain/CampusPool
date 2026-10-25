const router = require('express').Router();
const mongoose = require('mongoose');
const Ride = require('../models/Ride');
const User = require('../models/User');
const auth = require('../middleware/auth');
const metrics = require('../middleware/metrics');
const P = require('../utils/policy');
const { validate, schemas } = require('../middleware/validate');
const { HttpError, assertActive } = require('../utils/http');
const { populateRide, serializeRide } = require('../utils/serialize');
const { sendMail } = require('../utils/mailer');

const changed = (req, id) => req.app.get('io').to('rides').emit('rides:changed', { rideId: String(id) });
const view = async (id, viewer) => serializeRide(await populateRide(Ride.findById(id).lean()), viewer);
const hhmm = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const num = (v, d, lo, hi) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

async function penalize(userId, field) {
  const u = await User.findByIdAndUpdate(userId, { $inc: { [field]: 1 } }, { new: true });
  if (P.strikes(u) >= P.BAN_AT && !(u.bannedUntil > new Date()))
    await User.updateOne({ _id: u._id }, { bannedUntil: new Date(Date.now() + P.BAN_DAYS * 864e5) });
}

router.param('id', (req, res, next, id) => mongoose.isValidObjectId(id) ? next() : res.status(400).json({ message: 'Invalid ride id' }));

// ---- Offer a ride
router.post('/', auth, validate(schemas.ride), async (req, res) => {
  assertActive(req.user);
  const { origin, destination, departure, seats, totalCost } = req.body;
  if (origin.label === destination.label) throw new HttpError(400, 'Start and end must be different');
  if (+departure < Date.now() + 15 * 60e3) throw new HttpError(400, 'Departure must be at least 15 minutes from now');
  if (+departure > Date.now() + 30 * 864e5) throw new HttpError(400, 'Departure must be within the next 30 days');
  const open = await Ride.countDocuments({ driver: req.userId, departure: { $gt: new Date() }, completedAt: null });
  if (open >= P.MAX_OFFERED) throw new HttpError(400, `You can have at most ${P.MAX_OFFERED} upcoming rides`);
  const pt = (p) => ({ label: p.label, location: { type: 'Point', coordinates: p.location.coordinates } });
  const ride = await Ride.create({ driver: req.userId, origin: pt(origin), destination: pt(destination), departure, seats, seatsLeft: seats, totalCost });
  changed(req, ride._id);
  res.status(201).json(await view(ride._id, req.userId));
});

// ---- Search: nearest pickup first, inside a time window, with a free seat
router.get('/', auth, async (req, res) => {
  const { dest, time, lng, lat } = req.query;
  const radius = num(req.query.radius, 5, 1, 50), window = num(req.query.window, 90, 15, 360);
  const q = { seatsLeft: { $gt: 0 }, completedAt: null };
  const t = time ? new Date(time) : null;
  q.departure = t && !isNaN(t)
    ? { $gte: new Date(Math.max(+t - window * 60e3, Date.now())), $lte: new Date(+t + window * 60e3) }
    : { $gt: new Date() };
  if (typeof dest === 'string' && dest) q['destination.label'] = dest;
  const lo = num(lng, null, -180, 180), la = num(lat, null, -90, 90);
  if (lo !== null && la !== null) q['origin.location'] = { $near: { $geometry: { type: 'Point', coordinates: [lo, la] }, $maxDistance: radius * 1000 } };
  const rides = await populateRide(Ride.find(q).limit(50).lean());
  res.json(rides.map((r) => serializeRide(r, req.userId)));
});

router.get('/mine', auth, async (req, res) => {
  const rides = await populateRide(Ride.find({ $or: [{ driver: req.userId }, { 'passengers.user': req.userId }] }).sort('-departure').limit(50).lean());
  res.json(rides.map((r) => serializeRide(r, req.userId)));
});

// ---- Join: rule checks, then ONE atomic update that also guards the last seat
router.post('/:id/join', auth, async (req, res) => {
  metrics.count('join.attempt');
  const me = req.userId;
  try {
    assertActive(req.user);
    const ride = await Ride.findById(req.params.id).select('departure');
    if (!ride) throw new HttpError(404, 'Ride not found');
    if (ride.departure <= new Date()) throw new HttpError(409, 'This ride has already left');
    const clash = await Ride.exists({
      _id: { $ne: ride._id }, completedAt: null, $or: [{ driver: me }, { 'passengers.user': me }],
      departure: { $gt: new Date(+ride.departure - P.CLASH_MS), $lt: new Date(+ride.departure + P.CLASH_MS) },
    });
    if (clash) throw new HttpError(409, 'You already have a ride around this time');
    const active = await Ride.countDocuments({ 'passengers.user': me, departure: { $gt: new Date() }, completedAt: null });
    if (active >= P.MAX_ACTIVE_BOOKINGS) throw new HttpError(409, `You can hold at most ${P.MAX_ACTIVE_BOOKINGS} upcoming bookings`);

    const updated = await Ride.findOneAndUpdate(
      { _id: ride._id, driver: { $ne: me }, 'passengers.user': { $ne: me }, departure: { $gt: new Date() }, seatsLeft: { $gt: 0 } },
      { $inc: { seatsLeft: -1 }, $push: { passengers: { user: me } } }, { new: true }
    );
    if (!updated) throw new HttpError(409, 'Ride is full, already joined, or has left');
    metrics.count('join.success');
    changed(req, updated._id);
    User.findById(updated.driver).select('email').then((d) => d && sendMail(d.email, 'New passenger on your ride', `${req.user.name} joined your ride to ${updated.destination.label} (${hhmm(updated.departure)}). Seats left: ${updated.seatsLeft}.`));
    res.json(await view(updated._id, me));
  } catch (e) { metrics.count('join.rejected'); throw e; }
});

// ---- Leave: free if early, a strike if within 2h of departure
router.post('/:id/leave', auth, async (req, res) => {
  const me = req.userId;
  const ride = await Ride.findOne({ _id: req.params.id, 'passengers.user': me, completedAt: null });
  if (!ride) throw new HttpError(404, 'You are not on this ride');
  if (ride.departure <= new Date()) throw new HttpError(409, 'This ride has already left');
  const late = +ride.departure - Date.now() < P.LATE_CANCEL_MS;
  const updated = await Ride.findOneAndUpdate({ _id: ride._id, 'passengers.user': me }, { $pull: { passengers: { user: me } }, $inc: { seatsLeft: 1 } }, { new: true });
  if (!updated) throw new HttpError(404, 'You are not on this ride');
  if (late) await penalize(me, 'lateCancels');
  changed(req, ride._id);
  User.findById(ride.driver).select('email').then((d) => d && sendMail(d.email, 'A passenger left your ride', `${req.user.name} left your ride to ${ride.destination.label} (${hhmm(ride.departure)}).`));
  res.json({ ok: true, lateCancel: late });
});

// ---- Driver cancels (strike only if people had booked and it is late)
router.delete('/:id', auth, async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, driver: req.userId, completedAt: null }).populate('passengers.user', 'email');
  if (!ride) throw new HttpError(404, 'Only the driver can cancel an open ride');
  if (ride.departure <= new Date()) throw new HttpError(409, 'This ride has left. Mark attendance instead.');
  if (ride.passengers.length && +ride.departure - Date.now() < P.LATE_CANCEL_MS) await penalize(req.userId, 'lateCancels');
  await Ride.deleteOne({ _id: ride._id });
  changed(req, ride._id);
  ride.passengers.forEach((p) => p.user && sendMail(p.user.email, 'Your ride was cancelled', `The ride to ${ride.destination.label} (${hhmm(ride.departure)}) was cancelled by the driver.`));
  res.json({ ok: true });
});

// ---- Driver removes a suspicious passenger before departure (no penalty for the passenger)
router.delete('/:id/passengers/:userId', auth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new HttpError(400, 'Invalid user id');
  const ride = await Ride.findOneAndUpdate(
    { _id: req.params.id, driver: req.userId, completedAt: null, departure: { $gt: new Date() }, 'passengers.user': req.params.userId },
    { $pull: { passengers: { user: req.params.userId } }, $inc: { seatsLeft: 1 } }, { new: true });
  if (!ride) throw new HttpError(404, 'Passenger not found on your upcoming ride');
  changed(req, ride._id);
  User.findById(req.params.userId).select('email').then((u) => u && sendMail(u.email, 'You were removed from a ride', `The driver removed you from the ride to ${ride.destination.label} (${hhmm(ride.departure)}).`));
  res.json({ ok: true });
});

// ---- After departure the driver confirms who actually showed up (this is what builds reputation)
router.post('/:id/complete', auth, validate(schemas.complete), async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, driver: req.userId, completedAt: null });
  if (!ride) throw new HttpError(404, 'Ride not found or already completed');
  if (ride.departure > new Date()) throw new HttpError(409, 'The ride has not departed yet');
  const absent = new Set(req.body.noShows);
  const passengers = ride.passengers.map((p) => ({ user: p.user, joinedAt: p.joinedAt, status: absent.has(String(p.user)) ? 'no_show' : 'attended' }));
  const claimed = await Ride.findOneAndUpdate({ _id: ride._id, completedAt: null }, { completedAt: new Date(), passengers }); // claim once, even under double-clicks
  if (!claimed) throw new HttpError(409, 'Already completed');
  const attended = passengers.filter((p) => p.status === 'attended');
  for (const p of passengers) {
    if (p.status === 'attended') await User.updateOne({ _id: p.user }, { $inc: { ridesCompleted: 1 } });
    else await penalize(p.user, 'noShows');
  }
  if (attended.length) await User.updateOne({ _id: req.userId }, { $inc: { ridesCompleted: 1 } }); // empty rides earn nothing
  changed(req, ride._id);
  res.json(await view(ride._id, req.userId));
});

// ---- Rate someone you actually rode with (one rating per pair per ride)
router.post('/:id/rate', auth, validate(schemas.rate), async (req, res) => {
  const { to, stars } = req.body, me = req.userId;
  if (!mongoose.isValidObjectId(to)) throw new HttpError(400, 'Invalid user id');
  const ride = await Ride.findOne({ _id: req.params.id, completedAt: { $ne: null } });
  if (!ride) throw new HttpError(404, 'Ride not found or not completed yet');
  const rode = (id) => String(ride.driver) === id ? ride.passengers.some((p) => p.status === 'attended') : ride.passengers.some((p) => String(p.user) === id && p.status === 'attended');
  if (me === to || !rode(me) || !rode(to)) throw new HttpError(403, 'Only people who rode together can rate each other');
  const done = await Ride.findOneAndUpdate({ _id: ride._id, ratings: { $not: { $elemMatch: { from: me, to } } } }, { $push: { ratings: { from: me, to, stars } } });
  if (!done) throw new HttpError(409, 'You already rated this person for this ride');
  await User.updateOne({ _id: to }, { $inc: { ratingSum: stars, ratingCount: 1 } });
  res.json({ ok: true });
});

module.exports = router;
