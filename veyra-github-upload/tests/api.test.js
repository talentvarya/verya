const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const port = 4174;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-test-'));
const dataFile = path.join(tempDir, 'store.json');
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, VEYRA_DISABLE_SUPABASE: '1', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_PUBLISHABLE_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const json = await response.json();
  return { status: response.status, json };
}

(async () => {
  await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 1200); server.stdout.on('data', value => { if (String(value).includes('running')) { clearTimeout(timer); resolve(); } }); server.on('error', reject); });
  const health = await request('/api/health'); assert.equal(health.status, 200); assert.equal(health.json.ok, true);
  const boot = await request('/api/bootstrap'); assert.equal(boot.json.vehicles.length, 3); assert.equal(boot.json.session.role, 'owner');
  const created = await request('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test EV', registration: 'TEST0001', type: 'EV' }) }); assert.equal(created.status, 201); assert.equal(created.json.icon, '⚡');
  const role = await request('/api/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) }); assert.equal(role.json.permissions.manageVehicles, false);
  const denied = await request('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Denied', registration: 'DENIED01' }) }); assert.equal(denied.status, 403);
  const owner = await request('/api/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'owner' }) }); assert.equal(owner.json.permissions.manageVehicles, true);
  const ping = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: 'DL01AB1234', lat: 28.55, lng: 77.20, speed: 31, source: 'test' }) }); assert.equal(ping.status, 200); assert.equal(ping.json.status, 'Moving');
  const fence = await request('/api/geofences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test depot', type: 'Depot' }) }); assert.equal(fence.status, 201);
  const otp = await request('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999999', vehicleId: 'DL01AB1234' }) }); assert.equal(otp.status, 200); assert.equal(otp.json.mode, 'demo');
  const paired = await request('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999999', code: otp.json.demoCode }) }); assert.equal(paired.status, 200); assert.equal(paired.json.paired, true);
  const phoneOnlyOtp = await request('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999998' }) }); assert.equal(phoneOnlyOtp.status, 200);
  const phoneOnly = await request('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999998', code: phoneOnlyOtp.json.demoCode }) }); assert.equal(phoneOnly.status, 200); assert.equal(phoneOnly.json.vehicleId, null); assert.ok(phoneOnly.json.deviceLinkId);
  assert.ok(phoneOnly.json.deviceToken); const unauthorizedPhonePing = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, lat: 28.55, lng: 77.20, speed: 0, source: 'test-phone' }) }); assert.equal(unauthorizedPhonePing.status, 401);
  const phonePing = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': phoneOnly.json.deviceToken }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, lat: 28.55, lng: 77.20, speed: 0, source: 'test-phone' }) }); assert.equal(phonePing.status, 200); assert.equal(phonePing.json.status, 'Stopped');
  const tenDevices = [];
  for (let index = 0; index < 10; index += 1) {
    const phone = `+91999999${9900 + index}`;
    const requestOtp = await request('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }); assert.equal(requestOtp.status, 200);
    const pair = await request('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: requestOtp.json.demoCode }) }); assert.equal(pair.status, 200); tenDevices.push(pair.json);
  }
  assert.equal(tenDevices.length, 10); assert.ok(tenDevices.every(device => device.deviceToken));
  const badCoordinates = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': tenDevices[0].deviceToken }, body: JSON.stringify({ deviceLinkId: tenDevices[0].deviceLinkId, lat: 999, lng: 77.20 }) }); assert.equal(badCoordinates.status, 400);
  console.log('Veyra API tests: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.kill(); fs.rmSync(tempDir, { recursive: true, force: true }); });
