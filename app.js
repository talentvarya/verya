let vehicles = [];

const viewMeta = {
  home: { title: 'Fleet overview', eyebrow: 'Fleet workspace', subtitle: 'Live status from your connected vehicles and devices.' },
  vehicles: { title: 'Your vehicles', eyebrow: 'Garage', subtitle: 'A clear view of every connected vehicle and device.' },
  activity: { title: 'Activity intelligence', eyebrow: 'Today · All vehicles', subtitle: 'Movement, waiting, parking and idle time — classified with confidence.' },
  security: { title: 'Security center', eyebrow: 'Fleet protection', subtitle: 'Review alerts, device health and safe response actions.' },
  trips: { title: 'Trips & route history', eyebrow: 'Movement history', subtitle: 'Review routes recorded by connected devices.' },
  maintenance: { title: 'Maintenance & documents', eyebrow: 'Vehicle records', subtitle: 'Keep service, insurance and compliance work visible.' },
  reports: { title: 'Reports', eyebrow: 'Insights', subtitle: 'Saved views for activity, costs, safety and compliance.' },
  group: { title: 'Group & access', eyebrow: 'Fleet workspace', subtitle: 'Share the right vehicle data with the right people.' },
  settings: { title: 'Settings', eyebrow: 'Workspace controls', subtitle: 'Policies, devices, notifications and privacy.' }
};

let state = { view: 'home', workspace: 'home', selectedVehicle: 0 };
let selectedCameraDeviceId = null;
let selectedReportDeviceId = null;
let liveData = null;
let liveMap = null;
let googleMap = null;
let googleMapsLoading = null;
let googleInfoWindow = null;
let liveMapViewKey = '';
const liveMarkers = new Map();
const googleMarkers = new Map();
const liveMarkerAnimations = new Map();
const googleMarkerAnimations = new Map();
const liveMarkerStates = new Map();
const liveMarkerHeadings = new Map();
let liveTrailLayers = [];
let googleTrailLayers = [];
let notificationBaselineReady = false;
let knownOpenAlertIds = new Set();
let alertAudioContext = null;
const alertNotificationCooldownMs = 10 * 60 * 1000;
const pageWrap = document.getElementById('pageWrap');
const toast = document.getElementById('toast');
let toastTimer;

function icon(symbol, cls = '') { return `<span class="timeline-dot ${cls}">${symbol}</span>`; }
function alertDateTime(alert) { const value = alert.createdAt || alert.lastSeenAt || alert.resolvedAt; return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date/time unavailable'; }
function clientAlertPolicy(targetId) { const saved = liveData?.alertPolicies?.[targetId] || {}; return { thresholdKph: Number(saved.thresholdKph || liveData?.settings?.overspeedThresholdKph || 90), bellEnabled: saved.bellEnabled ?? liveData?.settings?.alertBellEnabled !== false }; }
function alertNotificationAllowed(alert) { const targetId = alert.targetId || alert.deviceLinkId || alert.vehicleId || 'fleet'; const storageKey = `veyra-alert-notified:${targetId}`; try { const last = Number(localStorage.getItem(storageKey) || 0); if (Date.now() - last < alertNotificationCooldownMs) return false; localStorage.setItem(storageKey, String(Date.now())); } catch (_) {} return true; }
function unlockAlertBell() { try { alertAudioContext ||= new (window.AudioContext || window.webkitAudioContext)(); if (alertAudioContext.state === 'suspended') alertAudioContext.resume(); } catch (_) {} }
function playAlertBell() { if (liveData?.settings?.alertBellEnabled === false) return; try { unlockAlertBell(); if (!alertAudioContext) return; const now = alertAudioContext.currentTime; [880, 660].forEach((frequency, index) => { const oscillator = alertAudioContext.createOscillator(); const gain = alertAudioContext.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0.0001, now + index * 0.18); gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.18 + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.16); oscillator.connect(gain).connect(alertAudioContext.destination); oscillator.start(now + index * 0.18); oscillator.stop(now + index * 0.18 + 0.18); }); } catch (_) {} }
function updateNotificationBell(alerts = []) {
  const openAlerts = alerts.filter(alert => alert.state === 'Open');
  const badge = document.getElementById('notificationBadge');
  const button = document.getElementById('notificationButton');
  const bellEnabled = liveData?.settings?.alertBellEnabled !== false;
  if (badge) { badge.textContent = openAlerts.length > 99 ? '99+' : String(openAlerts.length); badge.hidden = openAlerts.length === 0; }
  if (button) { button.setAttribute('aria-label', openAlerts.length ? `${openAlerts.length} active warning${openAlerts.length === 1 ? '' : 's'}` : 'No active warnings'); button.title = bellEnabled ? 'Warnings bell on · click to open alerts' : 'Warnings bell off · click to open alerts'; button.classList.toggle('muted', !bellEnabled); }
  const fresh = openAlerts.filter(alert => !knownOpenAlertIds.has(alert.id));
  const notifiable = fresh.filter(alert => clientAlertPolicy(alert.targetId || alert.deviceLinkId || alert.vehicleId).bellEnabled && alertNotificationAllowed(alert));
  if (notificationBaselineReady && notifiable.length) {
    const alert = notifiable[0];
    showToast(`${alert.title}: ${alert.detail}`);
    playAlertBell();
    if ('Notification' in window && Notification.permission === 'granted') new Notification(alert.title, { body: `${alert.detail}\n${alertDateTime(alert)}`, tag: alert.id });
  }
  knownOpenAlertIds = new Set(openAlerts.map(alert => alert.id));
  notificationBaselineReady = true;
}
async function enableBrowserNotifications() {
  if (!('Notification' in window)) { showToast('Browser notifications are not supported here.'); return; }
  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    showToast(permission === 'granted' ? 'Warning notifications enabled' : 'Notification permission was not allowed');
  } else if (Notification.permission === 'granted') showToast('Warning notifications are already enabled');
  else showToast('Enable notifications from the browser address-bar settings');
}
function statCard(label, value, meta, glyph, color = '') { return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${glyph}</span></div><div class="stat-value" data-stat="${label}">${value}</div><div class="stat-meta">${meta}</div></article>`; }
function pageHeading(meta, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${meta.eyebrow}</div><h1>${meta.title}</h1><p>${meta.subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
function refreshSummaryCards() { const summary = liveData?.summary || {}; const values = { 'Total distance': summary.distance || '0.00 km', 'Driving time': summary.driving || '0 h 00 m', 'Idle time': summary.idle || '0 m', 'Active alerts': String(summary.alerts || 0), 'Distance travelled': summary.distance || '0.00 km', 'Running time': summary.driving || '0 h 00 m' }; document.querySelectorAll('[data-stat]').forEach(card => { if (values[card.dataset.stat] !== undefined) card.textContent = values[card.dataset.stat]; }); }
function carMarkerSvg() { return '<svg class="car-marker-svg" viewBox="0 0 64 40" aria-hidden="true"><path d="M13 5h38c4 0 7 3 8 7l3 10v9c0 3-2 5-5 5h-4a6 6 0 0 1-12 0H23a6 6 0 0 1-12 0H7c-3 0-5-2-5-5v-9L5 12c1-4 4-7 8-7Z" fill="currentColor" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M13 9h38c2 0 4 2 5 5l2 7H6l2-7c1-3 3-5 5-5Z" fill="rgba(255,255,255,.47)" stroke="rgba(255,255,255,.72)" stroke-width="1"/><path d="M8 25h48" stroke="rgba(255,255,255,.8)" stroke-width="2"/><rect x="8" y="27" width="7" height="4" rx="2" fill="#293b45" stroke="white" stroke-width="1"/><rect x="49" y="27" width="7" height="4" rx="2" fill="#293b45" stroke="white" stroke-width="1"/><circle cx="12" cy="10" r="2" fill="#fff3a6"/><circle cx="52" cy="10" r="2" fill="#fff3a6"/><path d="M19 35h26" stroke="#ff8b8b" stroke-width="2" stroke-linecap="round"/></svg>'; }
function trackerTypeStorageKey(id) { return `veyra-tracker-type:${id}`; }
function getTrackerType(id, fallback = 'car') { try { const saved = localStorage.getItem(trackerTypeStorageKey(id)); return ['man', 'women', 'car', 'bike', 'truck'].includes(saved) ? saved : fallback; } catch (_) { return fallback; } }
function setTrackerType(id, type) { try { localStorage.setItem(trackerTypeStorageKey(id), type); } catch (_) {} }
function trackerTypeLabel(type) { return ({ man: 'Man', women: 'Women', car: 'Car', bike: 'Bike', truck: 'Truck' })[type] || 'Car'; }
function trackerMarkerSvg(type) {
  if (type === 'man' || type === 'women') return '<svg class="person-marker-svg" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="8" r="5" fill="currentColor" stroke="white" stroke-width="2"/><path d="M24 15v14M16 22l8 5 8-5M24 29l-7 13M24 29l9 13" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (type === 'bike') return '<svg class="bike-marker-svg" viewBox="0 0 48 32" aria-hidden="true"><circle cx="10" cy="23" r="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="38" cy="23" r="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M10 23l9-13 7 13h12M19 10h8M18 14h9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  if (type === 'truck') return '<svg class="truck-marker-svg" viewBox="0 0 54 32" aria-hidden="true"><path d="M5 5h30v22H5zM35 13h8l6 6v8H35z" fill="currentColor" stroke="white" stroke-width="2" stroke-linejoin="round"/><path d="M38 15h5l4 5h-9z" fill="rgba(255,255,255,.55)"/><circle cx="15" cy="28" r="4" fill="#293b45" stroke="white" stroke-width="2"/><circle cx="43" cy="28" r="4" fill="#293b45" stroke="white" stroke-width="2"/></svg>';
  return carMarkerSvg();
}
function vehicleForDevice(link) { return link?.vehicleId ? vehicles.find(vehicle => vehicle.id === link.vehicleId) : null; }
function vehicleLabel(vehicle) { return vehicle ? `${vehicle.name} · ${vehicle.registration || vehicle.id}` : ''; }
function deviceLabel(link) { const vehicle = vehicleForDevice(link); return vehicle ? vehicleLabel(vehicle) : (link?.phone || 'Registered phone'); }
function vehicleIcon(vehicle) { return vehicle?.iconExplicit ? (vehicle.icon || '🚗') : '🚗'; }
function markerTypePicker(point) {
  const options = ['man', 'women', 'car', 'bike', 'truck'];
  return `<div class="marker-popup"><strong>${point.name}</strong><small>${point.status} · ${point.speed}</small><span class="marker-popup-label">Marker type</span><div class="marker-type-picker">${options.map(type => `<button type="button" class="marker-type-option ${point.trackerType === type ? 'selected' : ''}" data-marker-type="${type}" data-marker-id="${point.id}"><span class="marker-type-symbol tracker-${type}">${trackerMarkerSvg(type)}</span>${trackerTypeLabel(type)}</button>`).join('')}</div></div>`;
}
function bearingDegrees(from, to) { const rad = Math.PI / 180; const y = Math.sin((to.lng - from.lng) * rad) * Math.cos(to.lat * rad); const x = Math.cos(from.lat * rad) * Math.sin(to.lat * rad) - Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lng - from.lng) * rad); return Math.atan2(y, x) * 180 / Math.PI; }
function geoDistanceMeters(a, b) { const rad = Math.PI / 180; const dLat = (Number(b.lat) - Number(a.lat)) * rad; const dLng = (Number(b.lng) - Number(a.lng)) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(Number(a.lat) * rad) * Math.cos(Number(b.lat) * rad) * Math.sin(dLng / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); }
function footprintEvents(pointId) {
  const events = (liveData?.events || []).filter(event => (event.deviceLinkId === pointId || event.vehicleId === pointId) && Number.isFinite(Number(event.raw?.lat)) && Number.isFinite(Number(event.raw?.lng))).slice().sort((a, b) => new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0));
  const clean = [];
  events.forEach(event => {
    if (event.raw?.acceptedDistanceMeters === null) return;
    if (event.raw?.acceptedDistanceMeters === 0 && clean.length > 0) return;
    const previous = clean[clean.length - 1];
    if (previous) {
      const previousRaw = previous.raw || {}; const currentRaw = event.raw || {};
      const step = geoDistanceMeters(previousRaw, currentRaw);
      const accuracy = Math.max(Number(previousRaw.accuracy || 20), Number(currentRaw.accuracy || 20), 12);
      const gapSeconds = Math.max(1, Math.min(120, (new Date(event.receivedAt || 0).getTime() - new Date(previous.receivedAt || 0).getTime()) / 1000 || 10));
      const speed = Math.max(Number(previousRaw.speed || 0), Number(currentRaw.speed || 0));
      const plausibleSpeedKph = speed > 3 ? Math.max(speed * 1.8, 90) : 120;
      if (step <= Math.max(accuracy * 1.5, 15)) return;
      if (step > Math.max(accuracy * 1.5, 15) && step > Math.max(150, plausibleSpeedKph / 3.6 * gapSeconds)) return;
    }
    clean.push(event);
  });
  return clean.slice(-24);
}

async function loadBootstrap({ render = true } = {}) {
  try {
    const response = await fetch('/api/bootstrap');
    if (response.status === 401) { window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname)}`; return; }
    if (!response.ok) throw new Error('API unavailable');
    liveData = await response.json();
    vehicles = liveData.vehicles;
    state.role = liveData.session?.role || 'owner';
    const email = liveData.session?.email || liveData.session?.user || 'Admin';
    const initials = email.split('@')[0].slice(0, 2).toUpperCase();
    document.getElementById('userName').textContent = email;
    document.getElementById('userSubtitle').textContent = liveData.session?.role === 'owner' ? 'Admin account' : `Group member · ${liveData.session?.groupName || liveData.session?.workspace || 'Group dashboard'}`;
    document.getElementById('userInitials').textContent = initials;
    document.getElementById('topInitials').textContent = initials;
    document.getElementById('planSummary').textContent = `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} connected`;
    document.querySelector('[data-view="vehicles"] .nav-count').textContent = vehicles.length;
    const alerts = liveData.alerts || [];
    document.querySelector('.alert-count').textContent = alerts.filter(alert => alert.state === 'Open').length;
    updateNotificationBell(alerts);
    if (render) renderView(state.view);
    else { refreshLiveMap(); refreshSummaryCards(); }
    refreshCameraFeeds();
    refreshMicrophoneFeeds();
  } catch (error) { showToast('Could not load your fleet.'); }
}

