const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const mongoose = require('mongoose');
if (!process.env.JWT_SECRET) { console.error('JWT_SECRET is missing in .env'); process.exit(1); }
const { server } = require('./app');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  await require('./models/Ride').syncIndexes();
  const port = process.env.PORT || 5000;
  server.listen(port, () => console.log(`API running on :${port}`));
}).catch((e) => { console.error('Mongo connection failed:', e.message); process.exit(1); });
