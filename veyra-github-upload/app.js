let vehicles = [
  { id: 'DL01AB1234', name: 'Toyota Innova', icon: '🚙', status: 'Moving', statusClass: 'status-live', location: 'Outer Ring Road · 2 min ago', speed: '48 km/h', km: '186.4 km', color: '#13a6a1', last: 'Live now' },
  { id: 'DL02CD7788', name: 'Hyundai Creta', icon: '🚗', status: 'Parked', statusClass: 'status-parked', location: 'Home garage · 14 min ago', speed: '—', km: '42.8 km', color: '#4e7bf2', last: '14 min ago' },
  { id: 'DL03EF9012', name: 'Tata Nexon EV', icon: '⚡', status: 'Charging', statusClass: 'status-live', location: 'Office parking · 31 min ago', speed: '—', km: '38.2 km', color: '#f59b45', last: '31 min ago' }
];

const viewMeta = {
  home: { title: 'Good morning, Arjun', eyebrow: 'Saturday, 19 September 2026', subtitle: 'Here’s the latest from your garage.' },
  vehicles: { title: 'Your vehicles', eyebrow: 'Garage', subtitle: 'A clear view of every connected vehicle and device.' },
  activity: { title: 'Activity intelligence', eyebrow: 'Today · All vehicles', subtitle: 'Movement, waiting, parking and idle time — classified with confidence.' },
  security: { title: 'Security center', eyebrow: '2 items need attention', subtitle: 'Review alerts, device health and safe response actions.' },
  trips: { title: 'Trips & route history', eyebrow: 'Recent movement', subtitle: 'Replay routes and understand planned versus actual movement.' },
  maintenance: { title: 'Maintenance & documents', eyebrow: '1 item due soon', subtitle: 'Keep service, insurance and compliance work visible.' },
  reports: { title: 'Reports', eyebrow: 'Insights', subtitle: 'Saved views for activity, costs, safety and compliance.' },
  group: { title: 'Group & access', eyebrow: 'Home garage', subtitle: 'Share the right vehicle data with the right people.' },
  settings: { title: 'Settings', eyebrow: 'Workspace controls', subtitle: 'Policies, devices, notifications and privacy.' }
};

let state = { view: 'home', workspace: 'home', selectedVehicle: 0 };
let liveData = null;
let liveMap = null;
const pageWrap = document.getElementById('pageWrap');
const toast = document.getElementById('toast');
let toastTimer;

