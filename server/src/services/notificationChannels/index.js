'use strict';

const emailChannel = require('./emailChannel');
const smsChannel = require('./smsChannel');
const inAppChannel = require('./inAppChannel');
const pushChannel = require('./pushChannel');

const HANDLERS = Object.freeze({
  in_app: inAppChannel.send,
  email: emailChannel.send,
  sms: smsChannel.send,
  push: pushChannel.send,
});

function knownChannels() {
  return Object.keys(HANDLERS);
}

async function deliver(channel, message) {
  const handler = HANDLERS[channel];
  if (!handler) {
    return { ok: false, error: 'unknown_channel' };
  }
  return handler(message);
}

module.exports = { deliver, knownChannels };
