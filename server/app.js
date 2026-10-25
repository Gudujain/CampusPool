require('express-async-errors');
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { apiLimiter } = require('./middleware/limits');
const metrics = require('./middleware/metrics');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_URL } });

// Sockets must present a valid JWT. Clients only receive "something changed" pings
// (no ride data), so nothing private can leak through the socket.
io.use((socket, next) => {
  try { socket.userId = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET).id; next(); }
  catch { next(new Error('unauthorized')); }
});
io.on('connection', (s) => { s.join('rides'); s.join('user:' + s.userId); });

app.set('io', io);
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(express.json({ limit: '10kb' }));
app.use(metrics.middleware);
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/metrics', metrics.router);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rides', require('./routes/rides'));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ message: err.message, ...err.extra });
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id' });
  if (err.code === 11000) return res.status(409).json({ message: 'Already exists' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong' });
});

module.exports = { app, server, io };
