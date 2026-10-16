'use strict';

const twilio = require('./sms/twilioAdapter');

function health() {
  return twilio.health(process.env);
}

async function send(message) {
  return twilio.send(message, process.env);
}

module.exports = { send, health };