function renderHome() {
  const summary = liveData?.summary || { distance: '0.00 km', driving: '0 h 00 m', idle: '0 m', alerts: 0 };
  const openAlerts = (liveData?.alerts || []).filter(alert => alert.state === 'Open').length;
  const alertLabel = openAlerts ? `${openAlerts} security item${openAlerts === 1 ? '' : 's'} need${openAlerts === 1 ? 's' : ''} your attention` : 'No active security alerts';
  const deviceCount = (liveData?.deviceLinks || []).length;
  return `${pageHeading(viewMeta.home, '<button class="btn" data-action="share">↗ Share access</button><button class="btn btn-primary" data-action="add">＋ Add vehicle</button>')}
    <div class="security-banner"><span class="banner-icon">⌁</span><div><strong>${alertLabel}</strong><p>${openAlerts ? 'Review the current alert details and connected-device status.' : 'Your workspace is ready. Connect a vehicle or mobile GPS device to begin.'}</p></div><button class="banner-link" data-nav="security">Review security →</button></div>
    <section class="stats-grid">
      ${statCard('Total distance', summary.distance, `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} connected`, '⌁')}
      ${statCard('Driving time', summary.driving, `${deviceCount} device${deviceCount === 1 ? '' : 's'} reporting`, '◷', 'blue')}
      ${statCard('Idle time', summary.idle, 'Measured GPS activity', '◌', 'orange')}
      ${statCard('Active alerts', String(summary.alerts || 0), openAlerts ? `${openAlerts} requires review` : 'Nothing requires review', '!', 'red')}
    </section>
    <div class="content-grid">
      ${renderMapPanel()}
      ${renderVehiclePanel()}
    </div>
    <div class="lower-grid">
      ${renderActivityPanel()}
      ${renderAlertsPanel()}
    </div>
    ${selectedCameraDeviceId ? renderCameraPanel(selectedCameraDeviceId) : ''}
    ${renderDevicePanel()}`;
}

function renderCameraPanel(deviceId = null) {
  const links = (liveData?.deviceLinks || []).filter(link => !deviceId || link.id === deviceId);
  const cards = links.length ? links.map(link => { const cameraOn = Boolean(link.cameraEnabled); return `<article class="camera-card"><div class="camera-preview"><img class="camera-feed" data-camera-feed="${link.id}" alt="Live vehicle camera" hidden><div class="camera-placeholder" data-camera-placeholder><div class="camera-preview-icon">▣</div><strong>${cameraOn ? 'Waiting for camera' : 'Camera off'}</strong><small>${cameraOn ? 'Grant camera permission on the phone' : 'Turn on from this dashboard'}</small></div><span class="camera-watermark">VEYRA · ADMIN VIEW</span></div><div class="camera-card-footer"><div><button class="device-number" data-device-open="${link.id}">${deviceLabel(link)}</button><small data-camera-state>${cameraOn ? `Camera ${link.cameraFacing || 'back'} · permission required` : 'Camera off by default'}</small><span class="mic-live-status" data-mic-audio="${link.id}" ${link.micEnabled ? '' : 'hidden'}>● Live microphone feed</span></div><div class="camera-actions"><button class="btn btn-sm ${cameraOn ? 'btn-danger' : 'btn-primary'}" data-camera-toggle="${link.id}">${cameraOn ? 'Camera off' : 'Camera on'}</button><select class="camera-facing" data-camera-facing="${link.id}" aria-label="Camera side"><option value="back" ${(link.cameraFacing || 'back') === 'back' ? 'selected' : ''}>Back camera</option><option value="front" ${link.cameraFacing === 'front' ? 'selected' : ''}>Front camera</option></select><button class="btn btn-sm ${link.micEnabled ? 'btn-danger' : ''}" data-mic-toggle="${link.id}">${link.micEnabled ? 'Mic off' : 'Mic on'}</button></div></div></article>`; }).join('') : '<div class="camera-empty"><span class="camera-preview-icon">▣</span><strong>No camera devices connected</strong><small>Pair a phone first, then connect its vehicle camera.</small></div>';
  return `<section class="panel camera-panel"><div class="panel-header"><div><div class="panel-title">Vehicle camera & microphone</div><div class="panel-subtitle">Shown only after selecting a registered number · camera and mic are off by default</div></div><div class="panel-actions"><button class="text-button" data-nav="reports">Daily report →</button><button class="text-button" data-camera-close>Close camera</button></div></div><div class="camera-grid">${cards}</div><div class="camera-notice">⌁ Camera and microphone are visible on the device. The device owner must grant permission; the dashboard only receives the authorized one-way feed.</div></section>`;
}

function renderMapPanel() {
  return `<section class="panel map-panel map-panel-3d"><div class="panel-header"><div><div class="panel-title">3D live locations</div><div class="panel-subtitle">Real GPS positions · depth view refreshes every 5 seconds</div></div><div class="panel-actions"><span class="map-view-badge">◈ 3D LIVE</span><span class="badge live" id="mapDeviceCount">0 devices</span></div></div><div id="liveMap" class="live-map" aria-label="3D live vehicle map"><div class="map-depth-grid" aria-hidden="true"></div><div class="map-empty-state" id="mapEmptyState" hidden><span>⌖</span><strong>Waiting for phone GPS</strong><small>Pair a phone and send its first location</small></div></div><div class="map-footer"><span><i class="map-key moving"></i>Moving <i class="map-key stopped"></i>Stopped</span><span id="mapSync">Waiting for GPS data</span></div></section>`;
}

function liveMapPoints() {
  const points = [];
  vehicles.forEach(vehicle => {
    if (vehicle.position?.lat && vehicle.position?.lng) points.push({ id: vehicle.id, name: vehicleLabel(vehicle), lat: vehicle.position.lat, lng: vehicle.position.lng, status: vehicle.status || 'Stopped', speed: vehicle.speed || '0 km/h', icon: vehicle.icon, trackerType: vehicle.trackerType || 'car' });
  });
  (liveData?.deviceLinks || []).filter(link => !link.vehicleId && link.lastPosition?.lat && link.lastPosition?.lng).forEach(link => points.push({ id: link.id, name: link.phone || 'Registered phone', lat: link.lastPosition.lat, lng: link.lastPosition.lng, status: link.status || 'Stopped', speed: `${Number(link.speed || 0)} km/h`, icon: '♙', trackerType: link.trackerType || 'car' }));
  points.forEach(point => { point.trackerType = getTrackerType(point.id, point.trackerType || 'car'); });
  return points;
}

function ensureGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve();
  if (googleMapsLoading) return googleMapsLoading;
  googleMapsLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.id = 'googleMapsScript'; script.async = true; script.defer = true; script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = resolve; script.onerror = () => reject(new Error('Google Maps could not load. Check the API key and Maps JavaScript API.')); document.head.appendChild(script);
  }).catch(error => { googleMapsLoading = null; throw error; });
  return googleMapsLoading;
}

