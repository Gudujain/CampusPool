const request = require('supertest');
const { app } = require('../app');
const User = require('../models/User');
const Ride = require('../models/Ride');
const { outbox } = require('../utils/mailer');
const h = require('./helpers');

beforeAll(h.connect); afterAll(h.close); beforeEach(h.reset);
const api = () => request(app);

describe('email OTP verification', () => {
  test('register -> wrong code -> right code -> login', async () => {
    const body = { name: 'Asha Rao', email: 'asha@college.test', phone: '9876543210', password: 'secret123' };
    expect((await api().post('/api/auth/register').send(body)).status).toBe(201);
    const code = outbox.at(-1).text.match(/\d{6}/)[0];
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await api().post('/api/auth/verify-otp').send({ email: body.email, otp: wrong })).status).toBe(400);
    const ok = await api().post('/api/auth/verify-otp').send({ email: body.email, otp: code });
    expect(ok.status).toBe(200); expect(ok.body.token).toBeTruthy();
    expect((await api().post('/api/auth/login').send({ email: body.email, password: body.password })).status).toBe(200);
  });
  test('rejects other email domains and unverified login', async () => {
    const bad = await api().post('/api/auth/register').send({ name: 'Bob', email: 'bob@gmail.com', phone: '9876543210', password: 'secret123' });
    expect(bad.status).toBe(403);
    await api().post('/api/auth/register').send({ name: 'Cy', email: 'cy@college.test', phone: '9876543211', password: 'secret123' });
    const login = await api().post('/api/auth/login').send({ email: 'cy@college.test', password: 'secret123' });
    expect(login.status).toBe(403); expect(login.body.needsVerification).toBe(true);
  });
});

describe('validation and auth', () => {
  test('401 without token, 400 on bad body or id', async () => {
    const { token } = await h.makeUser();
    expect((await api().get('/api/rides')).status).toBe(401);
    expect((await api().post('/api/rides').set(h.auth(token)).send({ seats: 99 })).status).toBe(400);
    expect((await api().post('/api/rides/not-an-id/join').set(h.auth(token))).status).toBe(400);
  });
});

describe('phone privacy + rider visibility', () => {
  test('phones hidden from strangers, passengers visible, phones shown after joining', async () => {
    const d = await h.makeUser(), a = await h.makeUser(), b = await h.makeUser();
    const created = await api().post('/api/rides').set(h.auth(d.token)).send(h.rideBody());
    expect(created.status).toBe(201);
    const id = created.body.id;
    await api().post(`/api/rides/${id}/join`).set(h.auth(a.token)).expect(200);

    const seen = (await api().get('/api/rides').set(h.auth(b.token))).body[0];
    expect(seen.driver.phone).toBeUndefined();
    expect(seen.passengers).toHaveLength(1);
    expect(seen.passengers[0].name).toBe(a.user.name);
    expect(seen.passengers[0].phone).toBeUndefined();

    const mine = (await api().get('/api/rides/mine').set(h.auth(a.token))).body[0];
    expect(mine.driver.phone).toBe(d.user.phone);
  });
});

describe('atomic booking under concurrency', () => {
  test('10 simultaneous joins on a 3-seat ride -> exactly 3 succeed, never oversold', async () => {
    const d = await h.makeUser();
    const ride = await h.insertRide(d.user._id, { seats: 3, seatsLeft: 3 });
    const riders = await Promise.all(Array.from({ length: 10 }, () => h.makeUser()));
    const results = await Promise.all(riders.map((r) => api().post(`/api/rides/${ride._id}/join`).set(h.auth(r.token))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    const after = await Ride.findById(ride._id);
    expect(after.passengers).toHaveLength(3); expect(after.seatsLeft).toBe(0);
  });
  test('same user double-clicking Join books once', async () => {
    const d = await h.makeUser(), p = await h.makeUser();
    const ride = await h.insertRide(d.user._id);
    const rs = await Promise.all([1, 2, 3].map(() => api().post(`/api/rides/${ride._id}/join`).set(h.auth(p.token))));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await Ride.findById(ride._id)).passengers).toHaveLength(1);
  });
  test('driver cannot join own ride; overlapping rides are blocked', async () => {
    const d = await h.makeUser(), p = await h.makeUser();
    const r1 = await h.insertRide(d.user._id), r2 = await h.insertRide(d.user._id);
    expect((await api().post(`/api/rides/${r1._id}/join`).set(h.auth(d.token))).status).toBe(409);
    await api().post(`/api/rides/${r1._id}/join`).set(h.auth(p.token)).expect(200);
    expect((await api().post(`/api/rides/${r2._id}/join`).set(h.auth(p.token))).status).toBe(409);
  });
});

