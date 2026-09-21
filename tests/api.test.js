const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const port = 4174;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-test-'));
const dataFile = path.join(tempDir, 'store.json');
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), DATA_FILE: dataFile, VEYRA_DISABLE_SUPABASE: '1', VEYRA_OTP_MODE: 'demo', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_PUBLISHABLE_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const json = await response.json();
  return { status: response.status, json };
}

(async () => {
  await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 1200); server.stdout.on('data', value => { if (String(value).includes('running')) { clearTimeout(timer); resolve(); } }); server.on('error', reject); });
  const health = await request('/api/health'); assert.equal(health.status, 200); assert.equal(health.json.ok, true);
  const boot = await request('/api/bootstrap'); assert.equal(boot.json.vehicles.length, 0); assert.equal(boot.json.session.role, 'owner');
  const created = await request('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test EV', registration: 'TEST0001', type: 'EV' }) }); assert.equal(created.status, 201); assert.equal(created.json.icon, '⚡');
  const role = await request('/api/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'viewer' }) }); assert.equal(role.json.permissions.manageVehicles, false);
  const denied = await request('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Denied', registration: 'DENIED01' }) }); assert.equal(denied.status, 403);
  const owner = await request('/api/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'owner' }) }); assert.equal(owner.json.permissions.manageVehicles, true);
  const fuel = await request('/api/fuel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: 'TEST0001', date: '2026-09-21', liters: 20, cost: 2000 }) }); assert.equal(fuel.status, 201); assert.equal(fuel.json.cost, 2000);
  const speedPolicy = await request('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overspeedThresholdKph: 60, alertBellEnabled: false }) }); assert.equal(speedPolicy.status, 200); assert.equal(speedPolicy.json.overspeedThresholdKph, 60); assert.equal(speedPolicy.json.alertBellEnabled, false);
  const vehiclePolicy = await request('/api/alert-policies/TEST0001', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thresholdKph: 55, bellEnabled: true }) }); assert.equal(vehiclePolicy.status, 200); assert.equal(vehiclePolicy.json.thresholdKph, 55); assert.equal(vehiclePolicy.json.bellEnabled, true);
  const ping = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: 'TEST0001', lat: 28.55, lng: 77.20, speed: 31, source: 'test' }) }); assert.equal(ping.status, 200); assert.equal(ping.json.status, 'Moving');
  const overspeed = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: 'TEST0001', lat: 28.551, lng: 77.201, speed: 65, source: 'test-overspeed' }) }); assert.equal(overspeed.status, 200);
  const overspeedState = await request('/api/bootstrap'); assert.equal(overspeedState.json.summary.alerts, 1); assert.equal(overspeedState.json.alerts[0].type, 'overspeed');
  const safeSpeed = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: 'TEST0001', lat: 28.552, lng: 77.202, speed: 50, source: 'test-safe-speed' }) }); assert.equal(safeSpeed.status, 200);
  const beforeGpsJump = await request('/api/bootstrap'); const trackedVehicleBeforeJump = beforeGpsJump.json.vehicles.find(vehicle => vehicle.id === 'TEST0001');
  const gpsJump = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: 'TEST0001', lat: 28.65, lng: 77.30, speed: 0, source: 'test-gps-jump' }) }); assert.equal(gpsJump.status, 200);
  const afterGpsJump = await request('/api/bootstrap'); const trackedVehicleAfterJump = afterGpsJump.json.vehicles.find(vehicle => vehicle.id === 'TEST0001'); assert.equal(trackedVehicleAfterJump.km, trackedVehicleBeforeJump.km);
  const durationData = JSON.parse(fs.readFileSync(dataFile, 'utf8')); const durationNow = Date.now();
  durationData.events.slice(0, 3).forEach((event, index) => { event.receivedAt = new Date(durationNow - (2 - index) * 60000).toISOString(); event.raw.speed = 31; });
  fs.writeFileSync(dataFile, JSON.stringify(durationData, null, 2));
  const durationState = await request('/api/bootstrap'); assert.match(durationState.json.summary.driving, /^0 h 0[2-9] m$/); assert.equal(durationState.json.summary.idle, '0 h 00 m');
  const resolvedOverspeed = await request('/api/bootstrap'); assert.equal(resolvedOverspeed.json.summary.alerts, 0); assert.equal(resolvedOverspeed.json.alerts[0].state, 'Resolved');
  const fence = await request('/api/geofences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test depot', type: 'Depot' }) }); assert.equal(fence.status, 201);
  const otp = await request('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999999', vehicleId: 'TEST0001' }) }); assert.equal(otp.status, 200); assert.equal(otp.json.mode, 'demo');
  const paired = await request('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999999', code: otp.json.demoCode }) }); assert.equal(paired.status, 200); assert.equal(paired.json.paired, true);
  const phoneOnlyOtp = await request('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999998' }) }); assert.equal(phoneOnlyOtp.status, 200);
  const phoneOnly = await request('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '+919999999998', code: phoneOnlyOtp.json.demoCode }) }); assert.equal(phoneOnly.status, 200); assert.equal(phoneOnly.json.vehicleId, null); assert.equal(phoneOnly.json.phone, '+919999999998'); assert.ok(phoneOnly.json.deviceLinkId); assert.equal(phoneOnly.json.activationStatus, 'idle');
  const activation = await request(`/api/devices/${phoneOnly.json.deviceLinkId}/activation`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); assert.equal(activation.status, 200); assert.equal(activation.json.activationStatus, 'pending');
  const approval = await request('/api/device/activation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': phoneOnly.json.deviceToken }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, decision: 'approve' }) }); assert.equal(approval.status, 200); assert.equal(approval.json.trackingApproved, true);
  assert.ok(phoneOnly.json.deviceToken); const unauthorizedPhonePing = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, lat: 28.55, lng: 77.20, speed: 0, source: 'test-phone' }) }); assert.equal(unauthorizedPhonePing.status, 401);
  const phonePing = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': phoneOnly.json.deviceToken }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, lat: 28.55, lng: 77.20, speed: 0, source: 'test-phone' }) }); assert.equal(phonePing.status, 200); assert.equal(phonePing.json.status, 'Stopped');
  const deviceConfig = await request(`/api/device/config?deviceLinkId=${phoneOnly.json.deviceLinkId}`, { headers: { 'X-Device-Token': phoneOnly.json.deviceToken } }); assert.equal(deviceConfig.status, 200); assert.equal(deviceConfig.json.cameraEnabled, false); assert.equal(deviceConfig.json.cameraFacing, 'back'); assert.equal(deviceConfig.json.micEnabled, false);
  const cameraOn = await request(`/api/devices/${phoneOnly.json.deviceLinkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cameraEnabled: true, cameraFacing: 'front' }) }); assert.equal(cameraOn.status, 200); assert.equal(cameraOn.json.cameraEnabled, true); assert.equal(cameraOn.json.cameraFacing, 'front');
  const cameraFrame = await request('/api/ingest/camera', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': phoneOnly.json.deviceToken }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, image: 'UklGRg==' }) }); assert.equal(cameraFrame.status, 200);
  const cameraOff = await request(`/api/devices/${phoneOnly.json.deviceLinkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cameraEnabled: false }) }); assert.equal(cameraOff.status, 200); assert.equal(cameraOff.json.cameraEnabled, false);
  const micOn = await request(`/api/devices/${phoneOnly.json.deviceLinkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ micEnabled: true }) }); assert.equal(micOn.status, 200); assert.equal(micOn.json.micEnabled, true);
  const micUpload = await request('/api/ingest/mic', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': phoneOnly.json.deviceToken }, body: JSON.stringify({ deviceLinkId: phoneOnly.json.deviceLinkId, audio: 'UklGRg==', contentType: 'audio/wav' }) }); assert.equal(micUpload.status, 200);
  const micFrame = await request(`/api/mic/${phoneOnly.json.deviceLinkId}`); assert.equal(micFrame.status, 200); assert.equal(micFrame.json.audio, 'UklGRg==');
  const micOff = await request(`/api/devices/${phoneOnly.json.deviceLinkId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ micEnabled: false }) }); assert.equal(micOff.status, 200); assert.equal(micOff.json.micEnabled, false);
  const tenDevices = [];
  for (let index = 0; index < 10; index += 1) {
    const phone = `+91999999${9900 + index}`;
    const requestOtp = await request('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) }); assert.equal(requestOtp.status, 200);
    const pair = await request('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code: requestOtp.json.demoCode }) }); assert.equal(pair.status, 200); tenDevices.push(pair.json);
  }
  assert.equal(tenDevices.length, 10); assert.ok(tenDevices.every(device => device.deviceToken));
  const tenDeviceActivation = await request(`/api/devices/${tenDevices[0].deviceLinkId}/activation`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }); assert.equal(tenDeviceActivation.status, 200);
  const tenDeviceApproval = await request('/api/device/activation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': tenDevices[0].deviceToken }, body: JSON.stringify({ deviceLinkId: tenDevices[0].deviceLinkId, decision: 'approve' }) }); assert.equal(tenDeviceApproval.status, 200);
  const badCoordinates = await request('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': tenDevices[0].deviceToken }, body: JSON.stringify({ deviceLinkId: tenDevices[0].deviceLinkId, lat: 999, lng: 77.20 }) }); assert.equal(badCoordinates.status, 400);
  console.log('Veyra API tests: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server.kill(); fs.rmSync(tempDir, { recursive: true, force: true }); });
