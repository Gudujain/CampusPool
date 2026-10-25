class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const assertActive = (u) => {
  if (u.bannedUntil && u.bannedUntil > new Date())
    throw new HttpError(403, `Booking is paused until ${u.bannedUntil.toDateString()} because of repeated late cancellations or no-shows`);
};
module.exports = { HttpError, assertActive };
