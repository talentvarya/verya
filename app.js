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
let liveData = null;
let liveMap = null;
let liveMapViewKey = '';
const liveMarkers = new Map();
const liveMarkerAnimations = new Map();
const liveMarkerStates = new Map();
let liveTrailLayers = [];
const pageWrap = document.getElementById('pageWrap');
const toast = document.getElementById('toast');
let toastTimer;

function icon(symbol, cls = '') { return `<span class="timeline-dot ${cls}">${symbol}</span>`; }
function statCard(label, value, meta, glyph, color = '') { return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${glyph}</span></div><div class="stat-value">${value}</div><div class="stat-meta">${meta}</div></article>`; }
function pageHeading(meta, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${meta.eyebrow}</div><h1>${meta.title}</h1><p>${meta.subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
function carMarkerSvg() { return '<svg class="car-marker-svg" viewBox="0 0 64 40" aria-hidden="true"><path d="M14 12 19 4h26l5 8 6 3c2 1 3 3 3 6v8H5v-8c0-3 1-5 4-6l5-3Z" fill="currentColor" stroke="white" stroke-width="2" stroke-linejoin="round"/><rect x="21" y="8" width="22" height="8" rx="2" fill="rgba(255,255,255,.48)"/><circle cx="17" cy="29" r="5" fill="#293b45" stroke="white" stroke-width="1.5"/><circle cx="47" cy="29" r="5" fill="#293b45" stroke="white" stroke-width="1.5"/><path d="M9 21h46" stroke="rgba(255,255,255,.8)" stroke-width="2" stroke-linecap="round"/></svg>'; }

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
    document.getElementById('userSubtitle').textContent = 'Admin account';
    document.getElementById('userInitials').textContent = initials;
    document.getElementById('topInitials').textContent = initials;
    document.getElementById('planSummary').textContent = `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} connected`;
    document.querySelector('[data-view="vehicles"] .nav-count').textContent = vehicles.length;
    document.querySelector('.alert-count').textContent = (liveData.alerts || []).filter(alert => alert.state === 'Open').length;
    if (render) renderView(state.view);
    else refreshLiveMap();
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
      ${statCard('Distance today', summary.distance, `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} connected`, '⌁')}
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
    ${renderDevicePanel()}`;
}

function renderMapPanel() {
  return `<section class="panel map-panel map-panel-3d"><div class="panel-header"><div><div class="panel-title">3D live locations</div><div class="panel-subtitle">Real GPS positions · depth view refreshes every 5 seconds</div></div><div class="panel-actions"><span class="map-view-badge">◈ 3D LIVE</span><span class="badge live" id="mapDeviceCount">0 devices</span></div></div><div id="liveMap" class="live-map" aria-label="3D live vehicle map"><div class="map-depth-grid" aria-hidden="true"></div><div class="map-empty-state" id="mapEmptyState" hidden><span>⌖</span><strong>Waiting for phone GPS</strong><small>Pair a phone and send its first location</small></div></div><div class="map-footer"><span><i class="map-key moving"></i>Moving <i class="map-key stopped"></i>Stopped</span><span id="mapSync">Waiting for GPS data</span></div></section>`;
}

