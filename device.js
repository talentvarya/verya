const vehicleSelect = document.getElementById('vehicleSelect');
const startButton = document.getElementById('startButton');
const testButton = document.getElementById('testButton');
const statusBox = document.getElementById('deviceStatus');
const lastEvent = document.getElementById('lastEvent');
const phoneInput = document.getElementById('phoneInput');
const requestOtpButton = document.getElementById('requestOtpButton');
const otpPanel = document.getElementById('otpPanel');
const otpInput = document.getElementById('otpInput');
const verifyButton = document.getElementById('verifyButton');
const pairingStatus = document.getElementById('pairingStatus');
let vehicles = [];
let watchId = null;
let otpPhone = '';
let paired = false;
let deviceLinkId = '';
let deviceToken = '';

function setStatus(message, kind = '') { statusBox.className = `device-status ${kind}`; statusBox.innerHTML = `<span class="status-dot"></span><span>${message}</span>`; }
function selectedVehicle() { return vehicleSelect.value ? vehicles.find(vehicle => vehicle.id === vehicleSelect.value) || null : null; }
function stamp(message) { lastEvent.textContent = `${message} · ${new Date().toLocaleTimeString()}`; }
async function sendPosition(position, source = 'Mobile browser GPS') {
  const coords = position.coords;
  const vehicle = selectedVehicle(); if (!vehicle && !deviceLinkId) return;
  const response = await fetch('/api/ingest/position', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken }, body: JSON.stringify({ eventId: `MOBILE-${Date.now()}`, deviceLinkId, vehicleId: vehicle?.id || null, lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, speed: coords.speed ? coords.speed * 3.6 : 0, source }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Position was rejected');
  setStatus(`Sharing location${result.name ? ` for ${result.name}` : ''}`, 'active'); stamp(`Sent ${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
}
function startSharing() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; startButton.textContent = 'Start location sharing'; setStatus('Location sharing stopped'); return; }
  if (!navigator.geolocation) return setStatus('This browser does not expose GPS. Use test location.', 'error');
  setStatus('Requesting location permission…');
  watchId = navigator.geolocation.watchPosition(position => sendPosition(position).catch(error => setStatus(error.message, 'error')), error => { watchId = null; setStatus(`${error.message} Use test location instead.`, 'error'); }, { enableHighAccuracy:true, maximumAge:5000, timeout:15000 });
  startButton.textContent = 'Stop location sharing';
}
async function sendTestLocation() {
  const vehicle = selectedVehicle(); if (!vehicle && !deviceLinkId) return;
  const base = vehicle?.position || { lat: 28.5672, lng: 77.2100 };
  try { await sendPosition({ coords: { latitude: Number(base.lat) + (Math.random() - .5) / 1000, longitude: Number(base.lng) + (Math.random() - .5) / 1000, accuracy: 15, speed: 8 } }, 'Mobile test location'); } catch (error) { setStatus(error.message, 'error'); }
}
async function loadVehicles() {
  try { const response = await fetch('/api/bootstrap'); const data = await response.json(); vehicles = data.vehicles || []; vehicleSelect.innerHTML = `<option value="">Phone only — no vehicle selected</option>${vehicles.map(vehicle => `<option value="${vehicle.id}">${vehicle.name} · ${vehicle.id}</option>`).join('')}`; setStatus('Ready to connect'); } catch (error) { setStatus('Could not reach Veyra server.', 'error'); }
}
async function requestOtp() {
  const vehicle = selectedVehicle(); otpPhone = phoneInput.value.trim(); if (!otpPhone) return pairingStatus.textContent = 'Enter your mobile number first.';
  const response = await fetch('/api/phone/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: otpPhone, vehicleId: vehicle?.id || null }) }); const result = await response.json(); if (!response.ok) return pairingStatus.textContent = result.error;
  otpPanel.hidden = false; pairingStatus.className = 'pairing-status'; pairingStatus.textContent = result.mode === 'demo' ? `Demo OTP: ${result.demoCode}` : `OTP sent to ${result.phone}`; otpInput.focus();
}
async function verifyPairing() {
  const response = await fetch('/api/phone/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: otpPhone, code: otpInput.value.trim() }) }); const result = await response.json(); if (!response.ok) { pairingStatus.className = 'pairing-status error'; pairingStatus.textContent = result.error; return; }
  paired = true; deviceLinkId = result.deviceLinkId || ''; deviceToken = result.deviceToken || ''; startButton.disabled = false; testButton.disabled = false; pairingStatus.className = 'pairing-status success'; pairingStatus.textContent = result.vehicleName ? `Paired with ${result.vehicleName} (${result.mode} auth)` : `Phone registered ${result.phone || ''} (${result.mode} auth)`; setStatus('Ready to share location');
}
startButton.addEventListener('click', startSharing); testButton.addEventListener('click', sendTestLocation); requestOtpButton.addEventListener('click', requestOtp); verifyButton.addEventListener('click', verifyPairing); loadVehicles();
