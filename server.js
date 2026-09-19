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
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
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
const SUPABASE_AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
const STATE_ID = 'fleet:primary';
const OTP_MODE = String(process.env.VEYRA_OTP_MODE || 'auto').toLowerCase();
const SMSLOCAL_API_KEY = process.env.SMSLOCAL_API_KEY || '';
const SMSLOCAL_SENDER_ID = process.env.SMSLOCAL_SENDER_ID || '';
const SMSLOCAL_DLT_TEMPLATE_ID = process.env.SMSLOCAL_DLT_TEMPLATE_ID || '';
const SMSLOCAL_API_URL = process.env.SMSLOCAL_API_URL || 'https://app.smslocal.in/api/smsapi';
const SMSLOCAL_ENABLED = Boolean(SMSLOCAL_API_KEY && SMSLOCAL_SENDER_ID && SMSLOCAL_DLT_TEMPLATE_ID);
const pendingPhoneOtps = new Map();
const requestWindows = new Map();
const cameraFrames = new Map();

const initialData = {
  summary: { distance: '0 km', driving: '0 h 00 m', idle: '0 m', alerts: 0 },
  vehicles: [],
  alerts: [],
  members: [],
  audit: [],
  settings: { waitingGraceMinutes: 5, parkingThresholdMinutes: 10, timezone: 'Asia/Calcutta' },
  session: { user: '', role: 'owner', workspace: 'Fleet workspace' },
  geofences: [],
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
  refreshSummary(data);
  return data;
}
function readStore() { return normalizeData(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); }
function writeStore(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, { ...options, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'User-Agent': 'veyra-server/1.0', 'Content-Type': 'application/json', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  const text = await response.text(); return text ? JSON.parse(text) : null;
}
async function supabaseAuthRequest(pathname, payload, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${pathname}`, { method: options.method || 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'User-Agent': 'veyra-server/1.0', 'Content-Type': 'application/json', ...(options.headers || {}) }, body: options.method === 'GET' ? undefined : JSON.stringify(payload || {}) });
  const text = await response.text(); let result = {}; try { result = text ? JSON.parse(text) : {}; } catch { result = { error: text }; }
  if (!response.ok) throw new Error(result.msg || result.error_description || result.error || `Supabase Auth request failed (${response.status})`);
  return result;
}
function parseCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => { const index = item.indexOf('='); return [index === -1 ? item : item.slice(0, index), index === -1 ? '' : decodeURIComponent(item.slice(index + 1))]; })); }
function cookieOptions(maxAge) { return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`; }
function authCookies(session) { return [`veyra_access_token=${encodeURIComponent(session.access_token)}; ${cookieOptions(Number(session.expires_in || 3600))}`, `veyra_refresh_token=${encodeURIComponent(session.refresh_token)}; ${cookieOptions(60 * 60 * 24 * 30)}`]; }
async function authUser(req) {
  if (!SUPABASE_AUTH_ENABLED) return { id: 'local-dev', email: 'local@dev', role: 'owner' };
  const cookies = parseCookies(req); const token = cookies.veyra_access_token || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try { return await supabaseAuthRequest('user', null, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }); } catch { return null; }
}
async function requireAuth(req, res) {
  const user = await authUser(req);
  if (!user) { send(res, 401, { error: 'Login required.' }); return null; }
  req.authUser = user; return user;
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
function distanceMeters(a, b) { if (!a || !b) return 0; const rad = Math.PI / 180; const dLat = (Number(b.lat) - Number(a.lat)) * rad; const dLng = (Number(b.lng) - Number(a.lng)) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(Number(a.lat) * rad) * Math.cos(Number(b.lat) * rad) * Math.sin(dLng / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }
function historicalDistanceMeters(data) {
  const samples = new Map();
  (data.events || []).forEach(event => { const raw = event.raw || {}; const lat = Number(raw.lat); const lng = Number(raw.lng); if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; const key = event.deviceLinkId || event.vehicleId || 'fleet'; if (!samples.has(key)) samples.set(key, []); samples.get(key).push({ lat, lng, accuracy: Number(raw.accuracy || 20), receivedAt: new Date(event.receivedAt || 0).getTime() }); });
  let total = 0;
  samples.forEach(items => { items.sort((a, b) => a.receivedAt - b.receivedAt); for (let index = 1; index < items.length; index += 1) { const previous = items[index - 1]; const current = items[index]; const step = distanceMeters(previous, current); const accuracy = Math.max(previous.accuracy, current.accuracy, 12); if (step > accuracy && step <= 10000) total += step; } });
  return total;
}
function formatDuration(milliseconds) { const minutes = Math.max(0, Math.floor(milliseconds / 60000)); return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} m`; }
function refreshSummary(data) {
  if (!Number.isFinite(Number(data.distanceMetersTotal))) data.distanceMetersTotal = historicalDistanceMeters(data);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const samples = new Map();
  (data.events || []).forEach(event => {
    const raw = event.raw || {};
    const lat = Number(raw.lat); const lng = Number(raw.lng); const receivedAt = new Date(event.receivedAt || 0).getTime();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(receivedAt) || receivedAt < since) return;
    const key = event.deviceLinkId || event.vehicleId || 'fleet';
    if (!samples.has(key)) samples.set(key, []);
    samples.get(key).push({ raw: { ...raw, lat, lng }, receivedAt });
  });
  let meters = 0; let drivingMilliseconds = 0; let idleMilliseconds = 0;
  samples.forEach(items => {
    items.sort((a, b) => a.receivedAt - b.receivedAt);
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1]; const current = items[index]; const gap = current.receivedAt - previous.receivedAt;
      if (gap <= 0 || gap > 10 * 60 * 1000) continue;
      const step = distanceMeters(previous.raw, current.raw);
      if (step <= 10000) meters += step;
      const accuracy = Math.max(Number(previous.raw.accuracy || 20), Number(current.raw.accuracy || 20), 12);
      const moving = Number(previous.raw.speed || 0) > 3 || step > accuracy;
      const elapsed = Math.min(gap, 5 * 60 * 1000);
      if (moving) drivingMilliseconds += elapsed;
      else idleMilliseconds += elapsed;
    }
  });
  const activeAlerts = (data.alerts || []).filter(alert => alert.state === 'Open').length;
  data.summary = { distance: `${(Number(data.distanceMetersTotal || 0) / 1000).toFixed(2)} km`, driving: formatDuration(drivingMilliseconds), idle: `${Math.floor(idleMilliseconds / 60000)} m`, alerts: activeAlerts };
}
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
  const rows = await supabaseRequest(`app_state?id=eq.${encodeURIComponent(STATE_ID)}&select=payload`);
  if (rows?.[0]?.payload) return normalizeData(rows[0].payload);
  const seed = normalizeData(JSON.parse(JSON.stringify(initialData))); await writeData(seed); return seed;
}
async function writeData(data) {
  refreshSummary(data);
  if (!SUPABASE_ENABLED) return writeStore(data);
  await supabaseRequest('app_state', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ id: STATE_ID, payload: data }]) });
}
function send(res, status, payload, type = 'application/json; charset=utf-8', headers = {}) { res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...headers }); res.end(type.startsWith('application/json') ? JSON.stringify(payload) : payload); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => raw += chunk); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function audit(data, action) { data.audit.unshift({ time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }), actor: 'Arjun Rao', action }); data.audit = data.audit.slice(0, 20); }
function safeFile(urlPath) { const requested = urlPath === '/' ? '/index.html' : urlPath; const file = path.normalize(path.join(ROOT, requested)); return file === ROOT || file.startsWith(`${ROOT}${path.sep}`) ? file : null; }
function permissions(role) { return { view: true, export: role !== 'driver', acknowledge: ['owner', 'responder'].includes(role), manageVehicles: role === 'owner', manageGroup: role === 'owner', managePolicies: role === 'owner', ingest: ['owner', 'driver'].includes(role) }; }
function can(data, action) { return Boolean(permissions(data.session?.role || 'owner')[action]); }
function deny(res, action) { return send(res, 403, { error: `Current role cannot ${action}. Switch to an authorized role first.` }); }

async function handler(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Token', 'Access-Control-Allow-Methods': 'DELETE,GET,POST,PATCH,OPTIONS' }); return res.end(); }

  try {
    if (pathname === '/api/auth/signup' && req.method === 'POST') {
      if (!SUPABASE_AUTH_ENABLED) return send(res, 503, { error: 'Supabase Auth is not configured.' });
      const input = await body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return send(res, 400, { error: 'Enter a valid email and a password of at least 8 characters.' });
      try {
        const result = await supabaseAuthRequest('signup', { email, password });
        const headers = result.access_token ? { 'Set-Cookie': authCookies(result) } : {};
        return send(res, 201, { ok: true, requiresEmailConfirmation: !result.access_token, user: result.user ? { id: result.user.id, email: result.user.email } : null }, 'application/json; charset=utf-8', headers);
      } catch (error) { return send(res, 400, { error: error.message }); }
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (!SUPABASE_AUTH_ENABLED) return send(res, 503, { error: 'Supabase Auth is not configured.' });
      const input = await body(req); const email = String(input.email || '').trim().toLowerCase(); const password = String(input.password || '');
      if (!email || !password) return send(res, 400, { error: 'Email and password are required.' });
      try { const result = await supabaseAuthRequest('token?grant_type=password', { email, password }); return send(res, 200, { ok: true, user: { id: result.user?.id, email: result.user?.email } }, 'application/json; charset=utf-8', { 'Set-Cookie': authCookies(result) }); }
      catch (error) { return send(res, 401, { error: 'Email or password is incorrect.' }); }
    }
    if (pathname === '/api/auth/refresh' && req.method === 'POST') {
      if (!SUPABASE_AUTH_ENABLED) return send(res, 503, { error: 'Supabase Auth is not configured.' });
      const refreshToken = parseCookies(req).veyra_refresh_token;
      if (!refreshToken) return send(res, 401, { error: 'Login session expired.' });
      try { const result = await supabaseAuthRequest('token?grant_type=refresh_token', { refresh_token: refreshToken }); return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': authCookies(result) }); }
      catch { return send(res, 401, { error: 'Login session expired.' }); }
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': [`veyra_access_token=; ${cookieOptions(0)}`, `veyra_refresh_token=; ${cookieOptions(0)}`] });
    if (pathname === '/api/auth/me' && req.method === 'GET') { const user = await requireAuth(req, res); if (!user) return; return send(res, 200, { id: user.id, email: user.email }); }

    const publicApi = pathname === '/api/health' || pathname === '/api/phone/request' || pathname === '/api/phone/verify' || pathname === '/api/ingest/position' || pathname === '/api/ingest/camera';
    if (pathname.startsWith('/api/') && !publicApi) { const user = await requireAuth(req, res); if (!user) return; }

    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'veyra-local-mvp', persistence: SUPABASE_ENABLED ? 'supabase' : 'local-json', time: new Date().toISOString() });
    if (pathname === '/api/bootstrap' && req.method === 'GET') { const data = await readData(); data.session.user = req.authUser.email; data.session.email = req.authUser.email; return send(res, 200, { ...data, permissions: permissions(data.session.role) }); }
    if (pathname === '/api/session' && req.method === 'GET') { const data = await readData(); data.session.user = req.authUser.email; data.session.email = req.authUser.email; return send(res, 200, { ...data.session, permissions: permissions(data.session.role) }); }
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
    const deviceMatch = pathname.match(/^\/api\/devices\/([^/]+)$/);
    if (deviceMatch && req.method === 'DELETE') {
      const data = await readData(); if (!can(data, 'manageVehicles')) return deny(res, 'delete devices');
      const index = data.deviceLinks.findIndex(item => item.id === decodeURIComponent(deviceMatch[1]));
      if (index < 0) return send(res, 404, { error: 'Device not found.' });
      const [removed] = data.deviceLinks.splice(index, 1); audit(data, `Removed mobile device ${removed.phone}.`); await writeData(data); return send(res, 200, { deleted: true, deviceLinkId: removed.id });
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
      const lat = Number(input.lat); const lng = Number(input.lng); const speed = Math.max(0, Number(input.speed || 0)); const accuracy = Math.max(0, Number(input.accuracy || 20)); if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return send(res, 400, { error: 'A valid latitude and longitude are required.' }); if (!Number.isFinite(speed) || !Number.isFinite(accuracy)) return send(res, 400, { error: 'Speed and accuracy must be valid numbers.' }); const position = { lat, lng, accuracy, source: input.source || 'Webhook' }; const previousPosition = link?.lastPosition || vehicle?.position; const stepMeters = distanceMeters(previousPosition, position); const moving = speed > 3 || stepMeters > Math.max(accuracy, 12); if (stepMeters > Math.max(accuracy, 12) && stepMeters <= 10000) data.distanceMetersTotal = Number(data.distanceMetersTotal || 0) + stepMeters; if (vehicle) { vehicle.position = position; vehicle.speed = `${speed} km/h`; vehicle.status = moving ? 'Moving' : 'Parked'; vehicle.statusClass = vehicle.status === 'Moving' ? 'status-live' : 'status-parked'; vehicle.last = 'Just now'; vehicle.location = input.location || 'Normalized webhook position · just now'; } if (link) { link.lastPosition = position; link.speed = speed; link.status = moving ? 'Moving' : 'Stopped'; link.lastSeen = new Date().toISOString(); } data.events.unshift({ eventId: input.eventId || `EV-${Date.now()}`, vehicleId: vehicle?.id || null, deviceLinkId: link?.id || input.deviceLinkId || null, type: 'position', receivedAt: new Date().toISOString(), quality: 'Measured', raw: input }); data.events = data.events.slice(0, 50); audit(data, `Ingested a normalized position event for ${vehicle?.name || link?.phone || 'mobile device'}.`); await writeData(data); return send(res, 200, vehicle || { id: link.id, name: link.phone, status: link.status, speed: `${speed} km/h`, position });
    }
    if (pathname === '/api/ingest/camera' && req.method === 'POST') {
      const input = await body(req); const data = await readData(); const link = input.deviceLinkId ? data.deviceLinks.find(item => item.id === input.deviceLinkId) : null;
      if (!link) return send(res, 404, { error: 'Paired device not found.' });
      if (!deviceTokenMatches(req, input, link)) return send(res, 401, { error: 'This device is not authorized. Pair it again.' });
      const image = String(input.image || ''); if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length > 350000) return send(res, 400, { error: 'Camera frame is invalid or too large.' });
      cameraFrames.set(link.id, { image, contentType: 'image/jpeg', receivedAt: new Date().toISOString() }); return send(res, 200, { ok: true, receivedAt: cameraFrames.get(link.id).receivedAt });
    }
    const cameraMatch = pathname.match(/^\/api\/camera\/([^/]+)$/);
    if (cameraMatch && req.method === 'GET') {
      const frame = cameraFrames.get(decodeURIComponent(cameraMatch[1])); if (!frame) return send(res, 404, { error: 'No camera frame available.' }); return send(res, 200, frame);
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
