// Tiny in-memory metrics: per-route latency percentiles + booking counters.
const router = require('express').Router();
const lat = new Map(); const counters = {};
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];

exports.count = (k) => { counters[k] = (counters[k] || 0) + 1; };
exports.middleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const key = `${req.method} ${req.route ? req.baseUrl + req.route.path : 'unmatched'}`;
    const a = lat.get(key) || []; a.push(ms); if (a.length > 2000) a.shift(); lat.set(key, a);
  });
  next();
};
router.get('/', (req, res) => {
  if (process.env.NODE_ENV === 'production' && req.headers['x-metrics-key'] !== process.env.METRICS_KEY)
    return res.status(403).json({ message: 'Forbidden' });
  const routes = {};
  for (const [k, a] of lat) { const s = [...a].sort((x, y) => x - y); routes[k] = { count: s.length, p50: +pct(s, .5).toFixed(1), p95: +pct(s, .95).toFixed(1), p99: +pct(s, .99).toFixed(1) }; }
  const att = counters['join.attempt'] || 0, ok = counters['join.success'] || 0;
  res.json({ uptimeSec: Math.round(process.uptime()), routes, bookings: { attempts: att, success: ok, rejected: counters['join.rejected'] || 0, successRate: att ? +(ok / att).toFixed(3) : null } });
});
exports.router = router;
