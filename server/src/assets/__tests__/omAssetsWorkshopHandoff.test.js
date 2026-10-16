/**
 * Lightweight unit checks for workshop handoff helpers (no live Workshop required).
 */
const assert = require('assert');

describe('omAssetsWorkshopHandoff', () => {
  it('exports send + destinations helpers', () => {
    const mod = require('../omAssetsWorkshopHandoff');
    assert.equal(typeof mod.fetchWorkshopDestinations, 'function');
    assert.equal(typeof mod.sendAssetsToWorkshop, 'function');
    assert.equal(typeof mod.workshopBaseUrl, 'function');
  });

  it('defaults workshop base URL to nginx front on .251', () => {
    const prev = process.env.OM_WORKSHOP_BASE_URL;
    delete process.env.OM_WORKSHOP_BASE_URL;
    const { workshopBaseUrl } = require('../omAssetsWorkshopHandoff');
    assert.equal(workshopBaseUrl(), 'http://192.168.1.251');
    if (prev != null) process.env.OM_WORKSHOP_BASE_URL = prev;
  });
});