function googleMarkerIcon(point, heading) {
  const color = point.status === 'Moving' ? '#e53935' : '#5278e8';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="16" fill="${color}" stroke="white" stroke-width="4"/><circle cx="23" cy="23" r="5" fill="white" fill-opacity=".92"/></svg>`;
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, scaledSize: new google.maps.Size(46, 46), anchor: new google.maps.Point(23, 23) };
}

async function refreshGoogleLiveMap(container) {
  try { await ensureGoogleMaps(liveData.mapConfig.googleMapsApiKey); } catch (error) { showToast(error.message); return; }
  if (!googleMap) {
    googleMap = new google.maps.Map(container, { center: { lat: 28.5672, lng: 77.2100 }, zoom: 12, mapTypeControl: true, streetViewControl: false, fullscreenControl: true, clickableIcons: false, gestureHandling: 'greedy' });
    googleInfoWindow = new google.maps.InfoWindow({ maxWidth: 260 });
  }
  const points = liveMapPoints();
  const pointIds = new Set(points.map(point => point.id));
  googleMarkers.forEach((marker, id) => { if (!pointIds.has(id)) { marker.setMap(null); googleMarkers.delete(id); const animation = googleMarkerAnimations.get(id); if (animation) cancelAnimationFrame(animation); googleMarkerAnimations.delete(id); } });
  googleTrailLayers.forEach(layer => layer.setMap(null)); googleTrailLayers = [];
  points.forEach(point => {
    const moving = point.status === 'Moving';
    const trailEvents = footprintEvents(point.id);
    const trailPoints = trailEvents.map(event => ({ lat: Number(event.raw.lat), lng: Number(event.raw.lng) }));
    if (trailPoints.length > 1) liveMarkerHeadings.set(point.id, bearingDegrees(trailPoints[trailPoints.length - 2], trailPoints[trailPoints.length - 1]));
    const heading = liveMarkerHeadings.get(point.id) || 0;
    let marker = googleMarkers.get(point.id);
    if (!marker) {
      marker = new google.maps.Marker({ map: googleMap, position: { lat: point.lat, lng: point.lng }, icon: googleMarkerIcon(point, heading), title: `${point.name} · ${point.status}`, optimized: false });
      marker.addListener('click', () => { googleInfoWindow.setContent(markerTypePicker(point)); googleInfoWindow.open({ map: googleMap, anchor: marker }); });
      googleMarkers.set(point.id, marker);
    } else {
      marker.setIcon(googleMarkerIcon(point, heading)); marker.setTitle(`${point.name} · ${point.status}`);
      const previous = marker.getPosition()?.toJSON(); const next = { lat: point.lat, lng: point.lng }; const distance = previous ? Math.abs(previous.lat - next.lat) + Math.abs(previous.lng - next.lng) : 0;
      const previousAnimation = googleMarkerAnimations.get(point.id); if (previousAnimation) cancelAnimationFrame(previousAnimation);
      if (previous && distance > 0.0000005) { const startedAt = performance.now(); const duration = Math.min(4200, Math.max(900, distance * 130000000)); const step = now => { const progress = Math.min(1, (now - startedAt) / duration); const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2; marker.setPosition({ lat: previous.lat + (next.lat - previous.lat) * eased, lng: previous.lng + (next.lng - previous.lng) * eased }); if (progress < 1) googleMarkerAnimations.set(point.id, requestAnimationFrame(step)); else googleMarkerAnimations.delete(point.id); }; googleMarkerAnimations.set(point.id, requestAnimationFrame(step)); } else marker.setPosition(next);
    }
    if (trailPoints.length > 1) googleTrailLayers.push(new google.maps.Polyline({ path: trailPoints, geodesic: true, strokeColor: moving ? '#0b9c91' : '#5278e8', strokeOpacity: .88, strokeWeight: 4, icons: moving ? [] : [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '14px' }], map: googleMap }));
  });
  const count = document.getElementById('mapDeviceCount'); if (count) count.textContent = `${points.length} live device${points.length === 1 ? '' : 's'}`;
  const sync = document.getElementById('mapSync'); if (sync) sync.textContent = points.length ? `Updated ${new Date().toLocaleTimeString()}` : 'Waiting for GPS data';
  const empty = document.getElementById('mapEmptyState'); if (empty) empty.hidden = Boolean(points.length);
  if (!document.body.dataset.googleMarkerTypeBound) { document.body.addEventListener('click', event => { const option = event.target.closest('.gm-style-iw [data-marker-type]'); if (option) { event.preventDefault(); saveTrackerType(option.dataset.markerId, option.dataset.markerType); } }); document.body.dataset.googleMarkerTypeBound = 'true'; }
  const viewKey = points.map(point => point.id).sort().join('|');
  if (viewKey !== liveMapViewKey) { if (points.length === 1) googleMap.setCenter({ lat: points[0].lat, lng: points[0].lng }); else if (points.length > 1) { const bounds = new google.maps.LatLngBounds(); points.forEach(point => bounds.extend({ lat: point.lat, lng: point.lng })); googleMap.fitBounds(bounds, 35); } liveMapViewKey = viewKey; }
}

function refreshLiveMap() {
  const container = document.getElementById('liveMap');
  if (!container) return;
  if (liveData?.mapConfig?.provider === 'google' && liveData.mapConfig.googleMapsApiKey) return refreshGoogleLiveMap(container);
  if (typeof L === 'undefined') return;
  if (!liveMap) {
    liveMap = L.map(container, { zoomControl: true }).setView([28.5672, 77.2100], 12);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20, maxNativeZoom: 19, subdomains: 'abcd', detectRetina: true, keepBuffer: 3, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }).addTo(liveMap);
  }
  const points = liveMapPoints();
  const pointIds = new Set(points.map(point => point.id));
  liveMarkers.forEach((marker, id) => { if (!pointIds.has(id)) { liveMap.removeLayer(marker); liveMarkers.delete(id); liveMarkerStates.delete(id); liveMarkerHeadings.delete(id); const animation = liveMarkerAnimations.get(id); if (animation) cancelAnimationFrame(animation); liveMarkerAnimations.delete(id); } });
  liveTrailLayers.forEach(layer => liveMap.removeLayer(layer));
  liveTrailLayers = [];
  points.forEach(point => {
    const moving = point.status === 'Moving';
    const trailEvents = footprintEvents(point.id);
    const trailPoints = trailEvents.map(event => [Number(event.raw.lat), Number(event.raw.lng)]);
    if (trailPoints.length > 1) liveMarkerHeadings.set(point.id, bearingDegrees({ lat: trailPoints[trailPoints.length - 2][0], lng: trailPoints[trailPoints.length - 2][1] }, { lat: trailPoints[trailPoints.length - 1][0], lng: trailPoints[trailPoints.length - 1][1] }));
    const heading = liveMarkerHeadings.get(point.id) || 0;
    const markerIcon = L.divIcon({ className: 'veyra-marker-wrap', html: `<span class="veyra-marker round-marker ${moving ? 'moving' : 'stopped'}" title="${point.name} · ${point.status}"><span class="round-marker-dot"></span></span>`, iconSize: [46, 46], iconAnchor: [23, 23] });
    const marker = liveMarkers.get(point.id);
    const nextPosition = [point.lat, point.lng];
    if (marker) {
      marker.setIcon(markerIcon);
      marker.setPopupContent(markerTypePicker(point));
      const previous = marker.getLatLng();
      const previousPosition = [Number(previous.lat), Number(previous.lng)];
      const distance = Math.abs(previousPosition[0] - nextPosition[0]) + Math.abs(previousPosition[1] - nextPosition[1]);
      const previousAnimation = liveMarkerAnimations.get(point.id);
      if (previousAnimation) cancelAnimationFrame(previousAnimation);
      if (distance > 0.0000005) {
        const startedAt = performance.now();
        const duration = Math.min(4200, Math.max(900, distance * 130000000));
        const step = now => {
          const progress = Math.min(1, (now - startedAt) / duration);
          const eased = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          marker.setLatLng([previousPosition[0] + (nextPosition[0] - previousPosition[0]) * eased, previousPosition[1] + (nextPosition[1] - previousPosition[1]) * eased]);
          if (progress < 1) liveMarkerAnimations.set(point.id, requestAnimationFrame(step));
          else { liveMarkerAnimations.delete(point.id); liveMarkerStates.set(point.id, { lat: point.lat, lng: point.lng }); }
        };
        liveMarkerAnimations.set(point.id, requestAnimationFrame(step));
      } else marker.setLatLng(nextPosition);
      liveMarkerStates.set(point.id, { lat: point.lat, lng: point.lng });
    } else { const created = L.marker(nextPosition, { icon: markerIcon }).addTo(liveMap); created.bindPopup(markerTypePicker(point), { maxWidth: 250 }); liveMarkers.set(point.id, created); liveMarkerStates.set(point.id, { lat: point.lat, lng: point.lng }); }
    if (trailPoints.length > 1) {
      liveTrailLayers.push(L.polyline(trailPoints, { color: '#ffffff', weight: 9, opacity: .58, lineCap: 'round', lineJoin: 'round' }).addTo(liveMap));
      liveTrailLayers.push(L.polyline(trailPoints, { color: moving ? '#0b9c91' : '#5278e8', weight: 4, opacity: .9, lineCap: 'round', lineJoin: 'round', dashArray: moving ? null : '7 8' }).addTo(liveMap));
    }
  });
  const count = document.getElementById('mapDeviceCount'); if (count) count.textContent = `${points.length} live device${points.length === 1 ? '' : 's'}`;
  const sync = document.getElementById('mapSync'); if (sync) sync.textContent = points.length ? `Updated ${new Date().toLocaleTimeString()}` : 'Waiting for GPS data';
  const empty = document.getElementById('mapEmptyState'); if (empty) empty.hidden = Boolean(points.length);
  if (!container.dataset.markerTypeBound) {
    container.addEventListener('click', event => { const option = event.target.closest('[data-marker-type]'); if (!option) return; event.preventDefault(); event.stopPropagation(); saveTrackerType(option.dataset.markerId, option.dataset.markerType); });
    container.dataset.markerTypeBound = 'true';
  }
  const viewKey = points.map(point => point.id).sort().join('|');
  if (viewKey !== liveMapViewKey) {
    if (points.length === 1) liveMap.setView([points[0].lat, points[0].lng], 13);
    else if (points.length > 1) liveMap.fitBounds(L.latLngBounds(points.map(point => [point.lat, point.lng])), { padding: [35, 35], maxZoom: 15 });
    liveMapViewKey = viewKey;
  }
  setTimeout(() => liveMap?.invalidateSize({ pan: false }), 100);
}

async function saveTrackerType(id, type) {
  setTrackerType(id, type);
  const isDevice = (liveData?.deviceLinks || []).some(link => link.id === id);
  const path = isDevice ? `/api/devices/${encodeURIComponent(id)}` : `/api/vehicles/${encodeURIComponent(id)}`;
  try {
    const response = await fetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackerType: type }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save marker type');
    if (isDevice) { const link = liveData.deviceLinks.find(item => item.id === id); if (link) link.trackerType = type; }
    else { const vehicle = vehicles.find(item => item.id === id); if (vehicle) vehicle.trackerType = type; }
    showToast(`${trackerTypeLabel(type)} marker selected`);
    refreshLiveMap();
    const marker = liveMarkers.get(id); if (marker) marker.openPopup();
  } catch (error) { showToast(error.message); }
}

function renderVehiclePanel() {
  const rows = vehicles.length ? vehicles.map((v, i) => `<button class="vehicle-row ${i === state.selectedVehicle ? 'selected' : ''}" data-vehicle="${i}"><span class="vehicle-photo">${vehicleIcon(v)}</span><span class="vehicle-info"><strong>${v.name}</strong><small>${v.registration || v.id}${v.model ? ` · ${v.model}` : ''} · ${v.location}</small></span><span class="vehicle-status"><strong class="${v.statusClass}">${v.status}</strong><small>${v.speed}</small></span></button>`).join('') : '<div class="empty-state" style="padding:22px 0">No vehicles added yet.</div>';
  return `<section class="panel vehicle-panel"><div class="panel-header"><div><div class="panel-title">Your vehicles</div><div class="panel-subtitle">Add your first vehicle to begin tracking.</div></div><button class="text-button" data-nav="vehicles">View all →</button></div><div class="vehicle-list">${rows}</div><div class="vehicle-footer"><button class="btn btn-sm" data-action="add" style="width:100%">＋ Connect another vehicle</button></div></section>`;
}

function renderActivityPanel() {
  const events = liveData?.events || [];
  const rows = events.length ? events.slice(0, 5).map(event => `<div class="activity-item">${icon('↗')}<div><strong>${event.type || 'Location'} update</strong><small>${event.quality || 'Measured'} · ${event.vehicleId || event.deviceLinkId || 'Mobile device'}</small></div><span class="activity-time">${new Date(event.receivedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') : '<div class="empty-state" style="padding:22px 0">No activity recorded yet.</div>';
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Today’s activity</div><div class="panel-subtitle">Your fleet events will appear here.</div></div><button class="text-button" data-nav="activity">Full activity →</button></div><div class="activity-list">${rows}</div></section>`;
}

function renderAlertsPanel() {
  const alerts = liveData?.alerts || [];
  const rows = alerts.length ? alerts.slice(0, 5).map((alert, index) => `<div class="alert-item ${index ? 'warning' : ''}">${icon(index ? '⌁' : '!')}<div><strong>${alert.title}</strong><small>${alert.detail}</small>${alert.type === 'overspeed' && alert.speed != null ? `<span class="alert-speed">Speed: ${Number(alert.speed).toFixed(1)} km/h · Limit: ${Number(alert.threshold || 90).toFixed(0)} km/h</span>` : ''}<span class="alert-time">${alertDateTime(alert)}</span><span class="alert-tag ${index ? 'warning' : ''}">${alert.state} · ${alert.severity}</span></div></div>`).join('') : '<div class="empty-state" style="padding:22px 0">No security alerts.</div>';
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Security inbox</div><div class="panel-subtitle">Alerts from your fleet will appear here.</div></div><button class="text-button" data-nav="security">Open inbox →</button></div><div class="alert-list">${rows}</div></section>`;
}

function renderDevicePanel() {
  const links = liveData?.deviceLinks || [];
  const rows = links.length ? links.slice().reverse().map(link => {
    const fresh = link.lastSeen && Date.now() - new Date(link.lastSeen).getTime() < 120000;
    const status = fresh ? (link.status || (Number(link.speed || 0) > 3 ? 'Moving' : 'Stopped')) : 'Offline';
    const badge = status === 'Moving' ? 'live' : status === 'Offline' ? 'warning' : 'parked';
    const lastSeen = link.lastSeen ? new Date(link.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not started';
    const position = link.lastPosition?.lat && link.lastPosition?.lng ? `<a class="text-button" href="https://www.google.com/maps/search/?api=1&query=${link.lastPosition.lat},${link.lastPosition.lng}" target="_blank" rel="noreferrer">Open location ↗</a>` : '';
    const policy = clientAlertPolicy(link.id);
    return `<div class="activity-item"><span class="vehicle-photo" style="width:34px;height:34px;font-size:17px">${vehicleIcon(vehicleForDevice(link))}</span><div class="device-row-main"><button class="device-number" data-device-open="${link.id}">${deviceLabel(link)}</button><small>${link.vehicleId ? `${vehicleLabel(vehicleForDevice(link)) || link.vehicleId}` : 'Phone only'} · Last seen ${lastSeen}${position ? ` · ${position}` : ''} · Speed ${Number(link.speed || 0).toFixed(1)} km/h · Camera ${link.cameraEnabled ? 'on' : 'off'} · Mic ${link.micEnabled ? 'on' : 'off'}</small><div class="alert-policy-controls"><span>Limit</span><button class="btn btn-sm" data-policy-adjust="-5" data-policy-target="${link.id}">−5</button><input class="policy-limit-input" data-policy-limit="${link.id}" type="number" min="10" max="300" value="${policy.thresholdKph}" aria-label="Speed limit for ${deviceLabel(link)}"><span>km/h</span><button class="btn btn-sm" data-policy-adjust="5" data-policy-target="${link.id}">+5</button><button class="btn btn-sm btn-primary" data-policy-save="${link.id}">Apply</button><button class="btn btn-sm ${policy.bellEnabled ? 'btn-primary' : ''}" data-policy-bell="${link.id}">${policy.bellEnabled ? '🔔 Bell on' : '🔕 Bell off'}</button></div><div class="device-controls" data-device-controls="${link.id}" hidden><button class="btn btn-sm ${link.cameraEnabled ? 'btn-danger' : 'btn-primary'}" data-camera-toggle="${link.id}">${link.cameraEnabled ? 'Camera off' : 'Camera on'}</button><select class="camera-facing" data-camera-facing="${link.id}" aria-label="Camera side"><option value="back" ${(link.cameraFacing || 'back') === 'back' ? 'selected' : ''}>Back camera</option><option value="front" ${link.cameraFacing === 'front' ? 'selected' : ''}>Front camera</option></select><button class="btn btn-sm ${link.micEnabled ? 'btn-danger' : ''}" data-mic-toggle="${link.id}">${link.micEnabled ? 'Mic off' : 'Mic on'}</button><button class="btn btn-sm" data-device-remove="${link.id}" title="Remove device">Delete</button></div></div><span class="badge ${badge}">● ${status}</span></div>`;
  }).join('') : '<div class="empty-state" style="padding:16px 0">No registered mobile devices yet.</div>';
  return `<section class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Registered phones</div><div class="panel-subtitle">Live movement from consented mobile devices · refreshes every 5 seconds</div></div><span class="badge live">${links.length} connected</span></div><div class="activity-list">${rows}</div></section>`;
}

function renderView(view = state.view) {
  state.view = view;
  if (liveMap) { liveMap.remove(); liveMap = null; }
  if (googleMap) { googleMarkers.forEach(marker => marker.setMap(null)); googleMarkers.clear(); googleTrailLayers.forEach(layer => layer.setMap(null)); googleTrailLayers = []; googleMarkerAnimations.forEach(animation => cancelAnimationFrame(animation)); googleMarkerAnimations.clear(); googleMap = null; googleInfoWindow = null; }
  liveMapViewKey = ''; liveMarkers.clear(); liveMarkerStates.clear(); liveMarkerHeadings.clear(); liveMarkerAnimations.forEach(animation => cancelAnimationFrame(animation)); liveMarkerAnimations.clear(); liveTrailLayers = [];
  const meta = viewMeta[view];
  document.getElementById('breadcrumbCurrent').textContent = meta.title.replace('Good morning, Arjun', 'Overview');
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  if (view === 'home') pageWrap.innerHTML = renderHome();
  else if (view === 'vehicles') pageWrap.innerHTML = renderVehicles();
  else if (view === 'activity') pageWrap.innerHTML = renderActivity();
  else if (view === 'security') pageWrap.innerHTML = renderSecurity();
  else if (view === 'trips') pageWrap.innerHTML = renderTrips();
  else if (view === 'maintenance') pageWrap.innerHTML = renderMaintenance();
  else if (view === 'reports') pageWrap.innerHTML = renderReports();
  else if (view === 'group') pageWrap.innerHTML = renderGroup();
  else pageWrap.innerHTML = renderSettings();
  pageWrap.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => renderView(el.dataset.nav)));
  pageWrap.querySelectorAll('[data-vehicle]').forEach(el => el.addEventListener('click', () => { state.selectedVehicle = Number(el.dataset.vehicle); showToast(`${vehicles[state.selectedVehicle].name} selected`); renderView('home'); }));
  pageWrap.querySelectorAll('[data-device-remove]').forEach(el => el.addEventListener('click', () => removeDevice(el.dataset.deviceRemove)));
  pageWrap.querySelectorAll('[data-mic-toggle]').forEach(el => el.addEventListener('click', () => toggleMicrophone(el.dataset.micToggle)));
  pageWrap.querySelectorAll('[data-device-open]').forEach(el => el.addEventListener('click', () => { selectedCameraDeviceId = el.dataset.deviceOpen; selectedReportDeviceId = el.dataset.deviceOpen; renderView('home'); }));
  pageWrap.querySelectorAll('[data-camera-close]').forEach(el => el.addEventListener('click', () => { selectedCameraDeviceId = null; renderView('home'); }));
  pageWrap.querySelectorAll('[data-camera-toggle]').forEach(el => el.addEventListener('click', () => toggleCamera(el.dataset.cameraToggle)));
  pageWrap.querySelectorAll('[data-camera-facing]').forEach(el => el.addEventListener('change', () => changeCameraFacing(el.dataset.cameraFacing, el.value)));
  pageWrap.querySelectorAll('[data-speed-adjust]').forEach(el => el.addEventListener('click', () => { const input = pageWrap.querySelector('[data-speed-limit]'); if (input) input.value = Math.max(10, Math.min(300, Number(input.value || 90) + Number(el.dataset.speedAdjust))); }));
  pageWrap.querySelectorAll('[data-speed-save]').forEach(el => el.addEventListener('click', saveOverspeedSettings));
  pageWrap.querySelectorAll('[data-bell-toggle]').forEach(el => el.addEventListener('click', toggleAlertBell));
  pageWrap.querySelectorAll('[data-policy-adjust]').forEach(el => el.addEventListener('click', () => { const input = pageWrap.querySelector(`[data-policy-limit="${CSS.escape(el.dataset.policyTarget)}"]`); if (input) input.value = Math.max(10, Math.min(300, Number(input.value || 90) + Number(el.dataset.policyAdjust))); }));
  pageWrap.querySelectorAll('[data-policy-save]').forEach(el => el.addEventListener('click', () => saveDeviceAlertPolicy(el.dataset.policySave)));
  pageWrap.querySelectorAll('[data-policy-bell]').forEach(el => el.addEventListener('click', () => toggleDeviceAlertBell(el.dataset.policyBell)));
  pageWrap.querySelectorAll('.report-action-card[data-report-card]').forEach(el => el.addEventListener('click', () => { const card = el.dataset.reportCard; if (card === 'daily') document.querySelector('.table-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (card === 'fuel') openFuelModal(); if (card === 'safety') openSafetyScorecard(); }));
  pageWrap.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => handleAction(el.dataset.action)));
  requestAnimationFrame(refreshLiveMap);
}

function renderVehicles() { return `${pageHeading(viewMeta.vehicles, '<button class="btn btn-primary" data-action="add">＋ Add vehicle</button>')}<div class="section-grid">${vehicles.map((v, i) => `<article class="section-card"><div style="display:flex;justify-content:space-between;align-items:start"><span class="vehicle-photo" style="width:43px;height:37px;font-size:19px">${vehicleIcon(v)}</span><span class="badge ${v.status === 'Parked' ? 'parked' : 'live'}">● ${v.status}</span></div><h3 style="margin-top:16px">${v.name}</h3><p>${v.registration || v.id}${v.model ? ` · ${v.model}` : ''}<br>${v.location}</p><div class="big-number">${v.km}</div><p>Distance today · <span class="confidence"><i></i>${i === 1 ? 'Stale' : 'Measured'}</span></p><button class="btn btn-sm" style="margin-top:12px;width:100%" data-vehicle="${i}">Open vehicle</button></article>`).join('')}</div><div class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Capability status</div><div class="panel-subtitle">Shown based on connected device support</div></div></div><div style="padding:4px 17px 10px"><div class="feature-row"><span>Live GPS position</span><span class="badge live">Available</span></div><div class="feature-row"><span>Ignition and idle logic</span><span class="badge live">Available</span></div><div class="feature-row"><span>Fuel anomaly detection</span><span class="badge warning">Hardware required</span></div><div class="feature-row"><span>Remote immobilization</span><span class="badge warning">Setup required</span></div></div></div>`; }
function renderActivity() {
  const events = liveData?.events || [];
  const rows = events.length ? events.map(event => `<tr><td>${event.vehicleId || event.deviceLinkId || 'Mobile device'}</td><td>${event.type || 'Position'}</td><td>${new Date(event.receivedAt || Date.now()).toLocaleString()}</td><td>${event.quality || 'Measured'}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No activity recorded yet.</td></tr>';
  return `${pageHeading(viewMeta.activity, '<button class="btn" data-action="export">Export view</button>')}<div class="stats-grid">${statCard('Distance travelled', liveData?.summary?.distance || '0.00 km', `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`, '⌁')}${statCard('Running time', liveData?.summary?.driving || '0 h 00 m', 'Measured GPS activity', '◷', 'blue')}${statCard('Idle time', liveData?.summary?.idle || '0 m', 'Stopped GPS intervals', '◌', 'orange')}${statCard('Active alerts', String(liveData?.summary?.alerts || 0), 'Open security alerts', '!', 'red')}</div><div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Vehicle activity</div><div class="panel-subtitle">Real events from your connected devices.</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Device</th><th>Type</th><th>Received</th><th>Quality</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function renderSecurity() {
  const alerts = liveData?.alerts || [];
  const openAlerts = alerts.filter(alert => alert.state === 'Open').length;
  const links = liveData?.deviceLinks || [];
  const geofences = liveData?.geofences || [];
  const securityMeta = { ...viewMeta.security, eyebrow: openAlerts ? `${openAlerts} item${openAlerts === 1 ? '' : 's'} need attention` : 'No active alerts' };
  const alertRows = alerts.length ? alerts.map((alert, index) => `<div class="alert-item ${index ? 'warning' : ''}">${icon(index ? '⌁' : '!')}<div><strong>${alert.title}</strong><small>${alert.detail}</small>${alert.type === 'overspeed' && alert.speed != null ? `<span class="alert-speed">Speed: ${Number(alert.speed).toFixed(1)} km/h · Limit: ${Number(alert.threshold || 90).toFixed(0)} km/h</span>` : ''}<span class="alert-time">${alertDateTime(alert)}</span><span class="alert-tag ${index ? 'warning' : ''}">${alert.state} · ${alert.severity}</span></div>${alert.state === 'Open' ? `<button class="btn btn-sm" data-action="ack">Acknowledge</button>` : '<button class="btn btn-sm" data-action="note">Add note</button>'}</div>`).join('') : '<div class="empty-state" style="padding:22px 0">No security alerts yet.</div>';
  return `${pageHeading(securityMeta, '<button class="btn btn-primary" data-action="geofence">＋ Add geofence</button>')}<div class="security-banner" style="margin-bottom:18px;background:#fff5f5;border-color:#f6d3d4"><span class="banner-icon" style="background:#fbdcdd;color:#bd4e55">!</span><div><strong>${openAlerts ? `${openAlerts} alert${openAlerts === 1 ? '' : 's'} still open` : 'No alerts currently open'}</strong><p>Alerts will appear here when a connected device reports a security event.</p></div><button class="banner-link" data-action="ack">Acknowledge all →</button></div><div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Alert inbox</div><div class="panel-subtitle">${alerts.length} alerts · sorted by severity</div></div></div><div class="alert-list">${alertRows}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Security controls</div><div class="panel-subtitle">Current workspace configuration</div></div></div><div style="padding:5px 17px 12px"><div class="feature-row"><span>Geofences</span><strong>${geofences.length}</strong></div><div class="feature-row"><span>Connected devices</span><strong>${links.length}</strong></div><div class="feature-row"><span>Theft mode</span><button class="btn btn-sm btn-danger" data-action="theft">Activate</button></div><div class="feature-row"><span>Remote immobilization</span><button class="btn btn-sm" data-action="immobilize">Review policy</button></div></div></section></div>`;
}
function renderTrips() { const events = (liveData?.events || []).filter(event => event.type === 'trip' || event.type === 'movement'); return `${pageHeading(viewMeta.trips, '<button class="btn btn-primary" data-action="trip">＋ Plan trip</button>')}<div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Recent trips</div><div class="panel-subtitle">Trips will appear after GPS movement is recorded.</div></div></div><div class="empty-state" style="padding:42px 20px">${events.length ? `${events.length} movement events recorded.` : 'No trips recorded yet.'}</div></div>`; }
function renderMaintenance() {
  const records = liveData?.maintenanceRecords || [];
  const now = Date.now(); const dueSoon = records.filter(record => record.nextDueDate && new Date(record.nextDueDate).getTime() >= now && new Date(record.nextDueDate).getTime() <= now + 30 * 86400000).length;
  const latest = records.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const defects = records.filter(record => String(record.status).toLowerCase().includes('defect')).length;
  const rows = records.length ? records.map(record => { const vehicle = vehicles.find(item => item.id === record.vehicleId); return `<tr><td><strong>${vehicleLabel(vehicle) || record.vehicleId}</strong><br><span class="muted">${record.type}</span></td><td>${record.date}</td><td>${record.nextDueDate || '—'}</td><td>₹${Number(record.cost || 0).toFixed(2)}</td><td>${record.status}</td><td>${record.notes || '—'}</td></tr>`; }).join('') : '<tr><td colspan="6" class="empty-state">No maintenance records yet. Add the first service entry.</td></tr>';
  return `${pageHeading(viewMeta.maintenance, '<button class="btn btn-primary" data-action="service">＋ Add service record</button>')}<div class="stats-grid">${statCard('Due soon', `${dueSoon} item${dueSoon === 1 ? '' : 's'}`, records.length ? 'Next 30 days' : 'No maintenance records yet', '⌕', 'orange')}${statCard('Documents current', String(records.length), records.length ? 'Service records saved' : 'Add documents when available', '▤', 'blue')}${statCard('Last service', latest?.date || '—', latest ? `${latest.type} · ${vehicleLabel(vehicles.find(item => item.id === latest.vehicleId)) || latest.vehicleId}` : 'No service history yet', '✓')}${statCard('Open defects', String(defects), defects ? 'Needs attention' : 'No defects recorded', '◈')}</div><div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Maintenance records</div><div class="panel-subtitle">Service, insurance and compliance history for your vehicles.</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Vehicle / service</th><th>Service date</th><th>Next due</th><th>Cost</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function recentReportExports() { try { return JSON.parse(localStorage.getItem('veyra-report-exports') || '[]'); } catch (_) { return []; } }
function reportTargetLabel(id) {
  const link = (liveData?.deviceLinks || []).find(item => item.id === id);
  return link ? deviceLabel(link) : (vehicles.find(vehicle => vehicle.id === id) ? vehicleLabel(vehicles.find(vehicle => vehicle.id === id)) : id);
}
function renderReports() {
  const reports = liveData?.dailyReports || [];
  const selected = selectedReportDeviceId ? reports.filter(report => report.deviceLinkId === selectedReportDeviceId) : reports;
  const speedReports = (liveData?.dailySpeedReports || []).filter(report => !selectedReportDeviceId || report.deviceLinkId === selectedReportDeviceId);
  const device = (liveData?.deviceLinks || []).find(link => link.id === selectedReportDeviceId);
  const fuelRecords = liveData?.fuelRecords || [];
  const fuelTotal = fuelRecords.reduce((sum, record) => sum + Number(record.cost || 0), 0);
  const rows = selected.length ? selected.map(report => `<tr><td>${reportTargetLabel(report.deviceLinkId)}</td><td>${report.day}</td><td><strong>${Number(report.km || 0).toFixed(2)} km</strong></td></tr>`).join('') : '<tr><td colspan="3" class="empty-state">No GPS distance recorded for the selected day.</td></tr>';
  const speedRows = speedReports.length ? speedReports.map(report => `<tr><td>${reportTargetLabel(report.deviceLinkId)}</td><td>${report.day}</td><td>${report.band}</td><td>${Number(report.minutes || 0).toFixed(1)} min</td><td><strong>${Number(report.km || 0).toFixed(2)} km</strong></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No speed history recorded yet.</td></tr>';
  const exportRows = recentReportExports().map(item => `<div class="feature-row"><span>${item.name}<br><span class="muted">${item.fields} fields · ${item.createdAt}</span></span><span class="badge live">Downloaded</span></div>`).join('') || '<div class="empty-state" style="padding:25px">No reports exported yet.</div>';
  const alerts = liveData?.alerts || [];
  const maxSpeed = Math.max(0, ...(liveData?.events || []).map(event => Number(event.raw?.speed || 0)));
  return `${pageHeading(viewMeta.reports, '<button class="btn btn-primary" data-action="report">＋ Download report</button>')}
    <div class="section-grid report-action-grid"><article class="section-card report-action-card" data-report-card="daily"><span class="stat-icon">⌁</span><h3 style="margin-top:14px">Daily activity</h3><p>Open per-day distance and speed history.</p><button class="btn btn-sm btn-primary" data-report-card="daily">Open daily report</button></article><article class="section-card report-action-card" data-report-card="fuel"><span class="stat-icon blue">◌</span><h3 style="margin-top:14px">Cost & fuel</h3><p>${fuelRecords.length ? `${fuelRecords.length} entries · ₹${fuelTotal.toFixed(2)} recorded` : 'Add fuel entries and track spend per vehicle.'}</p><button class="btn btn-sm" data-report-card="fuel">Add fuel entry</button></article><article class="section-card report-action-card" data-report-card="safety"><span class="stat-icon orange">◷</span><h3 style="margin-top:14px">Safety scorecard</h3><p>${alerts.length} alerts · highest recorded speed ${maxSpeed.toFixed(1)} km/h</p><button class="btn btn-sm" data-report-card="safety">Open safety scorecard</button></article></div>
    <div class="section-grid"><article class="section-card"><span class="stat-icon">⌁</span><h3 style="margin-top:14px">Selected vehicle</h3><p>${device ? deviceLabel(device) : 'All registered vehicles'}</p><div class="big-number">${selected.filter(report => report.day === reports[0]?.day).reduce((total, report) => total + Number(report.km || 0), 0).toFixed(2)} km</div><p>Today · filtered GPS distance${device ? ` · Live ${Number(device.speed || 0).toFixed(1)} km/h` : ''}</p></article><article class="section-card"><span class="stat-icon blue">◷</span><h3 style="margin-top:14px">Speed history</h3><p>Time and distance are grouped in 10 km/h bands from GPS samples.</p></article><article class="section-card"><span class="stat-icon orange">◌</span><h3 style="margin-top:14px">Report range</h3><p>Last 7 local days · timezone ${liveData?.settings?.timezone || 'Asia/Calcutta'}</p></article></div>
    <div class="panel table-panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Per-day distance report</div><div class="panel-subtitle">${device ? `Selected vehicle: ${deviceLabel(device)}` : 'All connected vehicles'}</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Vehicle</th><th>Date</th><th>Distance</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="panel table-panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Speed time & distance breakdown</div><div class="panel-subtitle">Each row shows time and kilometres recorded in that speed band.</div></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Vehicle</th><th>Date</th><th>Speed band</th><th>Time</th><th>Distance</th></tr></thead><tbody>${speedRows}</tbody></table></div></div>
    <div class="panel table-panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Recent exports</div><div class="panel-subtitle">Generated reports are kept in this admin browser.</div></div></div><div style="padding:4px 17px 12px">${exportRows}</div></div>`;
}
function renderGroup() {
  const members = liveData?.members || [];
  const groups = liveData?.groups || [];
  const admin = liveData?.session?.role === 'owner';
  const rows = members.length ? members.map(member => `<div class="feature-row"><span><strong>${member.name}</strong><br><span class="muted">${member.email || 'Approved member'} · ${member.role}</span></span><span class="badge ${member.state === 'Active' ? 'live' : 'warning'}">${member.state}</span></div>`).join('') : '<div class="empty-state" style="padding:22px 0">No approved group members yet.</div>';
  const groupRows = groups.length ? groups.map(group => { const memberCount = (liveData?.groupMembers || members).filter(member => member.groupId === group.id).length; const vehicleCount = vehicles.filter(vehicle => vehicle.groupId === group.id).length; return `<div class="group-card"><div><strong>${group.name}</strong><small>${memberCount} members · ${vehicleCount} vehicles</small></div><code>${group.code || 'Group code hidden'}</code></div>`; }).join('') : '<div class="empty-state" style="padding:22px 0">No groups created yet.</div>';
  const actions = admin ? '<button class="btn" data-action="create-group">＋ New group</button><button class="btn" data-action="assign-group">↗ Assign vehicle</button><button class="btn btn-primary" data-action="invite">＋ Add member</button>' : '';
  return `${pageHeading(viewMeta.group, actions)}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">${admin ? 'Your groups' : (liveData.session?.groupName || 'My group')}</div><div class="panel-subtitle">${admin ? 'Create family or fleet groups and share each code with approved members.' : 'You are viewing only the vehicles assigned to this group.'}</div></div></div><div style="padding:4px 17px 12px">${groupRows}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Members</div><div class="panel-subtitle">Group access is controlled by the Admin.</div></div></div><div style="padding:4px 17px 12px">${rows}</div></section></div><section class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Access rules</div><div class="panel-subtitle">Private group dashboards</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Group Code at login</span><span class="badge live">Required</span></div><div class="feature-row"><span>Admin approval</span><span class="badge live">Only for new groups</span></div><div class="feature-row"><span>Unassigned vehicles</span><span class="badge warning">Admin only</span></div></div></section>`;
}
function renderSettings() { const settings = liveData?.settings || {}; const threshold = Number(settings.overspeedThresholdKph || 90); const bellEnabled = settings.alertBellEnabled !== false; return `${pageHeading(viewMeta.settings, '<button class="btn" data-action="save">Save changes</button>')}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Workspace policies</div><div class="panel-subtitle">Set the speed limit and choose how overspeed alerts notify you.</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Overspeed limit</span><div class="setting-inline"><button class="btn btn-sm" data-speed-adjust="-5" aria-label="Lower speed limit by 5">−5</button><input class="speed-limit-input" data-speed-limit type="number" min="10" max="300" step="1" value="${threshold}" aria-label="Overspeed limit in kilometres per hour"><span>km/h</span><button class="btn btn-sm" data-speed-adjust="5" aria-label="Raise speed limit by 5">+5</button><button class="btn btn-sm btn-primary" data-speed-save>Apply</button></div></div><div class="feature-row"><span>Warning bell</span><button class="btn btn-sm ${bellEnabled ? 'btn-primary' : ''}" data-bell-toggle>${bellEnabled ? 'Bell on' : 'Bell off'}</button></div><div class="feature-row"><span>Waiting grace period</span><strong>${settings.waitingGraceMinutes ?? 5} minutes</strong></div><div class="feature-row"><span>Parking threshold</span><strong>${settings.parkingThresholdMinutes ?? 10} minutes</strong></div><div class="feature-row"><span>Local timezone</span><strong>${settings.timezone || 'Asia/Calcutta'}</strong></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Devices & integrations</div><div class="panel-subtitle">Connected sources in this workspace.</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Registered vehicles</span><strong>${vehicles.length}</strong></div><div class="feature-row"><span>Registered mobile devices</span><strong>${(liveData?.deviceLinks || []).length}</strong></div><div class="feature-row"><span>Mobile location</span><span class="badge live">Available</span></div><div class="feature-row"><span>Camera and microphone</span><span class="badge parked">Off until enabled</span></div></div></section></div>`; }

function handleAction(action) {
  if (action === 'add') return openAddVehicleModal();
  if (action === 'ack') return acknowledgeAlert('A-101');
  if (action === 'geofence') return openGeofenceModal();
  if (action === 'invite') return openInviteModal();
  if (action === 'create-group') return openCreateGroupModal();
  if (action === 'assign-group') return openAssignGroupModal();
  if (action === 'report') return openReportExportModal();
  if (action === 'service') return openServiceModal();
  const actions = {
    share: ['Share vehicle access', '<p>Choose what another person can see. You can change this at any time.</p><div class="modal-list"><div class="modal-check"><span>✓</span><span>Live location and last seen</span></div><div class="modal-check"><span>✓</span><span>Activity and trip history</span></div><div class="modal-check warning"><span>—</span><span>Commands and security controls</span></div></div><div class="modal-actions"><button class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" data-modal-save>Continue →</button></div>'],
    immobilize: ['Remote immobilization policy', '<p>This is an emergency capability. The command stays blocked until identity, connection, stationary state, and device acknowledgement all pass.</p><div class="modal-list"><div class="modal-check"><span>✓</span><span>Permission check · Owner</span></div><div class="modal-check"><span>✓</span><span>Current connection · Available</span></div><div class="modal-check warning"><span>!</span><span>Vehicle stationary check · Confirm at time of request</span></div></div><div class="modal-actions"><button class="btn" data-modal-close>Close</button><button class="btn btn-danger" data-modal-save>Begin verification</button></div>'],
    theft: ['Activate theft mode?', '<p>Veyra will increase monitoring frequency and notify your selected responders. You can turn it off from the alert timeline.</p><div class="modal-actions"><button class="btn" data-modal-close>Cancel</button><button class="btn btn-danger" data-modal-save>Activate theft mode</button></div>']
  };
  if (actions[action]) openModal(actions[action][0], actions[action][1]);
  else if (action === 'ack') { showToast('Alert acknowledged and assigned to you'); }
  else if (action === 'export' || action === 'download') showToast('Export prepared — permission check passed');
  else if (action === 'locate') showToast('Map centered on your active vehicle');
  else if (action === 'zoomIn' || action === 'zoomOut') showToast(action === 'zoomIn' ? 'Map zoomed in' : 'Map zoomed out');
  else if (action === 'save') showToast('Workspace settings saved');
  else if (action === 'note' || action === 'policy' || action === 'report' || action === 'invite' || action === 'geofence' || action === 'trip' || action === 'assign' || action === 'upload' || action === 'calendar') showToast('This workflow is ready for your next step');
}

async function saveOverspeedSettings() {
  const input = document.querySelector('[data-speed-limit]'); const threshold = Number(input?.value || 90);
  if (!Number.isFinite(threshold) || threshold < 10 || threshold > 300) return showToast('Speed limit must be between 10 and 300 km/h');
  try { const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overspeedThresholdKph: threshold }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update speed limit'); liveData.settings = { ...liveData.settings, ...result }; showToast(`Overspeed limit set to ${result.overspeedThresholdKph} km/h`); renderView('settings'); } catch (error) { showToast(error.message); }
}
async function toggleAlertBell() {
  const enabled = liveData?.settings?.alertBellEnabled === false;
  if (enabled) { unlockAlertBell(); await enableBrowserNotifications(); }
  try { const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertBellEnabled: enabled }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update warning bell'); liveData.settings = { ...liveData.settings, ...result }; showToast(enabled ? 'Warning bell on' : 'Warning bell off'); renderView('settings'); } catch (error) { showToast(error.message); }
}
async function saveDeviceAlertPolicy(targetId) {
  const input = document.querySelector(`[data-policy-limit="${CSS.escape(targetId)}"]`); const thresholdKph = Number(input?.value || 90);
  if (!Number.isFinite(thresholdKph) || thresholdKph < 10 || thresholdKph > 300) return showToast('Speed limit must be between 10 and 300 km/h');
  try { const response = await fetch(`/api/alert-policies/${encodeURIComponent(targetId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ thresholdKph }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update vehicle speed limit'); liveData.alertPolicies = { ...(liveData.alertPolicies || {}), [targetId]: result }; showToast(`Vehicle limit set to ${result.thresholdKph} km/h`); renderView('home'); } catch (error) { showToast(error.message); }
}
async function toggleDeviceAlertBell(targetId) {
  const current = clientAlertPolicy(targetId); const bellEnabled = !current.bellEnabled;
  if (bellEnabled) { unlockAlertBell(); await enableBrowserNotifications(); }
  try { const response = await fetch(`/api/alert-policies/${encodeURIComponent(targetId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bellEnabled }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update vehicle warning bell'); liveData.alertPolicies = { ...(liveData.alertPolicies || {}), [targetId]: result }; showToast(bellEnabled ? 'Vehicle warning bell on' : 'Vehicle warning bell off'); renderView('home'); } catch (error) { showToast(error.message); }
}

const reportFieldDefinitions = { device: 'Device / number', vehicle: 'Vehicle name', date: 'Date', time: 'Time', event: 'Event type', status: 'Moving / stopped status', speed: 'Live speed (km/h)', speedBand: 'Speed band', duration: 'Time in sample (minutes)', distance: 'Distance in sample (km)', accuracy: 'GPS accuracy (m)', quality: 'GPS quality', source: 'GPS source', overspeed: 'Overspeed status', camera: 'Camera status', microphone: 'Microphone status' };
function openReportExportModal() {
  const fields = Object.entries(reportFieldDefinitions).map(([value, label]) => `<label class="report-field-option"><input type="checkbox" name="reportField" value="${value}" checked><span>${label}</span></label>`).join('');
  openModal('Choose report fields', `<p>Latitude and Longitude are excluded. Select the columns you want in the CSV report.</p><form id="reportExportForm" class="modal-form"><label class="report-field-option report-select-all"><input type="checkbox" data-report-select-all checked><span>Select all fields</span></label><div class="report-field-grid">${fields}</div><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Download selected report</button></div></form>`);
  const form = document.getElementById('reportExportForm'); const selectAll = form.querySelector('[data-report-select-all]'); const boxes = [...form.querySelectorAll('input[name="reportField"]')];
  selectAll.addEventListener('change', () => boxes.forEach(box => { box.checked = selectAll.checked; }));
  boxes.forEach(box => box.addEventListener('change', () => { selectAll.checked = boxes.every(item => item.checked); }));
  form.addEventListener('submit', event => { event.preventDefault(); const selected = boxes.filter(box => box.checked).map(box => box.value); if (!selected.length) return showToast('Select at least one report field'); closeModal(); downloadReport(selected); });
}
function downloadReport(selectedFields = Object.keys(reportFieldDefinitions)) {
  const rows = [selectedFields.map(field => reportFieldDefinitions[field])]; const previousByDevice = new Map();
  const events = [...(liveData?.events || [])].sort((a, b) => new Date(a.receivedAt || 0) - new Date(b.receivedAt || 0));
  events.forEach(event => { const raw = event.raw || {}; const deviceId = event.deviceLinkId || event.vehicleId || 'Mobile device'; const link = (liveData?.deviceLinks || []).find(item => item.id === deviceId); const vehicle = vehicles.find(item => item.id === deviceId) || vehicles.find(item => item.id === link?.vehicleId); const time = new Date(event.receivedAt || Date.now()); const speed = Number(raw.speed || 0); const previous = previousByDevice.get(deviceId); const gapMinutes = previous ? Math.min(10, Math.max(0, (time.getTime() - previous.time.getTime()) / 60000)) : 0; const distanceKm = Number(raw.acceptedDistanceMeters) > 0 ? Number(raw.acceptedDistanceMeters) / 1000 : 0; const policy = clientAlertPolicy(deviceId); const values = { device: vehicle ? vehicleLabel(vehicle) : (link?.phone || deviceId), vehicle: vehicle?.name || 'Phone only', date: time.toLocaleDateString('en-IN'), time: time.toLocaleTimeString('en-IN'), event: event.type || 'Position', status: speed > 3 ? 'Moving' : 'Stopped', speed: speed.toFixed(1), speedBand: `${Math.floor(speed / 10) * 10}–${Math.floor(speed / 10) * 10 + 9} km/h`, duration: gapMinutes.toFixed(1), distance: distanceKm.toFixed(3), accuracy: Number(raw.accuracy || 0).toFixed(1), quality: event.quality || 'Measured', source: raw.source || 'GPS', overspeed: speed > policy.thresholdKph ? `Over ${policy.thresholdKph} km/h` : 'Normal', camera: link?.cameraEnabled ? 'On' : 'Off', microphone: link?.micEnabled ? 'On' : 'Off' }; rows.push(selectedFields.map(field => values[field] ?? '')); previousByDevice.set(deviceId, { time }); });
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `veyra-report-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); try { const history = recentReportExports(); history.unshift({ name: link.download, fields: selectedFields.length, createdAt: new Date().toLocaleString('en-IN') }); localStorage.setItem('veyra-report-exports', JSON.stringify(history.slice(0, 10))); } catch (_) {} showToast('Report downloaded successfully'); if (state.view === 'reports') renderView('reports');
}

function openFuelModal() {
  if (!vehicles.length) return showToast('Add a vehicle before entering fuel costs');
  const options = vehicles.map(vehicle => `<option value="${vehicle.id}">${vehicle.name} · ${vehicle.id}</option>`).join('');
  openModal('Add fuel entry', `<p>This entry will appear in Cost & fuel and stay linked to the selected vehicle.</p><form id="fuelForm" class="modal-form"><label>Vehicle<select name="vehicleId" required>${options}</select></label><label>Date<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label><label>Fuel litres<input name="liters" type="number" min="0.01" step="0.01" required placeholder="e.g. 35.50"></label><label>Total cost (₹)<input name="cost" type="number" min="0" step="0.01" required placeholder="e.g. 3200"></label><label>Odometer (optional)<input name="odometer" type="number" min="0" step="0.1" placeholder="e.g. 45210.5"></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Save fuel entry</button></div></form>`);
  document.getElementById('fuelForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); try { const response = await fetch('/api/fuel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save fuel entry'); closeModal(); showToast('Fuel entry saved'); await loadBootstrap(); renderView('reports'); } catch (error) { showToast(error.message); } });
}
function openSafetyScorecard() {
  const alerts = liveData?.alerts || []; const overspeed = alerts.filter(alert => alert.type === 'overspeed'); const open = alerts.filter(alert => alert.state === 'Open').length; const highest = Math.max(0, ...(liveData?.events || []).map(event => Number(event.raw?.speed || 0))); const movingEvents = (liveData?.events || []).filter(event => Number(event.raw?.speed || 0) > 3).length;
  openModal('Safety scorecard', `<p>Live safety metrics from the connected fleet.</p><div class="modal-list"><div class="feature-row"><span>Overspeed alerts</span><strong>${overspeed.length}</strong></div><div class="feature-row"><span>Open alerts</span><strong>${open}</strong></div><div class="feature-row"><span>Highest recorded speed</span><strong>${highest.toFixed(1)} km/h</strong></div><div class="feature-row"><span>Moving GPS samples</span><strong>${movingEvents}</strong></div></div><div class="modal-actions"><button class="btn btn-primary" data-modal-close>Close</button></div>`);
}

function openCameraConsentModal(deviceId) {
  openModal('Connect vehicle camera', `<p>This enables a one-way camera view for the authorized admin. The phone owner must grant camera permission, and Android will show a visible camera-active indicator while streaming.</p><div class="modal-list"><div class="modal-check"><span>✓</span><span>Admin can view the vehicle camera</span></div><div class="modal-check"><span>✓</span><span>Phone user cannot view the admin dashboard camera feed</span></div><div class="modal-check warning"><span>!</span><span>Camera permission and visible active status are required</span></div></div><div class="modal-actions"><button class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" data-modal-save>Continue on device</button></div>`);
}

async function refreshCameraFeeds() {
  const feeds = [...document.querySelectorAll('[data-camera-feed]')];
  await Promise.all(feeds.map(async feed => { try { const link = (liveData?.deviceLinks || []).find(item => item.id === feed.dataset.cameraFeed); if (!link?.cameraEnabled) return; const response = await fetch(`/api/camera/${encodeURIComponent(feed.dataset.cameraFeed)}`); if (!response.ok) return; const frame = await response.json(); if (!frame.image) return; feed.src = `data:${frame.contentType || 'image/jpeg'};base64,${frame.image}`; feed.hidden = false; const card = feed.closest('.camera-card'); card?.querySelector('[data-camera-placeholder]')?.setAttribute('hidden', ''); const state = card?.querySelector('[data-camera-state]'); if (state) state.textContent = `Live snapshot · ${new Date(frame.receivedAt).toLocaleTimeString()}`; } catch (_) {} }));
}

async function refreshMicrophoneFeeds() {
  const feeds = [...document.querySelectorAll('[data-mic-audio]')];
  await Promise.all(feeds.map(async status => { try { const response = await fetch(`/api/mic/${encodeURIComponent(status.dataset.micAudio)}`); if (!response.ok) return; const frame = await response.json(); if (!frame.audio) return; status.hidden = false; status.textContent = `● Live microphone · ${new Date(frame.receivedAt).toLocaleTimeString()}`; } catch (_) {} }));
}

async function toggleMicrophone(deviceId) {
  const link = (liveData?.deviceLinks || []).find(item => item.id === deviceId); if (!link) return;
  const enabled = !Boolean(link.micEnabled);
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ micEnabled: enabled }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update microphone');
    link.micEnabled = enabled; showToast(enabled ? 'Microphone on — waiting for phone permission and audio' : 'Microphone off'); renderView('home');
  } catch (error) { showToast(error.message); }
}

function toggleDeviceControls(deviceId) { const controls = document.querySelector(`[data-device-controls="${CSS.escape(deviceId)}"]`); if (controls) controls.hidden = !controls.hidden; }

async function toggleCamera(deviceId) {
  const link = (liveData?.deviceLinks || []).find(item => item.id === deviceId); if (!link) return;
  const enabled = !Boolean(link.cameraEnabled);
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cameraEnabled: enabled }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not update camera');
    link.cameraEnabled = enabled; showToast(enabled ? 'Camera on — waiting for phone permission and frames' : 'Camera off'); renderView('home');
  } catch (error) { showToast(error.message); }
}

async function changeCameraFacing(deviceId, cameraFacing) {
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cameraFacing }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not change camera');
    const link = (liveData?.deviceLinks || []).find(item => item.id === deviceId); if (link) link.cameraFacing = cameraFacing; showToast(`${cameraFacing === 'front' ? 'Front' : 'Back'} camera selected`);
  } catch (error) { showToast(error.message); }
}

function openServiceModal() {
  if (!vehicles.length) return showToast('Add a vehicle before adding a service record');
  const options = vehicles.map(vehicle => `<option value="${vehicle.id}">${vehicleLabel(vehicle)}</option>`).join('');
  openModal('Add service record', `<p>Save service, insurance or compliance work against a specific vehicle.</p><form id="serviceForm" class="modal-form"><label>Vehicle<select name="vehicleId" required>${options}</select></label><label>Service type<select name="type" required><option value="Routine service">Routine service</option><option value="Oil change">Oil change</option><option value="Tyre service">Tyre service</option><option value="Insurance renewal">Insurance renewal</option><option value="PUC / compliance">PUC / compliance</option><option value="Repair">Repair</option></select></label><label>Service date<input name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label><label>Next due date (optional)<input name="nextDueDate" type="date"></label><label>Cost (₹)<input name="cost" type="number" min="0" step="0.01" placeholder="e.g. 2500"></label><label>Odometer (optional)<input name="odometer" type="number" min="0" step="0.1" placeholder="e.g. 45210.5"></label><label>Status<select name="status"><option value="Completed">Completed</option><option value="Scheduled">Scheduled</option><option value="Open defect">Open defect</option></select></label><label>Notes (optional)<textarea name="notes" rows="3" placeholder="What was done or what needs attention?"></textarea></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Save service record</button></div></form>`);
  document.getElementById('serviceForm').addEventListener('submit', async event => {
    event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget));
    try { const response = await fetch('/api/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save service record'); closeModal(); showToast('Service record saved'); await loadBootstrap(); renderView('maintenance'); } catch (error) { showToast(error.message); }
  });
}

