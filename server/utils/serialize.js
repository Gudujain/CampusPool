// The ONLY place ride data is shaped for the client. Phone numbers are added here,
// and only when the viewer is the driver or one of the booked passengers.
const SEL = 'name phone emailVerified ridesCompleted noShows lateCancels ratingSum ratingCount';

const profile = (u) => ({
  id: String(u._id), name: u.name, verified: !!u.emailVerified,
  ridesCompleted: u.ridesCompleted || 0, noShows: u.noShows || 0, lateCancels: u.lateCancels || 0,
  rating: u.ratingCount ? +(u.ratingSum / u.ratingCount).toFixed(1) : null, ratingCount: u.ratingCount || 0,
});

const populateRide = (q) => q.populate('driver', SEL).populate('passengers.user', SEL);

function serializeRide(r, viewerId) {
  const me = String(viewerId);
  const ps = r.passengers.filter((p) => p.user);
  const isDriver = String(r.driver._id) === me;
  const mine = ps.find((p) => String(p.user._id) === me);
  const member = isDriver || !!mine;
  const person = (u) => ({ ...profile(u), ...(member ? { phone: u.phone } : {}) });
  const done = !!r.completedAt;

  // who the viewer can still rate (only after the ride is marked complete)
  let rateable = [];
  if (done && member) {
    const attended = ps.filter((p) => p.status === 'attended');
    const iRode = isDriver ? attended.length > 0 : mine.status === 'attended';
    const others = [{ id: String(r.driver._id), name: r.driver.name }, ...attended.map((p) => ({ id: String(p.user._id), name: p.user.name }))];
    rateable = iRode ? others.filter((o) => o.id !== me && !r.ratings.some((x) => String(x.from) === me && String(x.to) === o.id)) : [];
  }
  return {
    id: String(r._id),
    origin: r.origin.label, destination: r.destination.label,
    departure: r.departure, seats: r.seats, seatsLeft: r.seatsLeft, totalCost: r.totalCost,
    perHead: Math.ceil(r.totalCost / (ps.length + 1)),
    completed: done, isDriver, isPassenger: !!mine,
    canComplete: isDriver && !done && new Date(r.departure) < new Date(),
    driver: person(r.driver),
    passengers: ps.map((p) => ({ ...person(p.user), status: p.status })),
    rateable,
  };
}
module.exports = { SEL, profile, populateRide, serializeRide };
