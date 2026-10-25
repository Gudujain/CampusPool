// Anti-abuse rules in one place so they are easy to explain and to tune.
module.exports = {
  LATE_CANCEL_MS: 2 * 3600e3,   // leaving/cancelling inside this window = late cancel
  CLASH_MS: 2 * 3600e3,         // cannot hold two rides departing within this gap
  MAX_ACTIVE_BOOKINGS: 2,       // upcoming rides one student can hold as a passenger
  MAX_OFFERED: 3,               // upcoming rides one student can offer
  BAN_AT: 3,                    // strike points that trigger a ban
  BAN_DAYS: 7,
  strikes: (u) => (u.lateCancels || 0) + 2 * (u.noShows || 0), // a no-show costs double
};