describe('anti-prank rules', () => {
  test('leaving early is free, leaving within 2h is a strike', async () => {
    const d = await h.makeUser(), p = await h.makeUser();
    const early = await h.insertRide(d.user._id);
    await api().post(`/api/rides/${early._id}/join`).set(h.auth(p.token)).expect(200);
    expect((await api().post(`/api/rides/${early._id}/leave`).set(h.auth(p.token))).body.lateCancel).toBe(false);
    expect((await User.findById(p.user._id)).lateCancels).toBe(0);
    expect((await Ride.findById(early._id)).seatsLeft).toBe(3);

    const soon = await h.insertRide(d.user._id, { departure: new Date(Date.now() + 3600e3) });
    await api().post(`/api/rides/${soon._id}/join`).set(h.auth(p.token)).expect(200);
    expect((await api().post(`/api/rides/${soon._id}/leave`).set(h.auth(p.token))).body.lateCancel).toBe(true);
    expect((await User.findById(p.user._id)).lateCancels).toBe(1);
  });
  test('no-show is recorded, repeat offenders get banned from booking', async () => {
    const d = await h.makeUser(), p = await h.makeUser({ noShows: 1 }); // already 2 strike points
    const past = await h.insertRide(d.user._id, { departure: new Date(Date.now() - 3600e3), seats: 3, seatsLeft: 2, passengers: [{ user: p.user._id }] });
    const res = await api().post(`/api/rides/${past._id}/complete`).set(h.auth(d.token)).send({ noShows: [String(p.user._id)] });
    expect(res.status).toBe(200);
    const after = await User.findById(p.user._id);
    expect(after.noShows).toBe(2); expect(after.bannedUntil > new Date()).toBe(true);
    const next = await h.insertRide(d.user._id);
    expect((await api().post(`/api/rides/${next._id}/join`).set(h.auth(p.token))).status).toBe(403);
  });
  test('only the driver can complete, and only once', async () => {
    const d = await h.makeUser(), p = await h.makeUser();
    const past = await h.insertRide(d.user._id, { departure: new Date(Date.now() - 3600e3), seatsLeft: 2, passengers: [{ user: p.user._id }] });
    expect((await api().post(`/api/rides/${past._id}/complete`).set(h.auth(p.token)).send({})).status).toBe(404);
    await api().post(`/api/rides/${past._id}/complete`).set(h.auth(d.token)).send({}).expect(200);
    expect((await api().post(`/api/rides/${past._id}/complete`).set(h.auth(d.token)).send({})).status).toBe(404);
  });
});

describe('ratings', () => {
  test('rode together -> can rate once; strangers cannot', async () => {
    const d = await h.makeUser(), p = await h.makeUser(), s = await h.makeUser();
    const past = await h.insertRide(d.user._id, { departure: new Date(Date.now() - 3600e3), seatsLeft: 2, passengers: [{ user: p.user._id }] });
    await api().post(`/api/rides/${past._id}/complete`).set(h.auth(d.token)).send({}).expect(200);
    await api().post(`/api/rides/${past._id}/rate`).set(h.auth(p.token)).send({ to: String(d.user._id), stars: 5 }).expect(200);
    expect((await api().post(`/api/rides/${past._id}/rate`).set(h.auth(p.token)).send({ to: String(d.user._id), stars: 1 })).status).toBe(409);
    expect((await api().post(`/api/rides/${past._id}/rate`).set(h.auth(s.token)).send({ to: String(d.user._id), stars: 5 })).status).toBe(403);
    const driver = await User.findById(d.user._id);
    expect(driver.ratingSum / driver.ratingCount).toBe(5);
  });
});
