const nodemailer = require('nodemailer');
const outbox = []; // used by tests to read OTPs
let tx;
const transport = () => {
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return (tx ||= nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }));
};
async function sendMail(to, subject, text) {
  if (process.env.NODE_ENV === 'test') { outbox.push({ to, subject, text }); return; }
  const t = transport();
  if (!t) { console.log(`\n[DEV MAIL] to=${to}\n${subject}\n${text}\n`); return; }
  try { await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text }); }
  catch (e) { console.error('Mail failed:', e.message); }
}
module.exports = { sendMail, outbox };
