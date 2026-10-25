const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { HttpError } = require('../utils/http');

module.exports = async (req, res, next) => {
  let id;
  try { id = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET).id; }
  catch { throw new HttpError(401, 'Please log in again'); }
  const user = await User.findById(id);
  if (!user) throw new HttpError(401, 'Please log in again');
  if (!user.emailVerified) throw new HttpError(403, 'Verify your college email first');
  req.user = user; req.userId = String(user._id);
  next();
};