function icon(symbol, cls = '') { return `<span class="timeline-dot ${cls}">${symbol}</span>`; }
function statCard(label, value, meta, glyph, color = '') { return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${glyph}</span></div><div class="stat-value">${value}</div><div class="stat-meta">${meta}</div></article>`; }
function pageHeading(meta, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${meta.eyebrow}</div><h1>${meta.title}</h1><p>${meta.subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }

async function loadBootstrap({ render = true } = {}) {
  try {
    const response = await fetch('/api/bootstrap');
    if (!response.ok) throw new Error('API unavailable');
    liveData = await response.json();
    vehicles = liveData.vehicles;
    state.role = liveData.session?.role || 'owner';
    document.getElementById('roleButton').textContent = `Demo role: ${state.role}`;
    if (render) renderView(state.view);
    else refreshLiveMap();
  } catch (error) {
    showToast('Demo mode active — start server.js for persistence');
  }
}

function renderHome() {
  const summary = liveData?.summary || { distance: '267.4 km', driving: '8 h 12 m', idle: '42 m', alerts: 2 };
  const openAlerts = liveData?.alerts?.filter(alert => alert.state === 'Open').length ?? 1;
  const alertLabel = `${openAlerts} security item${openAlerts === 1 ? '' : 's'} need${openAlerts === 1 ? 's' : ''} your attention`;
  return `${pageHeading(viewMeta.home, '<button class="btn" data-action="share">↗ Share access</button><button class="btn btn-primary" data-action="add">＋ Add vehicle</button>')}
    <div class="security-banner"><span class="banner-icon">⌁</span><div><strong>${alertLabel}</strong><p>${openAlerts ? 'Hyundai Creta has been offline for 14 minutes. Last known location is your home garage.' : 'All current alerts are acknowledged. Keep monitoring enabled for new events.'}</p></div><button class="banner-link" data-nav="security">Review alert →</button></div>
    <section class="stats-grid">
      ${statCard('Distance today', summary.distance, '<span class="positive">↑ 12.8%</span> vs last Saturday', '⌁')}
      ${statCard('Driving time', summary.driving, '<span class="positive">3 vehicles</span> reporting', '◷', 'blue')}
      ${statCard('Idle time', summary.idle, '<span class="warn">Estimated</span> · 2 incidents', '◌', 'orange')}
      ${statCard('Active alerts', String(summary.alerts), `<span class="negative">${openAlerts} requires review</span>`, '!', 'red')}
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
  return `<section class="panel map-panel"><div class="panel-header"><div><div class="panel-title">Live locations</div><div class="panel-subtitle">Updated just now · 3 of 3 devices connected</div></div><div class="panel-actions"><select class="select" id="mapFilter"><option>All vehicles</option><option>Moving only</option><option>Parked only</option></select></div></div><div class="map-canvas"><span class="map-label label-one">Hauz Khas</span><span class="map-label label-two">Green Park</span><span class="map-label label-three">Saket</span><span class="map-label label-four">Vasant Kunj</span><div class="map-road road-one"></div><div class="map-road road-two"></div><div class="map-road road-three"></div><div class="map-road road-four"></div><svg class="route-line" viewBox="0 0 700 340" preserveAspectRatio="none" aria-hidden="true"><path d="M 230 185 C 290 160, 300 115, 370 125 S 470 185, 530 176" fill="none" stroke="#13a6a1" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 10"/><path d="M 430 185 C 480 205, 510 240, 560 258" fill="none" stroke="#f59b45" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 8"/></svg><div class="map-pin pin-a"><span>🚙</span></div><div class="map-pin pin-b"><span>⚡</span></div><div class="map-pin pin-c"><span>🚗</span></div><div class="map-current"></div><div class="map-tooltip"><strong>Toyota Innova · Moving</strong><small>48 km/h · Outer Ring Road</small></div><div class="map-controls"><button data-action="zoomIn">＋</button><button data-action="zoomOut">−</button><button data-action="locate">⌾</button></div><div class="map-legend"><span class="legend-item"><i class="legend-dot" style="background:#13a6a1"></i>Moving</span><span class="legend-item"><i class="legend-dot" style="background:#4e7bf2"></i>Parked</span><span class="legend-item"><i class="legend-dot" style="background:#f59b45"></i>Charging</span></div></div><div class="map-footer"><span>Map confidence <strong>High</strong></span><span>Last sync <strong>10:42:18 AM</strong></span></div></section>`;
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
  liveMap.eachLayer(layer => { if (layer instanceof L.Marker) liveMap.removeLayer(layer); });
  points.forEach(point => {
    const moving = point.status === 'Moving';
    const marker = L.marker([point.lat, point.lng], { icon: L.divIcon({ className: 'veyra-marker-wrap', html: `<span class="veyra-marker ${moving ? 'moving' : 'stopped'}"><span class="veyra-marker-icon">${point.icon}</span></span>`, iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(liveMap);
    marker.bindPopup(`<strong>${point.name}</strong><br>${point.status} · ${point.speed}`);
  });
  const count = document.getElementById('mapDeviceCount'); if (count) count.textContent = `${points.length} live device${points.length === 1 ? '' : 's'}`;
  const sync = document.getElementById('mapSync'); if (sync) sync.textContent = points.length ? `Updated ${new Date().toLocaleTimeString()}` : 'Waiting for GPS data';
  const empty = document.getElementById('mapEmptyState'); if (empty) empty.hidden = Boolean(points.length);
  if (points.length === 1) liveMap.setView([points[0].lat, points[0].lng], 13);
  else if (points.length > 1) liveMap.fitBounds(L.latLngBounds(points.map(point => [point.lat, point.lng])), { padding: [35, 35], maxZoom: 15 });
  setTimeout(() => liveMap?.invalidateSize(), 0);
}

function renderVehiclePanel() {
  return `<section class="panel vehicle-panel"><div class="panel-header"><div><div class="panel-title">Your vehicles</div><div class="panel-subtitle">Tap to see live details</div></div><button class="text-button" data-nav="vehicles">View all →</button></div><div class="vehicle-list">${vehicles.map((v, i) => `<button class="vehicle-row ${i === state.selectedVehicle ? 'selected' : ''}" data-vehicle="${i}"><span class="vehicle-photo">${v.icon}</span><span class="vehicle-info"><strong>${v.name}</strong><small>${v.id} · ${v.location}</small></span><span class="vehicle-status"><strong class="${v.statusClass}">${v.status}</strong><small>${v.speed}</small></span></button>`).join('')}</div><div class="vehicle-footer"><button class="btn btn-sm" data-action="add" style="width:100%">＋ Connect another vehicle</button></div></section>`;
}

function renderActivityPanel() {
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Today’s activity</div><div class="panel-subtitle">All vehicles · Local time</div></div><button class="text-button" data-nav="activity">Full activity →</button></div><div class="activity-list"><div class="activity-item">${icon('↗')}<div><strong>Toyota Innova started a trip</strong><small>Outer Ring Road · Moving at 48 km/h · <span class="confidence"><i></i>Measured</span></small></div><span class="activity-time">10:38 AM</span></div><div class="activity-item">${icon('◌','orange')}<div><strong>Tata Nexon EV began charging</strong><small>Office parking · 68% battery · 2.4 kW</small></div><span class="activity-time">10:11 AM</span></div><div class="activity-item">${icon('⌂','blue')}<div><strong>Hyundai Creta parked at home</strong><small>Stationary for 14 min · GPS last seen <span class="confidence stale"><i></i>Stale</span></small></div><span class="activity-time">9:58 AM</span></div></div></section>`;
}

function renderAlertsPanel() {
  return `<section class="panel"><div class="panel-header"><div><div class="panel-title">Security inbox</div><div class="panel-subtitle">Alerts are assigned and traceable</div></div><button class="text-button" data-nav="security">Open inbox →</button></div><div class="alert-list"><div class="alert-item">${icon('!')}<div><strong>Device offline</strong><small>Hyundai Creta · Last seen at Home garage · 14 min ago</small><span class="alert-tag">Needs review</span></div><span class="activity-time">Medium</span></div><div class="alert-item warning">${icon('⌁')}<div><strong>Overspeed event recorded</strong><small>Toyota Innova · 92 km/h on Outer Ring Road · sustained 48 sec</small><span class="alert-tag warning">Acknowledged</span></div><span class="activity-time">Low</span></div></div></section>`;
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
    return `<div class="activity-item"><span class="vehicle-photo" style="width:34px;height:34px;font-size:17px">♙</span><div><strong>${link.phone || 'Registered phone'}</strong><small>${link.vehicleId ? vehicleNames[link.vehicleId] || link.vehicleId : 'Phone only'} · Last seen ${lastSeen}${position ? ` · ${position}` : ''}</small></div><span class="badge ${badge}">● ${status}</span></div>`;
  }).join('') : '<div class="empty-state" style="padding:16px 0">No registered mobile devices yet.</div>';
  return `<section class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Registered phones</div><div class="panel-subtitle">Live movement from consented mobile devices · refreshes every 5 seconds</div></div><span class="badge live">${links.length} connected</span></div><div class="activity-list">${rows}</div></section>`;
}

function renderView(view = state.view) {
  state.view = view;
  if (liveMap) { liveMap.remove(); liveMap = null; }
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
  pageWrap.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => handleAction(el.dataset.action)));
  requestAnimationFrame(refreshLiveMap);
}

function renderVehicles() { return `${pageHeading(viewMeta.vehicles, '<button class="btn btn-primary" data-action="add">＋ Add vehicle</button>')}<div class="section-grid">${vehicles.map((v, i) => `<article class="section-card"><div style="display:flex;justify-content:space-between;align-items:start"><span class="vehicle-photo" style="width:43px;height:37px;font-size:19px">${v.icon}</span><span class="badge ${v.status === 'Parked' ? 'parked' : 'live'}">● ${v.status}</span></div><h3 style="margin-top:16px">${v.name}</h3><p>${v.id}<br>${v.location}</p><div class="big-number">${v.km}</div><p>Distance today · <span class="confidence"><i></i>${i === 1 ? 'Stale' : 'Measured'}</span></p><button class="btn btn-sm" style="margin-top:12px;width:100%" data-vehicle="${i}">Open vehicle</button></article>`).join('')}</div><div class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Capability status</div><div class="panel-subtitle">Shown based on connected device support</div></div></div><div style="padding:4px 17px 10px"><div class="feature-row"><span>Live GPS position</span><span class="badge live">Available</span></div><div class="feature-row"><span>Ignition and idle logic</span><span class="badge live">Available</span></div><div class="feature-row"><span>Fuel anomaly detection</span><span class="badge warning">Hardware required</span></div><div class="feature-row"><span>Remote immobilization</span><span class="badge warning">Setup required</span></div></div></div>`; }
function renderActivity() { return `${pageHeading(viewMeta.activity, '<select class="select"><option>Today · 19 Sep</option><option>Yesterday · 18 Sep</option><option>Last 7 days</option></select><button class="btn" data-action="export">Export view</button>')}<div class="stats-grid">${statCard('Distance travelled','267.4 km','Across 3 vehicles','⌁')}${statCard('Running time','8 h 12 m','Validated movement','◷','blue')}${statCard('Parking events','4','3 h 17 m total','⌂','orange')}${statCard('Data quality','92%','High confidence','✓')}</div><div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Daily vehicle activity</div><div class="panel-subtitle">Movement is separated from waiting, parking and idle time using configured thresholds.</div></div><select class="select"><option>All vehicles</option><option>Toyota Innova</option><option>Hyundai Creta</option></select></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Vehicle</th><th>Distance</th><th>Driving</th><th>Waiting</th><th>Parking</th><th>Idle</th><th>Quality</th></tr></thead><tbody>${vehicles.map((v,i)=>`<tr><td><div class="vehicle-cell"><span class="mini-car">${v.icon}</span><strong>${v.name}</strong></div></td><td>${v.km}</td><td>${['6 h 48 m','1 h 09 m','0 h 15 m'][i]}</td><td>${['21 m','8 m','3 m'][i]}</td><td>${['2','1','1'][i]} events</td><td>${['42 m','—','—'][i]}</td><td><span class="confidence ${i === 1 ? 'stale' : ''}"><i></i>${i === 1 ? 'Stale' : 'Measured'}</span></td></tr>`).join('')}</tbody></table></div></div>`; }
function renderSecurity() {
  const alerts = liveData?.alerts || [{ id: 'A-101', title: 'Device offline · Hyundai Creta', detail: 'Last known location: Home garage · 14 min ago', severity: 'Medium', state: 'Open' }, { id: 'A-102', title: 'Sustained overspeed · Toyota Innova', detail: '92 km/h for 48 sec · Outer Ring Road · 10:31 AM', severity: 'Low', state: 'Acknowledged' }];
  const openAlerts = alerts.filter(alert => alert.state === 'Open').length;
  const securityMeta = { ...viewMeta.security, eyebrow: `${openAlerts} item${openAlerts === 1 ? '' : 's'} need attention` };
  return `${pageHeading(securityMeta, '<button class="btn btn-primary" data-action="geofence">＋ Add geofence</button>')}<div class="security-banner" style="margin-bottom:18px;background:#fff5f5;border-color:#f6d3d4"><span class="banner-icon" style="background:#fbdcdd;color:#bd4e55">!</span><div><strong>${openAlerts ? `${openAlerts} alert${openAlerts === 1 ? '' : 's'} still open` : 'All alerts acknowledged'}</strong><p>Every high-severity alert keeps an owner, evidence and escalation state.</p></div><button class="banner-link" data-action="ack">Acknowledge all →</button></div><div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Alert inbox</div><div class="panel-subtitle">${alerts.length} alerts · sorted by severity</div></div><select class="select"><option>All states</option><option>Open</option><option>Acknowledged</option></select></div><div class="alert-list">${alerts.map((alert, index) => `<div class="alert-item ${index ? 'warning' : ''}">${icon(index ? '⌁' : '!')}<div><strong>${alert.title}</strong><small>${alert.detail}<br>${index ? 'Evidence attached to today’s activity timeline.' : 'Network loss and power state are being checked separately.'}</small><span class="alert-tag ${index ? 'warning' : ''}">${alert.state} · ${alert.severity}</span></div>${alert.state === 'Open' ? `<button class="btn btn-sm" data-action="ack">Acknowledge</button>` : '<button class="btn btn-sm" data-action="note">Add note</button>'}</div>`).join('')}</div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Security controls</div><div class="panel-subtitle">Calm, explicit and permissioned</div></div></div><div style="padding:5px 17px 12px"><div class="feature-row"><span>Home geofence</span><span class="badge live">Active</span></div><div class="feature-row"><span>Off-hours monitoring</span><span class="badge live">10 PM – 6 AM</span></div><div class="feature-row"><span>Theft mode</span><button class="btn btn-sm btn-danger" data-action="theft">Activate</button></div><div class="feature-row"><span>Remote immobilization</span><button class="btn btn-sm" data-action="immobilize">Review policy</button></div><div class="feature-row"><span>Device health</span><span class="confidence"><i></i>2 healthy · 1 stale</span></div></div></section></div>`;
}
function renderTrips() { return `${pageHeading(viewMeta.trips, '<button class="btn btn-primary" data-action="trip">＋ Plan trip</button>')}<div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Recent trips</div><div class="panel-subtitle">Planned versus actual movement</div></div><select class="select"><option>All statuses</option><option>Completed</option><option>In progress</option></select></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Trip</th><th>Vehicle / driver</th><th>Route</th><th>Progress</th><th>Status</th><th></th></tr></thead><tbody><tr><td><strong>TRP-781</strong><br><span class="muted">Today · 08:40</span></td><td>Toyota Innova<br><span class="muted">Arjun Rao</span></td><td>Home → Gurugram → Home</td><td>3 / 3 stops</td><td><span class="badge live">Completed</span></td><td><button class="text-button" data-action="trip">Replay →</button></td></tr><tr><td><strong>TRP-780</strong><br><span class="muted">Today · 09:15</span></td><td>Hyundai Creta<br><span class="muted">Unassigned</span></td><td>Home → Saket</td><td>Not started</td><td><span class="badge warning">Unassigned</span></td><td><button class="text-button" data-action="assign">Assign →</button></td></tr><tr><td><strong>TRP-779</strong><br><span class="muted">Yesterday · 16:20</span></td><td>Tata Nexon EV<br><span class="muted">Meera Rao</span></td><td>Office → Vasant Kunj</td><td>2 / 2 stops</td><td><span class="badge parked">Completed</span></td><td><button class="text-button" data-action="trip">Replay →</button></td></tr></tbody></table></div></div>`; }
function renderMaintenance() { return `${pageHeading(viewMeta.maintenance, '<button class="btn btn-primary" data-action="service">＋ Add service record</button>')}<div class="stats-grid">${statCard('Due in 30 days','1 item','Hyundai Creta · service','⌕','orange')}${statCard('Documents current','8 / 9','One PUC renewal due','▤','blue')}${statCard('Last service','18 days ago','Toyota Innova','✓')}${statCard('Open defects','0','All inspections clear','◈')}</div><div class="panel table-panel"><div class="panel-header"><div><div class="panel-title">Due soon</div><div class="panel-subtitle">Maintenance and compliance reminders</div></div><button class="text-button" data-action="calendar">Open calendar →</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Vehicle</th><th>Due</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody><tr><td><strong>PUC renewal</strong><br><span class="muted">Document expiry</span></td><td>Hyundai Creta</td><td>26 Sep 2026</td><td>Arjun Rao</td><td><span class="badge warning">Due soon</span></td><td><button class="btn btn-sm" data-action="upload">Upload</button></td></tr><tr><td><strong>Annual service</strong><br><span class="muted">Time interval</span></td><td>Tata Nexon EV</td><td>14 Oct 2026</td><td>Arjun Rao</td><td><span class="badge live">On track</span></td><td><button class="text-button" data-action="service">Schedule →</button></td></tr></tbody></table></div></div>`; }
function renderReports() { return `${pageHeading(viewMeta.reports, '<button class="btn btn-primary" data-action="report">＋ Build report</button>')}<div class="section-grid"><article class="section-card"><span class="stat-icon">⌁</span><h3 style="margin-top:14px">Daily activity</h3><p>Distance, driving, parking, idle and route quality by vehicle.</p><button class="btn btn-sm" style="margin-top:15px" data-action="report">Open report →</button></article><article class="section-card"><span class="stat-icon blue">◌</span><h3 style="margin-top:14px">Cost & fuel</h3><p>Expenses, idle cost and cost per km with estimated values labeled.</p><button class="btn btn-sm" style="margin-top:15px" data-action="report">Open report →</button></article><article class="section-card"><span class="stat-icon orange">◷</span><h3 style="margin-top:14px">Safety scorecard</h3><p>Overspeed, harsh events, trends and coaching follow-up.</p><button class="btn btn-sm" style="margin-top:15px" data-action="report">Open report →</button></article></div><div class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Recent exports</div><div class="panel-subtitle">Exports respect your access and consent scope</div></div></div><div style="padding:4px 17px 10px"><div class="feature-row"><span><strong>September activity roll-up</strong><br><span class="muted">PDF · 3 vehicles · exported today</span></span><button class="text-button" data-action="download">Download →</button></div><div class="feature-row"><span><strong>Safety scorecard</strong><br><span class="muted">CSV · 2 drivers · exported 16 Sep</span></span><button class="text-button" data-action="download">Download →</button></div></div></div>`; }
function renderGroup() { return `${pageHeading(viewMeta.group, '<button class="btn btn-primary" data-action="invite">＋ Invite member</button>')}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Members</div><div class="panel-subtitle">Access is scoped by vehicle and role</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span><strong>Arjun Rao</strong><br><span class="muted">You · Owner</span></span><span class="badge live">All vehicles</span></div><div class="feature-row"><span><strong>Meera Rao</strong><br><span class="muted">Household member</span></span><span class="badge parked">2 vehicles</span></div><div class="feature-row"><span><strong>Rohan Mehta</strong><br><span class="muted">Viewer · invited</span></span><span class="badge warning">Pending</span></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Sharing policy</div><div class="panel-subtitle">Private by default</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Location sharing</span><span class="badge live">On</span></div><div class="feature-row"><span>Driver monitoring</span><span class="badge parked">Off</span></div><div class="feature-row"><span>Alert notifications</span><span class="badge live">Owner only</span></div><button class="btn btn-sm" style="margin-top:10px" data-action="policy">Edit policy</button></div></section></div>`; }
function renderSettings() { return `${pageHeading(viewMeta.settings, '<button class="btn btn-primary" data-action="save">Save changes</button>')}<div class="content-grid"><section class="panel"><div class="panel-header"><div><div class="panel-title">Workspace policies</div><div class="panel-subtitle">Thresholds used for activity classification</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Waiting grace period</span><strong>5 minutes</strong></div><div class="feature-row"><span>Parking threshold</span><strong>10 minutes</strong></div><div class="feature-row"><span>Overspeed margin</span><strong>+10 km/h</strong></div><div class="feature-row"><span>Local timezone</span><strong>Asia / Calcutta</strong></div><button class="btn btn-sm" style="margin-top:10px" data-action="policy">Edit thresholds</button></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Devices & integrations</div><div class="panel-subtitle">Vendor-neutral connections</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Veyra GPS · 3 devices</span><span class="badge live">Connected</span></div><div class="feature-row"><span>Mobile location</span><span class="badge parked">Available</span></div><div class="feature-row"><span>OBD / CAN gateway</span><span class="badge warning">Not connected</span></div><div class="feature-row"><span>Open API sandbox</span><span class="badge parked">Setup required</span></div></div></section></div><div class="panel" style="margin-top:18px"><div class="panel-header"><div><div class="panel-title">Privacy & audit</div><div class="panel-subtitle">Sensitive location data stays accountable</div></div></div><div style="padding:4px 17px 12px"><div class="feature-row"><span>Raw event retention</span><strong>90 days</strong></div><div class="feature-row"><span>Location sharing audit</span><span class="badge live">Enabled</span></div><div class="feature-row"><span>Two-factor authentication</span><span class="badge live">Enabled</span></div></div></div>`; }

function handleAction(action) {
  if (action === 'add') return openAddVehicleModal();
  if (action === 'ack') return acknowledgeAlert('A-101');
  if (action === 'simulate') return simulateGpsTick();
  if (action === 'geofence') return openGeofenceModal();
  if (action === 'invite') return openInviteModal();
  if (action === 'role') return openRoleModal();
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

async function simulateGpsTick() {
  try { const response = await fetch('/api/simulator/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: vehicles[state.selectedVehicle]?.id }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Simulation failed'); showToast(`${result.name} sent a simulated GPS ping`); await loadBootstrap(); } catch (error) { showToast(error.message); }
}

function openGeofenceModal() {
  openModal('Add a geofence', '<p>Geofences create calm, auditable boundaries for home, office, school or depot locations.</p><form id="geofenceForm" class="modal-form"><label>Geofence name<input name="name" required placeholder="e.g. Office parking" /></label><label>Type<select name="type"><option>Custom</option><option>Office</option><option>School</option><option>Depot</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Create geofence</button></div></form>');
  document.getElementById('geofenceForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/geofences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); showToast(`${result.name} geofence created`); await loadBootstrap(); renderView('security'); });
}

function openInviteModal() {
  openModal('Invite a household member', '<p>Access is scoped by role and vehicle. Invitations are recorded in the audit timeline.</p><form id="inviteForm" class="modal-form"><label>Name<input name="name" required placeholder="e.g. Priya Rao" /></label><label>Role<select name="role"><option>Household member</option><option>Viewer</option><option>Driver</option></select></label><label>Scope<select name="scope"><option>Selected vehicles</option><option>All vehicles</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Send invite</button></div></form>');
  document.getElementById('inviteForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/group/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); showToast(`Invite created for ${result.name}`); await loadBootstrap(); renderView('group'); });
}

function openRoleModal() {
  openModal('Demo session role', `<p>Use this local role switcher to verify permission boundaries before connecting a real identity provider. Current role: <strong>${state.role || 'owner'}</strong>.</p><form id="roleForm" class="modal-form"><label>Role<select name="role"><option value="owner">Owner — full access</option><option value="viewer">Viewer — read and export</option><option value="driver">Driver — assigned work</option><option value="responder">Safety responder — alerts</option></select></label><div class="modal-actions"><button type="button" class="btn" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Switch role</button></div></form>`);
  document.getElementById('roleForm').addEventListener('submit', async event => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget)); const response = await fetch('/api/session', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) return showToast(result.error); closeModal(); showToast(`Demo role switched to ${result.role}`); await loadBootstrap(); renderView('settings'); });
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
document.getElementById('workspaceSwitcher').addEventListener('click', () => { state.workspace = state.workspace === 'home' ? 'fleet' : 'home'; document.getElementById('workspaceName').textContent = state.workspace === 'home' ? 'Home garage' : 'Rao Logistics'; document.getElementById('breadcrumbRoot').textContent = state.workspace === 'home' ? 'Home garage' : 'Rao Logistics'; showToast(state.workspace === 'home' ? 'Switched to Home garage' : 'Switched to Rao Logistics'); });
document.getElementById('roleButton').addEventListener('click', () => openRoleModal());
document.getElementById('mobileMenu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
document.getElementById('helpButton').addEventListener('click', () => openModal('Need a hand?', '<p>Veyra keeps tracking, activity intelligence, security and access in one calm workspace. Choose a screen from the left to explore the prototype.</p><div class="modal-actions"><button class="btn btn-primary" data-modal-close>Got it</button></div>'));
document.getElementById('notificationButton').addEventListener('click', () => { renderView('security'); showToast('Showing your two active alerts'); });
document.getElementById('simulateButton').addEventListener('click', () => simulateGpsTick());
renderView('home');
loadBootstrap();
setInterval(() => {
  const active = document.activeElement;
  const modalOpen = !document.getElementById('modalBackdrop').hidden;
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName);
  if (!modalOpen && !editing) loadBootstrap({ render: false });
}, 5000);