function refreshLiveMap() {
  const container = document.getElementById('liveMap');
  if (!container || typeof L === 'undefined') return;
  if (!liveMap) {
    liveMap = L.map(container, { zoomControl: true }).setView([28.5672, 77.2100], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, keepBuffer: 2, attribution: '&copy; OpenStreetMap contributors' }).addTo(liveMap);
  }
  const points = [];
  vehicles.forEach(vehicle => {
    if (vehicle.position?.lat && vehicle.position?.lng) points.push({ id: vehicle.id, name: vehicle.name, lat: vehicle.position.lat, lng: vehicle.position.lng, status: vehicle.status || 'Stopped', speed: vehicle.speed || '0 km/h', icon: vehicle.icon });
  });
  (liveData?.deviceLinks || []).filter(link => !link.vehicleId && link.lastPosition?.lat && link.lastPosition?.lng).forEach(link => points.push({ id: link.id, name: link.phone || 'Registered phone', lat: link.lastPosition.lat, lng: link.lastPosition.lng, status: link.status || 'Stopped', speed: `${Number(link.speed || 0)} km/h`, icon: '♙' }));
  const pointIds = new Set(points.map(point => point.id));
  liveMarkers.forEach((marker, id) => { if (!pointIds.has(id)) { liveMap.removeLayer(marker); liveMarkers.delete(id); liveMarkerStates.delete(id); const animation = liveMarkerAnimations.get(id); if (animation) cancelAnimationFrame(animation); liveMarkerAnimations.delete(id); } });
  liveTrailLayers.forEach(layer => liveMap.removeLayer(layer));
  liveTrailLayers = [];
  points.forEach(point => {
    const moving = point.status === 'Moving';
    const markerIcon = L.divIcon({ className: 'veyra-marker-wrap', html: `<span class="veyra-marker ${moving ? 'moving' : 'stopped'}" title="${point.name} · ${point.status}"><span class="veyra-marker-icon">${carMarkerSvg()}</span></span>`, iconSize: [38, 38], iconAnchor: [19, 19] });
    const marker = liveMarkers.get(point.id);
    const nextPosition = [point.lat, point.lng];
    if (marker) {
      marker.setIcon(markerIcon);
      marker.setPopupContent(`<strong>${point.name}</strong><br>${point.status} · ${point.speed}`);
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
    } else { const created = L.marker(nextPosition, { icon: markerIcon }).addTo(liveMap); created.bindPopup(`<strong>${point.name}</strong><br>${point.status} · ${point.speed}`); liveMarkers.set(point.id, created); liveMarkerStates.set(point.id, { lat: point.lat, lng: point.lng }); }
    const trailEvents = (liveData?.events || []).filter(event => (event.deviceLinkId || event.vehicleId) === point.id && event.raw?.lat && event.raw?.lng).slice(0, 24).reverse();
    const trailPoints = trailEvents.map(event => [Number(event.raw.lat), Number(event.raw.lng)]);
    if (trailPoints.length > 1) {
      liveTrailLayers.push(L.polyline(trailPoints, { color: '#ffffff', weight: 9, opacity: .58, lineCap: 'round', lineJoin: 'round' }).addTo(liveMap));
      liveTrailLayers.push(L.polyline(trailPoints, { color: moving ? '#0b9c91' : '#5278e8', weight: 4, opacity: .9, lineCap: 'round', lineJoin: 'round', dashArray: moving ? null : '7 8' }).addTo(liveMap));
    }
  });
  const count = document.getElementById('mapDeviceCount'); if (count) count.textContent = `${points.length} live device${points.length === 1 ? '' : 's'}`;
  const sync = document.getElementById('mapSync'); if (sync) sync.textContent = points.length ? `Updated ${new Date().toLocaleTimeString()}` : 'Waiting for GPS data';
  const empty = document.getElementById('mapEmptyState'); if (empty) empty.hidden = Boolean(points.length);
  const viewKey = points.map(point => point.id).sort().join('|');
  if (viewKey !== liveMapViewKey) {
    if (points.length === 1) liveMap.setView([points[0].lat, points[0].lng], 13);
    else if (points.length > 1) liveMap.fitBounds(L.latLngBounds(points.map(point => [point.lat, point.lng])), { padding: [35, 35], maxZoom: 15 });
    liveMapViewKey = viewKey;
  }
  setTimeout(() => liveMap?.invalidateSize({ pan: false }), 100);
}

function renderVehiclePanel() {
  const rows = vehicles.length ? vehicles.map((v, i) => `<button class="vehicle-row ${i === state.selectedVehicle ? 'selected' : ''}" data-vehicle="${i}"><span class="vehicle-photo">${v.icon}</span><span class="vehicle-info"><strong>${v.name}</strong><small>${v.id} · ${v.location}</small></span><span class="vehicle-status"><strong class="${v.statusClass}">${v.status}</strong><small>${v.speed}</small></span></button>`).join('') : '<div class="empty-state" style="padding:22px 0">No vehicles added yet.</div>';
  return `<section class="panel vehicle-panel"><div class="panel-header"><div><div class="panel-title">Your vehicles</div><div class="panel-subtitle">Add your first vehicle to begin tracking.</div></div><button class="text-button" data-nav="vehicles">View all →</button></div><div class="vehicle-list">${rows}</div><div class="vehicle-footer"><button class="btn btn-sm" data-action="add" style="width:100%">＋ Connect another vehicle</button></div></section>`;
}

