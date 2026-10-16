'use strict';

async function send() {
  return { ok: false, error: 'push_transport_unconfigured' };
}

module.exports = { send };