function openGeofenceModal() {
  openModal('Add a geofence', '<p>Geofences create calm, auditable boundaries for home, office, school or depot locations.</p><form id="geofenceForm" class="modal-form"><label>Geofence name<input name="name" required placeholder="e.g. Office parking" /></label><label>Type<select name="type"><option>Custom</option><option>Office</option><option>School</option><option>Depot</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Create geofence</button></div></form>');
  document.getElementById('geofenceForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/geofences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); showToast(`${result.name} geofence created`); await loadBootstrap(); renderView('security'); });
}

async function removeDevice(deviceId) {
  if (!deviceId || !window.confirm('Remove this device? It will stop sending locations.')) return;
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not remove device');
    showToast('Device removed. Its tracking token is no longer valid.');
    await loadBootstrap();
    renderView('home');
  } catch (error) { showToast(error.message); }
}

function openAssignGroupModal() {
  const groups = (liveData?.groups || []).map(group => `<option value="${group.id}">${group.name} · ${group.code || ''}</option>`).join('');
  const targets = [...vehicles.map(vehicle => `<option value="vehicle:${vehicle.id}">Vehicle · ${vehicleLabel(vehicle)}</option>`), ...(liveData?.deviceLinks || []).filter(link => !link.vehicleId).map(link => `<option value="device:${link.id}">Phone · ${link.phone || link.id}</option>`)].join('');
  if (!groups) return showToast('Create a group first.');
  if (!targets) return showToast('Add a vehicle or pair a phone first.');
  openModal('Assign a vehicle or phone to a group', '<p>The group member dashboard will show only assigned vehicles and live devices.</p><form id="assignGroupForm" class="modal-form"><label>Group<select name="groupId" required>' + groups + '</select></label><label>Vehicle or phone<select name="target" required>' + targets + '</select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Assign access</button></div></form>');
  document.getElementById('assignGroupForm').addEventListener('submit', async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); const [targetType, targetId] = values.target.split(':'); const response = await fetch('/api/groups/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: values.groupId, targetType, targetId }) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); showToast('Group access assigned'); await loadBootstrap(); renderView('group'); });
}
function openCreateGroupModal() {
  openModal('Register a new family or fleet group', '<p>Only the Admin can register a new group and create its first login. The Group Code is generated automatically.</p><form id="createGroupForm" class="modal-form"><label>Registration type<select name="registrationType" required><option value="individual">Individual</option><option value="family">Family group</option><option value="fleet">Fleet owner</option></select></label><label>Group name<input name="name" required placeholder="e.g. Sharma Family or Delhi Fleet" /></label><label>Registered user email<input name="email" type="email" required placeholder="fleetowner@example.com" /></label><label>Initial password <span class="optional">(leave blank to generate)</span><input name="password" type="password" minlength="8" placeholder="At least 8 characters" /></label><small>The registered user will sign in with this email and the generated Group Code. Password is shown once only.</small><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Register group</button></div></form>');
  document.getElementById('createGroupForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); openModal('Registration details', `<p>Registration complete. These details will stay visible until you press <strong>OK</strong>. Save the credentials before closing.</p><div class="group-registration-summary"><strong>${result.name}</strong><span>Type: ${({ individual: 'Individual', family: 'Family group', fleet: 'Fleet owner' })[result.registrationType] || 'Individual'}</span><span>Registered email: ${result.registeredEmail}</span><span>Initial password: <code>${result.initialPassword}</code></span><code>${result.code}</code><small>Use this email, password and Group Code to enter this group. The Admin account remains separate.</small></div><div class="modal-actions"><button class="btn btn-primary" data-modal-close>OK</button></div>`); await loadBootstrap(); renderView('group'); });
}
function openInviteModal() {
  const groups = (liveData?.groups || []).map(group => `<option value="${group.id}">${group.name} · ${group.code || ''}</option>`).join('');
  if (!groups) return showToast('Create a group first.');
  openModal('Add an approved group member', `<p>Admin creates this member account. The email, initial password and Group Code are shown once after approval.</p><form id="inviteForm" class="modal-form"><label>Group<select name="groupId" required>${groups}</select></label><label>Name<input name="name" required placeholder="e.g. Priya Rao" /></label><label>Member email<input name="email" type="email" required placeholder="priya@example.com" /></label><label>Initial password <span class="optional">(leave blank to generate)</span><input name="password" type="password" minlength="8" placeholder="At least 8 characters" /></label><label>Role<select name="role"><option>Household member</option><option>Viewer</option><option>Driver</option></select></label><label>Scope<select name="scope"><option>Selected vehicles</option><option>All vehicles</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Create member account</button></div></form>`);
  document.getElementById('inviteForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/group/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); openModal('Member registration details', `<p>These details remain visible until you press <strong>OK</strong>. Save them before closing.</p><div class="group-registration-summary"><strong>${result.name}</strong><span>Registered email: ${result.email}</span><span>Initial password: <code>${result.initialPassword}</code></span><small>Use this email and password with the Group Code to sign in. The member will only see assigned vehicles.</small></div><div class="modal-actions"><button class="btn btn-primary" data-modal-close>OK</button></div>`); await loadBootstrap(); renderView('group'); });
}

function openAddVehicleModal() {
  const links = liveData?.deviceLinks || [];
  const deviceOptions = links.length ? links.map(link => `<option value="${link.id}">${link.phone || 'Registered phone'}${link.vehicleId ? ` · currently ${vehicleLabel(vehicleForDevice(link))}` : ' · ready to connect'}</option>`).join('') : '<option value="">No registered phone yet — add vehicle only</option>';
  openModal('Connect a vehicle', `<p>Create the car profile, then connect the registered phone that sends its GPS location.</p><form id="vehicleForm" class="modal-form"><label>Car name<input name="name" required placeholder="e.g. Honda City" /></label><label>Model details<input name="model" placeholder="e.g. 2024 ZX CVT" /></label><label>Car / registration number<input name="registration" required placeholder="e.g. DL04GH1234" /></label><label>Connect registered phone<select name="deviceLinkId"><option value="">Do not connect yet</option>${deviceOptions}</select></label><label>Powertrain<select name="type"><option value="ICE">Petrol / diesel</option><option value="CNG">CNG</option><option value="EV">Electric vehicle</option></select></label><label>Car icon (optional)<input name="icon" maxlength="4" placeholder="Leave blank for 🚗" /></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Save & connect car</button></div></form>`);
  document.getElementById('vehicleForm').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add vehicle');
      closeModal();
      showToast(`${result.name} added to your garage`);
      await loadBootstrap();
      renderView('vehicles');
    } catch (error) { showToast(error.message); }
  });
  document.querySelectorAll('[data-modal-close]').forEach(el => el.addEventListener('click', closeModal));
}