function renderActivityPanel() {
  const events = liveData?.events || [];
  const rows = events.length ? events.slice(0, 5).map(event => `<div class="activity-item">${icon('↗')}<div><strong>${event.type || 'Location'} update</strong><small>${event.quality || 'Measured'} · ${event.vehicleId || event.deviceLinkId || 'Mobile device'}</small></div><span class="activity-time">${new Date(event.receivedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>`).join('') : '<div class="empty-state" style="padding:22px 0">No activity recorded yet.</div>';
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Today’s activity</div><div class="panel-subtitle">Your fleet events will appear here.</div></div><button class="text-button" data-nav="activity">Full activity →</button></div><div class="activity-list">${rows}</div></section>`;
}

function renderAlertsPanel() {
  const alerts = liveData?.alerts || [];
  const rows = alerts.length ? alerts.slice(0, 5).map((alert, index) => `<div class="alert-item ${index ? 'warning' : ''}">${icon(index ? '⌁' : '!')}<div><strong>${alert.title}</strong><small>${alert.detail}</small><span class="alert-tag ${index ? 'warning' : ''}">${alert.state} · ${alert.severity}</span></div></div>`).join('') : '<div class="empty-state" style="padding:22px 0">No security alerts.</div>';
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Security inbox</div><div class="panel-subtitle">Alerts from your fleet will appear here.</div></div><button class="text-button" data-nav="security">Open inbox →</button></div><div class="alert-list">${rows}</div></section>`;
}

function renderDevicePanel() {
  const links = liveData?.deviceLinks || [];
  const vehicleNames = Object.fromEntries(vehicles.map(vehicle => [vehicle.id, vehicle.name]));
  const rows = links.length ? links.slice().reverse().map(link => {
    const fresh = link.lastSeen && Date.now() - new Date(link.lastSeen).getTime() < 120000;
    const status = fresh ? (link.status || (Number(link.speed || 0) > 3 ? 'Moving' : 'Stopped')) : 'Offline';
    const badge = status === 'Moving' ? 'live' : status === 'Offline' ? 'warning' : 'parked';
    const lastSeen = link.lastSeen ? new Date(link.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not started';
    const position = link.lastPosition?.lat && link.lastPosition?.lng ? `<a class="text-button" href="https://www.google.com/maps/search/?api=1&query=${link.lastPosition.lat},${link.lastPosition.lng}" target="_blank" rel="noreferrer">Open location ↗</a>` : '';
    return `<div class="activity-item"><span class="vehicle-photo" style="width:34px;height:34px;font-size:17px">♙</span><div><strong>${link.phone || 'Registered phone'}</strong><small>${link.vehicleId ? vehicleNames[link.vehicleId] || link.vehicleId : 'Phone only'} · Last seen ${lastSeen}${position ? ` · ${position}` : ''}</small></div><span class="badge ${badge}">● ${status}</span><button class="btn btn-sm" data-device-remove="${link.id}" title="Remove device">Delete</button></div>`;
  }).join('') : '<div class="empty-state" style="padding:16px 0">No registered mobile devices yet.</div>';
  return `<section class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Registered phones</div><div class="panel-subtitle">Live movement from consented mobile devices · refreshes every 5 seconds</div></div><span class="badge live">${links.length} connected</span></div><div class="activity-list">${rows}</div></section>`;
}

function renderView(view = state.view) {
  state.view = view;
  if (liveMap) { liveMap.remove(); liveMap = null; liveMapViewKey = ''; liveMarkers.clear(); liveMarkerStates.clear(); liveMarkerAnimations.forEach(animation => cancelAnimationFrame(animation)); liveMarkerAnimations.clear(); liveTrailLayers = []; }
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
  pageWrap.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => handleAction(el.dataset.action)));
  requestAnimationFrame(refreshLiveMap);
}

