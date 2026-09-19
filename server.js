const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDotEnv();

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'store.json');
const DATA_DIR = path.dirname(DATA_FILE);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_ENABLED = process.env.VEYRA_DISABLE_SUPABASE !== '1' && Boolean(SUPABASE_URL && SUPABASE_KEY);
const OTP_MODE = String(process.env.VEYRA_OTP_MODE || 'auto').toLowerCase();
const SMSLOCAL_API_KEY = process.env.SMSLOCAL_API_KEY || '';
const SMSLOCAL_SENDER_ID = process.env.SMSLOCAL_SENDER_ID || '';
const SMSLOCAL_DLT_TEMPLATE_ID = process.env.SMSLOCAL_DLT_TEMPLATE_ID || '';
const SMSLOCAL_API_URL = process.env.SMSLOCAL_API_URL || 'https://app.smslocal.in/api/smsapi';
const SMSLOCAL_ENABLED = Boolean(SMSLOCAL_API_KEY && SMSLOCAL_SENDER_ID && SMSLOCAL_DLT_TEMPLATE_ID);
const pendingPhoneOtps = new Map();
const requestWindows = new Map();

const initialData = {
  summary: { distance: '267.4 km', driving: '8 h 12 m', idle: '42 m', alerts: 2 },
  vehicles: [
    { id: 'DL01AB1234', name: 'Toyota Innova', icon: '🚙', status: 'Moving', statusClass: 'status-live', location: 'Outer Ring Road · 2 min ago', speed: '48 km/h', km: '186.4 km', last: 'Live now', source: 'GPS tracker', capabilities: ['GPS', 'Ignition', 'Accelerometer'] },
    { id: 'DL02CD7788', name: 'Hyundai Creta', icon: '🚗', status: 'Parked', statusClass: 'status-parked', location: 'Home garage · 14 min ago', speed: '—', km: '42.8 km', last: '14 min ago', source: 'GPS tracker', capabilities: ['GPS', 'Ignition'] },
    { id: 'DL03EF9012', name: 'Tata Nexon EV', icon: '⚡', status: 'Charging', statusClass: 'status-live', location: 'Office parking · 31 min ago', speed: '—', km: '38.2 km', last: '31 min ago', source: 'EV connector', capabilities: ['GPS', 'EV telemetry'] }
  ],
  alerts: [
    { id: 'A-101', family: 'Connectivity', title: 'Device offline · Hyundai Creta', detail: 'Last known location: Home garage · 14 min ago', severity: 'Medium', state: 'Open' },
    { id: 'A-102', family: 'Safety', title: 'Sustained overspeed · Toyota Innova', detail: '92 km/h for 48 sec · Outer Ring Road · 10:31 AM', severity: 'Low', state: 'Acknowledged' }
  ],
  members: [
    { name: 'Arjun Rao', role: 'Owner', scope: 'All vehicles', state: 'Active' },
    { name: 'Meera Rao', role: 'Household member', scope: '2 vehicles', state: 'Active' },
    { name: 'Rohan Mehta', role: 'Viewer', scope: 'Pending invite', state: 'Pending' }
  ],
  audit: [{ time: '10:42 AM', actor: 'System', action: 'Connected 3 devices and refreshed activity metrics.' }],
  settings: { waitingGraceMinutes: 5, parkingThresholdMinutes: 10, timezone: 'Asia/Calcutta' },
  session: { user: 'Arjun Rao', role: 'owner', workspace: 'Home garage' },
  geofences: [{ id: 'G-001', name: 'Home garage', type: 'Home', status: 'Active' }],
  events: []
};

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
}
function normalizeData(data) {
  ensureStore();
  data.session ||= { user: 'Arjun Rao', role: 'owner', workspace: 'Home garage' };
  data.geofences ||= [{ id: 'G-001', name: 'Home garage', type: 'Home', status: 'Active' }];
  data.events ||= [];
  data.deviceLinks ||= [];
  return data;
}
function readStore() { return normalizeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
function writeStore(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { ...options, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'User-Agent': 'veyra-server/1.0', 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
async function supabaseAuthRequest(pathname, payload) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${pathname}`, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'User-Agent': 'veyra-server/1.0', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await response.text(); let result = {}; try { result = text ? JSON.parse(text) : {}; } catch { result = { error: text }; }
  if (!response.ok) throw new Error(result.msg || result.error_description || result.error || `Supabase Auth request failed (${response.status})`);
  return result;
}
function createOtpCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
async function sendSmsLocalOtp(phone, code) {
  if (!SMSLOCAL_ENABLED) throw new Error('SMSLocal testing is not configured. Add API key, sender ID, and DLT template ID.');
  const params = new URLSearchParams({ key: SMSLOCAL_API_KEY, route: '2', sender: SMSLOCAL_SENDER_ID, number: phone.replace(/^\+/, ''), sms: `Your Veyra verification code is ${code}. It expires in 5 minutes.`, templateid: SMSLOCAL_DLT_TEMPLATE_ID });
  const response = await fetch(`${SMSLOCAL_API_URL}?${params.toString()}`, { headers: { Accept: 'text/plain, application/json', 'User-Agent': 'veyra-server/1.0' } });
  const result = (await response.text()).trim();
  if (!response.ok || !result || /^(10[1-9]|11[0-6])$/.test(result)) throw new Error(`SMSLocal rejected the OTP request (${result || response.status}).`);
  return result;
}
function normalizePhone(value) { const phone = String(value || '').replace(/[\s()-]/g, ''); return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null; }
function maskPhone(phone) { return `${phone.slice(0, 3)}••••${phone.slice(-4)}`; }
function createDeviceToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashDeviceToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function allowRequest(key, limit, windowMs) {
  const now = Date.now(); const current = requestWindows.get(key) || { count: 0, startedAt: now };
  if (now - current.startedAt >= windowMs) { current.count = 0; current.startedAt = now; }
  current.count += 1; requestWindows.set(key, current);
  return current.count <= limit;
}
function deviceTokenMatches(req, input, link) {
  if (!link?.deviceTokenHash) return true;
  const token = req.headers['x-device-token'] || input.deviceToken;
  if (!token) return false;
  const expected = Buffer.from(link.deviceTokenHash, 'hex');
  const received = Buffer.from(hashDeviceToken(token), 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
async function readData() {
  if (!SUPABASE_ENABLED) return readStore();
  const rows = await supabaseRequest('app_state?id=eq.default&select=payload');
  if (rows?.[0]?.payload) return normalizeData(rows[0].payload);
  const seed = readStore(); await writeData(seed); return seed;
}
async function writeData(data) {
  if (!SUPABASE_ENABLED) return writeStore(data);
  await supabaseRequest('app_state', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ id: 'default', payload: data }]) });
}
function send(res, status, payload, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(type.startsWith('application/json') ? JSON.stringify(payload) : payload); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => raw += chunk); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function audit(data, action) { data.audit.unshift({ time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), actor: 'Arjun Rao', action }); data.audit = data.audit.slice(0, 20); }
function safeFile(urlPath) { const requested = urlPath === '/' ? '/index.html' : urlPath; const file = path.normalize(path.join(ROOT, requested)); return file === ROOT || file.startsWith(`${ROOT}${path.sep}`) ? file : null; }
function permissions(role) { return { view: true, export: role !== 'driver', acknowledge: ['owner', 'responder'].includes(role), manageVehicles: role === 'owner', manageGroup: role === 'owner', managePolicies: role === 'owner', ingest: ['owner', 'driver'].includes(role) }; }
function can(data, action) { return Boolean(permissions(data.session?.role || 'owner')[action]); }
function deny(res, action) { return send(res, 403, { error: `Current role cannot ${action}. Switch to an authorized role first.` }); }

async function handler(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Token', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }); return res.end(); }

  try {
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'veyra-local-mvp', persistence: SUPABASE_ENABLED ? 'supabase' : 'local-json', time: new Date().toISOString() });
    if (pathname === '/api/bootstrap' && req.method === 'GET') { const data = await readData(); return send(res, 200, { ...data, permissions: permissions(data.session.role) }); }
    if (pathname === '/api/session' && req.method === 'GET') { const data = await readData(); return send(res, 200, { ...data.session, permissions: permissions(data.session.role) }); }
    if (pathname === '/api/session' && req.method === 'PATCH') {
      const input = await body(req); const role = String(input.role || '').toLowerCase();
      if (!['owner', 'viewer', 'driver', 'responder'].includes(role)) return send(res, 400, { error: 'Unsupported role.' });
      const data = await readData(); data.session.role = role; audit(data, `Switched demo session role to ${role}.`); await writeData(data); return send(res, 200, { ...data.session, permissions: permissions(role) });
    }
    if (pathname === '/api/phone/request' && req.method === 'POST') {
      if (!allowRequest(`otp:${req.socket.remoteAddress || 'unknown'}`, 20, 60_000)) return send(res, 429, { error: 'Too many OTP requests. Try again in a minute.' });
      const input = await body(req); const phone = normalizePhone(input.phone); if (!phone) return send(res, 400, { error: 'Use international format, for example +919876543210.' });
      const vehicleId = input.vehicleId; let mode = 'demo'; let demoCode;
      if ((OTP_MODE === 'smslocal' || (OTP_MODE === 'auto' && SMSLOCAL_ENABLED)) && SMSLOCAL_ENABLED) {
        demoCode = createOtpCode();
        try { await sendSmsLocalOtp(phone, demoCode); mode = 'smslocal'; }
        catch (error) { if (OTP_MODE === 'smslocal') return send(res, 502, { error: error.message }); console.warn(`SMSLocal unavailable; using fallback OTP mode: ${error.message}`); }
      } else if (OTP_MODE === 'smslocal') {
        return send(res, 503, { error: 'SMSLocal testing is not configured. Add API key, sender ID, and DLT template ID.' });
      }
      if (mode === 'demo' && OTP_MODE !== 'smslocal' && SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
        try { await supabaseAuthRequest('otp', { phone }); mode = 'supabase'; }
        catch (error) { console.warn(`Supabase SMS unavailable; using local demo OTP: ${error.message}`); mode = 'demo'; demoCode = createOtpCode(); }
      } else if (mode === 'demo') { demoCode = createOtpCode(); }
      pendingPhoneOtps.set(phone, { code: demoCode, vehicleId, expiresAt: Date.now() + 5 * 60 * 1000, mode });
      return send(res, 200, { ok: true, mode, phone: maskPhone(phone), ...(demoCode ? { demoCode } : {}) });
    }
    if (pathname === '/api/phone/verify' && req.method === 'POST') {
      if (!allowRequest(`verify:${req.socket.remoteAddress || 'unknown'}`, 30, 60_000)) return send(res, 429, { error: 'Too many verification attempts. Try again in a minute.' });
      const input = await body(req); const phone = normalizePhone(input.phone); const pending = phone && pendingPhoneOtps.get(phone); if (!phone || !pending || pending.expiresAt < Date.now()) return send(res, 400, { error: 'OTP request expired. Request a new code.' });
      let userId = `demo-${Buffer.from(phone).toString('base64url').slice(-10)}`;
      if (pending.mode === 'supabase') { try { const auth = await supabaseAuthRequest('verify', { phone, token: String(input.code || ''), type: 'sms' }); userId = auth.user?.id || userId; } catch (error) { return send(res, 401, { error: error.message }); } }
      else if (String(input.code || '') !== pending.code) return send(res, 401, { error: 'Incorrect demo OTP.' });
      const data = await readData(); const vehicle = pending.vehicleId ? data.vehicles.find(item => item.id === pending.vehicleId) : null; const deviceToken = createDeviceToken(); const deviceLink = { id: `DL-${Date.now()}`, phone: maskPhone(phone), vehicleId: vehicle?.id || null, userId, mode: pending.mode, pairedAt: new Date().toISOString(), status: 'Stopped', speed: 0, lastSeen: null, lastPosition: null, deviceTokenHash: hashDeviceToken(deviceToken) }; data.deviceLinks.push(deviceLink); data.deviceLinks = data.deviceLinks.slice(-20); audit(data, `Paired ${maskPhone(phone)} as a mobile device${vehicle ? ` for ${vehicle.name}` : ''}.`); await writeData(data); pendingPhoneOtps.delete(phone); return send(res, 200, { paired: true, deviceLinkId: deviceLink.id, deviceToken, vehicleId: vehicle?.id || null, vehicleName: vehicle?.name || null, phone: deviceLink.phone, mode: pending.mode, userId });
    }
    if (pathname === '/api/audit' && req.method === 'GET') return send(res, 200, (await readData()).audit);
    if (pathname === '/api/geofences' && req.method === 'GET') return send(res, 200, (await readData()).geofences);
    if (pathname === '/api/geofences' && req.method === 'POST') {
      const data = await readData(); if (!can(data, 'managePolicies')) return deny(res, 'manage geofences');
      const input = await body(req); if (!input.name) return send(res, 400, { error: 'Geofence name is required.' });
      const geofence = { id: `G-${String(Date.now()).slice(-5)}`, name: String(input.name).trim(), type: input.type || 'Custom', status: 'Active' }; data.geofences.push(geofence); audit(data, `Created geofence ${geofence.name}.`); await writeData(data); return send(res, 201, geofence);
    }

    if (pathname === '/api/vehicles' && req.method === 'POST') {
      const input = await body(req);
      const current = await readData(); if (!can(current, 'manageVehicles')) return deny(res, 'add vehicles');
      if (!input.name || !input.registration) return send(res, 400, { error: 'Vehicle name and registration are required.' });
      const data = current;
      const id = String(input.registration).trim().toUpperCase().replace(/\s+/g, '');
      if (data.vehicles.some(vehicle => vehicle.id === id)) return send(res, 409, { error: 'A vehicle with that registration already exists.' });
      const vehicle = { id, name: String(input.name).trim(), icon: input.type === 'EV' ? '⚡' : '🚙', status: 'Parked', statusClass: 'status-parked', location: 'Awaiting first location · just now', speed: '—', km: '0.0 km', last: 'Just added', source: 'Setup required', capabilities: ['Vehicle profile'] };
      data.vehicles.push(vehicle); audit(data, `Added ${vehicle.name} (${vehicle.id}) to the workspace.`); await writeData(data); return send(res, 201, vehicle);
    }

    const alertMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/ack$/);
    if (alertMatch && req.method === 'PATCH') {
      const data = await readData(); if (!can(data, 'acknowledge')) return deny(res, 'acknowledge alerts'); const alert = data.alerts.find(item => item.id === alertMatch[1]);
      if (!alert) return send(res, 404, { error: 'Alert not found.' });
      alert.state = 'Acknowledged'; audit(data, `Acknowledged alert ${alert.id}: ${alert.title}`); await writeData(data); return send(res, 200, alert);
    }

    if (pathname === '/api/group/invite' && req.method === 'POST') {
      const data = await readData(); if (!can(data, 'manageGroup')) return deny(res, 'invite members'); const input = await body(req); if (!input.name) return send(res, 400, { error: 'Name is required.' });
      const member = { name: String(input.name).trim(), role: input.role || 'Household member', scope: input.scope || 'Selected vehicles', state: 'Pending' }; data.members.push(member); audit(data, `Invited ${member.name} as ${member.role}.`); await writeData(data); return send(res, 201, member);
    }

    if (pathname === '/api/settings' && req.method === 'PATCH') {
      const input = await body(req); const data = await readData(); if (!can(data, 'managePolicies')) return deny(res, 'update workspace policies'); data.settings = { ...data.settings, ...input }; audit(data, 'Updated workspace activity thresholds.'); await writeData(data); return send(res, 200, data.settings);
    }

    if (pathname === '/api/simulator/tick' && req.method === 'POST') {
      const data = await readData(); if (!can(data, 'ingest')) return deny(res, 'simulate device events'); const input = await body(req); const vehicle = data.vehicles.find(item => item.id === input.vehicleId) || data.vehicles[0];
      vehicle.status = vehicle.status === 'Moving' ? 'Parked' : 'Moving'; vehicle.statusClass = vehicle.status === 'Moving' ? 'status-live' : 'status-parked'; vehicle.speed = vehicle.status === 'Moving' ? '36 km/h' : '—'; vehicle.last = 'Just now'; vehicle.location = vehicle.status === 'Moving' ? 'Simulated route · just now' : 'Simulated stop · just now'; vehicle.position = { lat: 28.56 + Math.random() / 100, lng: 77.19 + Math.random() / 100, accuracy: 12, source: 'Simulator' }; data.events.unshift({ eventId: `EV-${Date.now()}`, vehicleId: vehicle.id, type: 'position', receivedAt: new Date().toISOString(), quality: 'Simulated' }); data.events = data.events.slice(0, 50); audit(data, `Simulated a ${vehicle.status.toLowerCase()} position for ${vehicle.name}.`); await writeData(data); return send(res, 200, vehicle);
    }
    if (pathname === '/api/ingest/position' && req.method === 'POST') {
      const data = await readData(); if (!can(data, 'ingest')) return deny(res, 'ingest position events'); const input = await body(req); const link = input.deviceLinkId ? data.deviceLinks.find(item => item.id === input.deviceLinkId) : null; if (link && !deviceTokenMatches(req, input, link)) return send(res, 401, { error: 'This device is not authorized. Pair it again.' }); const vehicle = data.vehicles.find(item => item.id === input.vehicleId) || (link?.vehicleId ? data.vehicles.find(item => item.id === link.vehicleId) : null); if (!vehicle && !link) return send(res, 404, { error: 'Vehicle or paired device not found.' });
      const lat = Number(input.lat); const lng = Number(input.lng); const speed = Math.max(0, Number(input.speed || 0)); const accuracy = Math.max(0, Number(input.accuracy || 20)); if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return send(res, 400, { error: 'A valid latitude and longitude are required.' }); if (!Number.isFinite(speed) || !Number.isFinite(accuracy)) return send(res, 400, { error: 'Speed and accuracy must be valid numbers.' }); const position = { lat, lng, accuracy, source: input.source || 'Webhook' }; if (vehicle) { vehicle.position = position; vehicle.speed = `${speed} km/h`; vehicle.status = speed > 3 ? 'Moving' : 'Parked'; vehicle.statusClass = vehicle.status === 'Moving' ? 'status-live' : 'status-parked'; vehicle.last = 'Just now'; vehicle.location = input.location || 'Normalized webhook position · just now'; } if (link) { link.lastPosition = position; link.speed = speed; link.status = speed > 3 ? 'Moving' : 'Stopped'; link.lastSeen = new Date().toISOString(); } data.events.unshift({ eventId: input.eventId || `EV-${Date.now()}`, vehicleId: vehicle?.id || null, deviceLinkId: link?.id || input.deviceLinkId || null, type: 'position', receivedAt: new Date().toISOString(), quality: 'Measured', raw: input }); data.events = data.events.slice(0, 50); audit(data, `Ingested a normalized position event for ${vehicle?.name || link?.phone || 'mobile device'}.`); await writeData(data); return send(res, 200, vehicle || { id: link.id, name: link.phone, status: link.status, speed: `${speed} km/h`, position });
    }

    if (req.method === 'GET') {
      const file = safeFile(pathname); if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      const ext = path.extname(file); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' }; return send(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream');
    }
    return send(res, 404, { error: 'Route not found.' });
  } catch (error) { return send(res, 500, { error: error.message }); }
}

ensureStore();
http.createServer(handler).listen(PORT, HOST, () => console.log(`Veyra MVP running at http://127.0.0.1:${PORT} (LAN host: ${HOST})`));