async function acknowledgeAlert(id) {
  try {
    const response = await fetch(`/api/alerts/${id}/ack`, { method: 'PATCH' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not acknowledge alert');
    showToast('Alert acknowledged and added to the audit timeline');
    await loadBootstrap();
    renderView('security');
  } catch (error) { showToast(error.message); }
}

function openModal(title, body) { document.getElementById('modalContent').innerHTML = `<h2 id="modalTitle">${title}</h2>${body}`; document.getElementById('modalBackdrop').hidden = false; document.querySelectorAll('[data-modal-close]').forEach(el => el.addEventListener('click', closeModal)); document.querySelectorAll('[data-modal-save]').forEach(el => el.addEventListener('click', () => { closeModal(); showToast('Action recorded in the audit timeline'); })); }
function closeModal() { document.getElementById('modalBackdrop').hidden = true; }
function showToast(message) { clearTimeout(toastTimer); document.getElementById('toastMessage').textContent = message; toast.classList.add('show'); toastTimer = setTimeout(() => toast.classList.remove('show'), 2700); }

document.getElementById('sidebar').addEventListener('click', e => { const btn = e.target.closest('[data-view]'); if (btn) { renderView(btn.dataset.view); document.getElementById('sidebar').classList.remove('open'); } });
document.getElementById('workspaceSwitcher').addEventListener('click', () => showToast('Fleet workspace selected'));
document.getElementById('backButton').addEventListener('click', () => renderView('home'));
document.getElementById('mobileMenu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
document.getElementById('helpButton').addEventListener('click', () => openModal('Need a hand?', '<p>Veyra keeps tracking, activity intelligence, security and access in one calm workspace. Choose a screen from the left to explore the prototype.</p><div class="modal-actions"><button class="btn btn-primary" data-modal-close>Got it</button></div>'));
document.getElementById('notificationButton').addEventListener('click', async () => { unlockAlertBell(); await enableBrowserNotifications(); renderView('security'); });
document.getElementById('logoutButton').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; });
renderView('home');
loadBootstrap();
setInterval(() => {
  const active = document.activeElement;
  const modalOpen = !document.getElementById('modalBackdrop').hidden;
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName);
  if (!modalOpen && !editing) loadBootstrap({ render: false });
}, 5000);