function renderVehicles() { return `${pageHeading(viewMeta.vehicles, '<button class="btn btn-primary" data-action="add">＋ Add vehicle</button>')}<div class="section-grid">${vehicles.map((v, i) => `<article class="section-card"><div style="display:flex;justify-content:space-between;align-items:start"><span class="vehicle-photo" style="width:43px;height:37px;font-size:19px">${v.icon}</span><span class="badge ${v.status === 'Parked' ? 'parked' : 'live'}">● ${v.status}</span></div><h3 style="margin-top:16px">${v.name}</h3><p>${v.id}<br>${v.location}</p><div class="big-number">${v.km}</div><p>Distance today · <span class="confidence"><i></i>${i === 1 ? 'Stale' : 'Measured'}</span></p><button class="btn btn-sm" style="margin-top:12px;width:100%" data-vehicle="${i}">Open vehicle</button></article>`).join('')}</div><div class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Capability status</div><div class="panel-subtitle">Shown based on connected device support</div></div></div><div style="padding:4px 17px 10px"><div class="feature-row"><span>Live GPS position</span><span class="badge live">Available</span></div><div class="feature-row"><span>Ignition and idle logic</span><span class="badge live">Available</span></div><div class="feature-row"><span>Fuel anomaly detection</span><span class="badge warning">Hardware required</span></div><div class="feature-row"><span>Remote immobilization</span><span class="badge warning">Setup required</span></div></div></div>`; }
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
  const alertRows = alerts.length ? alerts.map((alert, index) => `<div class="alert-item ${index ? 'warning' : ''}">${icon(index ? '⌁' : '!')}<div><strong>${alert.title}</strong><small>${alert.detail}</small><span class="alert-tag ${index ? 'warning' : ''}">${alert.state} · ${alert.severity}</span></div>${alert.state === 'Open' ? `<button class="btn btn-sm" data-action="ack">Acknowledge</button>` : '<button class="btn btn-sm" data-action="note">Add note</button>'}</div>`).join('') : '<div class="empty-state" style="padding:22px 0">No security alerts yet.</div>';
  return `${pageHeading(securityMeta, '<button class="btn btn-primary" data-action="geofence">＋ Add geofence</button>')}<div class="security-banner" style="margin-bottom:18px;background:#fff5f5;border-color:#f6d3d4"><span class="banner-icon" style="background:#fbdcdd;color:#bd4e55">!</span><div><strong>${openAlerts ? `${openAlerts} alert${openAlerts === 1 ? '' : 's'} still open` : 'No alerts currently open'}</strong><p>Alerts will appear here when a connected device reports a security event.</p></div><button class="banner-link" data-action="ack">Acknowledge all →</button></div><div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Alert inbox</div><div class="panel-subtitle">${alerts.length} alerts · sorted by severity</div></div></div><div class="alert-list">${alertRows}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Security controls</div><div class="panel-subtitle">Current workspace configuration</div></div></div><div style="padding:5px 17px 12px"><div class="feature-row"><span>Geofences</span><strong>${geofences.length}</strong></div><div class="feature-row"><span>Connected devices</span><strong>${links.length}</strong></div><div class="feature-row"><span>Theft mode</span><button class="btn btn-sm btn-danger" data-action="theft">Activate</button></div><div class="feature-row"><span>Remote immobilization</span><button class="btn btn-sm" data-action="immobilize">Review policy</button></div></div></section></div>`;
}
function renderTrips() { const events = (liveData?.events || []).filter(event => event.type === 'trip' || event.type === 'movement'); return `${pageHeading(viewMeta.trips, '<button class="btn btn-primary" data-action="trip">＋ Plan trip</button>')}<div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Recent trips</div><div class="panel-subtitle">Trips will appear after GPS movement is recorded.</div></div></div><div class="empty-state" style="padding:42px 20px">${events.length ? `${events.length} movement events recorded.` : 'No trips recorded yet.'}</div></div>`; }
function renderMaintenance() { return `${pageHeading(viewMeta.maintenance, '<button class="btn btn-primary" data-action="service">＋ Add service record</button>')}<div class="stats-grid">${statCard('Due soon','0 items','No maintenance records yet','⌕','orange')}${statCard('Documents current','0','Add documents when available','▤','blue')}${statCard('Last service','—','No service history yet','✓')}${statCard('Open defects','0','No defects recorded','◈')}</div><div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Maintenance records</div><div class="panel-subtitle">Service and compliance entries will appear here.</div></div></div><div class="empty-state" style="padding:42px 20px">No maintenance records yet.</div></div>`; }
function renderReports() { const events = liveData?.events || []; return `${pageHeading(viewMeta.reports, '<button class="btn btn-primary" data-action="report">＋ Build report</button>')}<div class="section-grid"><article class="section-card"><span class="stat-icon">⌁</span><h3 style="margin-top:14px">Daily activity</h3><p>${events.length ? 'Report is ready from recorded activity.' : 'Report becomes available after GPS activity is recorded.'}</p></article><article class="section-card"><span class="stat-icon blue">◌</span><h3 style="margin-top:14px">Cost & fuel</h3><p>Add vehicle and fuel records to build this report.</p></article><article class="section-card"><span class="stat-icon orange">◷</span><h3 style="margin-top:14px">Safety scorecard</h3><p>Safety trends appear after connected devices send data.</p></article></div><div class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Recent exports</div><div class="panel-subtitle">Generated reports will be listed here.</div></div></div><div class="empty-state" style="padding:32px 20px">No reports exported yet.</div></div>`; }
function renderGroup() {
  const members = liveData?.members || [];
  const rows = members.length ? members.map(member => `<div class="feature-row"><span><strong>${member.name}</strong><br><span class="muted">${member.role}</span></span><span class="badge ${member.state === 'Active' ? 'live' : 'warning'}">${member.state}</span></div>`).join('') : '<div class="empty-state" style="padding:22px 0">No members invited yet.</div>';
  return `${pageHeading(viewMeta.group, '<button class="btn btn-primary" data-action="invite">＋ Invite member</button>')}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Members</div><div class="panel-subtitle">Access is scoped by vehicle and role.</div></div></div><div style="padding:4px 17px 12px">${rows}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Sharing policy</div><div class="panel-subtitle">Private by default</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Location sharing</span><span class="badge live">Consent required</span></div><div class="feature-row"><span>Alert notifications</span><span class="badge live">Admin only</span></div></div></section></div>`;
}
function renderSettings() { const settings = liveData?.settings || {}; return `${pageHeading(viewMeta.settings, '<button class="btn btn-primary" data-action="save">Save changes</button>')}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Workspace policies</div><div class="panel-subtitle">Thresholds used for activity classification.</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Waiting grace period</span><strong>${settings.waitingGraceMinutes ?? 5} minutes</strong></div><div class="feature-row"><span>Parking threshold</span><strong>${settings.parkingThresholdMinutes ?? 10} minutes</strong></div><div class="feature-row"><span>Local timezone</span><strong>${settings.timezone || 'Asia/Calcutta'}</strong></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Devices & integrations</div><div class="panel-subtitle">Connected sources in this workspace.</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Registered vehicles</span><strong>${vehicles.length}</strong></div><div class="feature-row"><span>Registered mobile devices</span><strong>${(liveData?.deviceLinks || []).length}</strong></div><div class="feature-row"><span>Mobile location</span><span class="badge live">Available</span></div></div></section></div>`; }

