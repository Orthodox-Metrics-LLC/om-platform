'use strict';

const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

async function send(message) {
  if (!message.to) {
    return { ok: false, error: 'no_email' };
  }
  try {
    await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || 'noreply@orthodoxmetrics.com',
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message).slice(0, 500) : 'email_failed' };
  }
}

module.exports = { send };