function handleAction(action) {
  if (action === 'add') return openAddVehicleModal();
  if (action === 'ack') return acknowledgeAlert('A-101');
  if (action === 'geofence') return openGeofenceModal();
  if (action === 'invite') return openInviteModal();
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
  else if (action === 'note' || action === 'policy' || action === 'report' || action === 'service' || action === 'invite' || action === 'geofence' || action === 'trip' || action === 'assign' || action === 'upload' || action === 'calendar') showToast('This workflow is ready for your next step');
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

function openInviteModal() {
  openModal('Invite a household member', '<p>Access is scoped by role and vehicle. Invitations are recorded in the audit timeline.</p><form id="inviteForm" class="modal-form"><label>Name<input name="name" required placeholder="e.g. Priya Rao" /></label><label>Role<select name="role"><option>Household member</option><option>Viewer</option><option>Driver</option></select></label><label>Scope<select name="scope"><option>Selected vehicles</option><option>All vehicles</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Send invite</button></div></form>');
  document.getElementById('inviteForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/group/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); showToast(`Invite created for ${result.name}`); await loadBootstrap(); renderView('group'); });
}

function openAddVehicleModal() {
  openModal('Connect a vehicle', `<p>Add a vehicle profile now. A real tracker or mobile location source can be paired later.</p><form id="vehicleForm" class="modal-form"><label>Vehicle name<input name="name" required placeholder="e.g. Honda City" /></label><label>Registration number<input name="registration" required placeholder="e.g. DL04GH1234" /></label><label>Powertrain<select name="type"><option value="ICE">Petrol / diesel</option><option value="EV">Electric vehicle</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Add vehicle</button></div></form>`);
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

document.getElementById('primaryNav').addEventListener('click', e => { const btn = e.target.closest('[data-view]'); if (btn) { renderView(btn.dataset.view); document.getElementById('sidebar').classList.remove('open'); } });
document.getElementById('workspaceSwitcher').addEventListener('click', () => showToast('Fleet workspace selected'));
document.getElementById('mobileMenu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
document.getElementById('helpButton').addEventListener('click', () => openModal('Need a hand?', '<p>Veyra keeps tracking, activity intelligence, security and access in one calm workspace. Choose a screen from the left to explore the prototype.</p><div class="modal-actions"><button class="btn btn-primary" data-modal-close>Got it</button></div>'));
document.getElementById('notificationButton').addEventListener('click', () => { renderView('security'); showToast('Showing current security alerts'); });
document.getElementById('logoutButton').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login.html'; });
renderView('home');
loadBootstrap();
setInterval(() => {
  const active = document.activeElement;
  const modalOpen = !document.getElementById('modalBackdrop').hidden;
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName);
  if (!modalOpen && !editing) loadBootstrap({ render: false });
}, 5000);
