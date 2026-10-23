import { NAV, CLIENT_TABS, esc, isoDate, monthDays, todayKey, longDate, timeLabel } from './core.js';

const paths = {
  appointments: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M13 13h3M8 16.5h3M13 16.5h3"/>',
  notes: '<path d="M6.5 3.75h8.9l3.1 3.1v13.4H6.5z"/><path d="M15.4 3.75v3.1h3.1M9 11h7M9 14.5h7M9 18h4.5"/>',
  contacts: '<circle cx="8" cy="8" r="2.7"/><circle cx="16.3" cy="9" r="2.1"/><path d="M3.9 18.5c.5-3 2-4.7 4.1-4.7s3.6 1.7 4.1 4.7M12.8 18.5c.4-2.3 1.6-3.7 3.5-3.7 1.8 0 3 1.4 3.6 3.7"/>',
  build: '<path d="M7 3.5v17M7 6h4M7 10h3M7 14h4M7 18h3M14.3 8.5h4.2l1.5 11h-7.2zM14.8 8.5a1.6 1.6 0 0 1 3.2 0"/>',
  commissions: '<circle cx="12" cy="12" r="8.5"/><path d="M15.2 8.8c-.7-.8-1.7-1.2-3-1.2-1.8 0-3 .9-3 2.2 0 1.4 1.1 2 3.1 2.4 2 .4 2.9 1 2.9 2.3 0 1.4-1.2 2.4-3.2 2.4-1.4 0-2.6-.5-3.4-1.4M12 6v12"/>',
  client: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'
};
export const TOOLS = Object.freeze([
  ['appointments', 'Appointments', 'Appt', 'Set an appointment'],
  ['notes', 'Notes', 'Notes', 'Open dashboard notes'],
  ['contacts', 'Contacts', 'Contacts', 'Find company contacts'],
  ['build', 'Height & Weight', 'H&W', 'Open height and weight underwriting lookup'],
  ['commissions', 'Commissions', 'Comm', 'Open life and Medicare commissions']
]);
export const icon = (key, large = false) => `<span class="tool-icon tool-${key}${large ? ' large' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths[key] || paths.client}</svg></span>`;
export const empty = (title, copy = '') => `<div class="empty-state"><h3>${esc(title)}</h3>${copy ? `<p>${esc(copy)}</p>` : ''}</div>`;
export const note = text => `<div class="notice">${esc(text)}</div>`;
export const pending = 'The standalone database is not connected. No records have been loaded or saved.';
export const saveFooter = (label = 'Save Changes') => '<span class="dirty-state" data-dirty aria-live="polite">No changes</span><div class="footer-actions"><button type="button" class="btn secondary" data-close>Close</button><button type="button" class="btn primary" data-save="stay">' + esc(label) + '</button></div>';
export const options = (items, selected = '') => items.map(item => {
  const [value, label] = Array.isArray(item) ? item : [item, item];
  return `<option value="${esc(value)}"${String(selected) === String(value) ? ' selected' : ''}>${esc(label)}</option>`;
}).join('');
export function input(name, label, { type = 'text', placeholder = '', required = false, disabled = false, span = false, extra = '' } = {}) {
  return `<label class="field${span ? ' span-all' : ''}"><span>${esc(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</span><input name="${esc(name)}" type="${type}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''} ${extra}></label>`;
}
export const dateInput = (name, label, required = false) => input(name, label, { placeholder: 'MM/DD/YYYY', required, extra: 'data-date inputmode="numeric" maxlength="10"' });
export const select = (name, label, items, disabled = false) => `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}" ${disabled ? 'disabled' : ''}>${options(items)}</select></label>`;
export const textArea = (name, label, placeholder = '') => `<label class="field span-all"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="5" placeholder="${esc(placeholder)}"></textarea></label>`;
const group = (title, body, open = false) => `<details class="field-group"><summary>${esc(title)}</summary><div class="form-grid">${body}</div></details>`;
export function clientForm(connected, agents = []) {
  const sensitive = !connected;
  const general = input('first_name', 'First Name', { required: true }) + input('last_name', 'Last Name', { required: true }) +
    dateInput('date_of_birth', 'Date of Birth') + select('gender', 'Gender', [['', 'Select…'], 'Male', 'Female', 'Other', 'Not specified']) +
    input('email', 'Email', { type: 'email' }) + input('phone', 'Phone', { type: 'tel', placeholder: '(###) ###-####' }) +
    input('address', 'Address', { span: true }) + input('city', 'City') + input('county', 'County') + input('state', 'State') + input('zip', 'ZIP Code', { extra: 'inputmode="numeric"' }) +
    input('spouse', 'Spouse') +
    `<fieldset class="product-choices span-all"><legend>Products</legend>${['medicare', 'life', 'retirement'].map(p => `<label><input type="checkbox" name="product_${p}"> ${p[0].toUpperCase() + p.slice(1)}</label>`).join('')}</fieldset>`;
  const identity = (!connected ? '<p class="subtle span-all">Sensitive identifiers stay disabled until authentication and secure storage are connected.</p>' : '') +
    input('ssn', 'Social Security Number', { type: 'password', disabled: sensitive, extra: 'autocomplete="new-password"' }) +
    input('license_number', 'Driver’s License Number', { disabled: sensitive }) + dateInput('license_expiration', 'License Expiration') + input('license_state', 'License State');
  const medicare = input('medicare_number', 'Medicare Number', { disabled: sensitive }) + dateInput('part_a_date', 'Part A Date') + dateInput('part_b_date', 'Part B Date');
  const medicaid = input('medicaid_number', 'Medicaid Number', { disabled: sensitive }) +
    select('medicaid_level', 'Medicaid Level', [['', 'Select…'], 'None', 'QMB', 'QMB+', 'SLMB', 'SLMB+', 'QI', 'QDWI', 'FBDE']);
  const sunfire = input('sunfire_code', 'Sunfire Code', { placeholder: 'Enter Sunfire Code' });
  const health = input('health_carrier', 'Carrier / Original Medicare') + input('health_plan_id', 'Plan ID') + input('health_member_id', 'Member ID') + dateInput('health_effective_date', 'Effective Date') + input('health_premium', 'Monthly Premium', { type: 'number', extra: 'min="0" step="0.01"' });
  const oldPlan = '<div class="old-plan-details span-all"><div class="old-plan-heading"><strong>Old Plan Details</strong><small>Previous coverage information</small></div><div class="form-grid">' +
    select('old_plan_carrier', 'Insurance Company', [['','Select company…'],'Aetna','Humana','UnitedHealthcare','Cigna / HealthSpring','Devoted','Blue Cross Blue Shield','Wellcare','Original Medicare','Other']) +
    input('old_plan_id', 'Plan ID') + input('old_plan_member_id', 'Member ID') +
    input('old_plan_year', 'Year', {extra:'inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="2026"'}) +
    '</div></div>';
  const medicareNotes = textArea('medicare_notes', 'Notes', 'Enter Medicare-specific notes for this client...');
  const life = input('life_carrier', 'Carrier') + select('life_product', 'Product', [['', 'Select…'], 'Term', 'Whole Life', 'Final Expense', 'Universal Life', 'Indexed Universal Life']) + input('life_policy_number', 'Policy Number') +
    input('life_face_amount', 'Face Amount', { type: 'number', extra: 'min="0" step="0.01"' }) + input('life_premium', 'Premium', { type: 'number', extra: 'min="0" step="0.01"' }) + select('life_frequency', 'Premium Frequency', [['', 'Select…'], 'Monthly', 'Quarterly', 'Semiannual', 'Annual']) + dateInput('life_effective_date', 'Effective Date') + dateInput('life_expiration_date', 'Expiration Date') + input('beneficiary_name', 'Beneficiary') + input('beneficiary_relationship', 'Beneficiary Relationship') + textArea('life_notes', 'Life Notes');
  const retirement = input('retirement_carrier', 'Carrier / Institution') + input('retirement_product', 'Product') + input('retirement_contract', 'Contract Number') + dateInput('retirement_effective_date', 'Effective Date') + input('retirement_contribution', 'Contribution', { type: 'number', extra: 'min="0" step="0.01"' }) + input('retirement_value', 'Account Value', { type: 'number', extra: 'min="0" step="0.01"' }) + textArea('retirement_notes', 'Retirement Notes');
  const panels = {
    information: group('Personal & Contact Information', general, true) + group('Identification', identity),
    medicare: group('Medicare Information', medicare) + group('Medicaid Information', medicaid) + group('Sunfire', sunfire) + group('Health Plan Information', health + oldPlan) + group('Medicare Notes', medicareNotes) + note('Medicare cards and Scope of Appointment files belong in Documents.'),
    life: group('Life Policy Information', life, true), retirement: group('Retirement Information', retirement, true),
    documents: `<div class="panel-card"><h3>Client Documents &amp; SOA</h3><p class="subtle">Files, card photos, policy documents, and signed Scopes of Appointment belong to this client.</p><div class="document-actions"><label class="btn secondary disabled">Upload File<input type="file" disabled hidden></label><button type="button" class="btn secondary" disabled>Camera / Scan</button><button type="button" class="btn secondary" disabled>Send SOA</button></div>${empty('Secure storage not connected', 'Uploads and signatures will be enabled after the new storage and signing services are configured.')}</div>`,
    notes: group('Client Notes', textArea('notes', 'Notes', 'Client-specific notes'), true)
  };
  // The eight original panel IDs remain in the DOM for the saved-client
  // repository, Medicare uploads, pharmacy, and document integrations. Only
  // their presentation changes: four visible sections with focused cards.
  const categories = [
    ['medicare','Medicare & Current Coverage','Current plans, Medicare and Medicaid details',true],
    ['life','Life Insurance','Life policies and beneficiaries',false],
    ['hospital_indemnity','Hospital Indemnity','Hospital and supplemental coverage',false],
    ['retirement','Retirement','Retirement accounts and products',false],
    ['doctors','Doctors','Providers, specialties and office locations',true],
    ['medications','Medications & Pharmacies','Prescriptions, pharmacies and medication files',true]
  ];
  const category = (key,title,description,open) => '<details class="client-category" data-client-category="'+key+'">' +
    '<summary><span><strong>'+esc(title)+'</strong><small>'+esc(description)+'</small></span><span class="client-category-chevron" aria-hidden="true">⌄</span></summary>' +
    '<section class="client-category-body" id="client-panel-'+key+'" data-panel="'+key+'">'+(panels[key]||'')+'</section></details>';
  const categoryMarkup = keys => categories.filter(([key])=>keys.includes(key)).map(([key,title,description,open])=>category(key,title,description,open)).join('');
  const sections = [
    {key:'overview',label:'Overview',hint:'Personal information and client details'},
    {key:'coverage',label:'Coverage',hint:'Medicare, life, hospital indemnity and retirement'},
    {key:'medical',label:'Medical',hint:'Doctors, medications and pharmacies'},
    {key:'files',label:'Notes & Files',hint:'Client notes, forms and uploaded documents'}
  ];
  return '<form class="client-form client-four-tabs" autocomplete="off" novalidate>' +
    // These buttons are compatibility hooks for existing integrations which
    // programmatically select an original client section.
    '<div class="client-legacy-tabs" hidden aria-hidden="true">' +
      CLIENT_TABS.map(([key])=>'<button type="button" tabindex="-1" data-tab="'+key+'" id="client-tab-'+key+'"></button>').join('')+
    '</div>' +
    '<nav class="section-tabs client-main-tabs" role="tablist" aria-label="Client record sections">' +
      sections.map(({key,label},i)=>'<button type="button" role="tab" data-client-group-tab="'+key+'" id="client-group-tab-'+key+'" aria-controls="client-group-panel-'+key+'" aria-selected="'+String(i===0)+'" tabindex="'+(i===0?0:-1)+'">'+esc(label)+'</button>').join('')+'</nav>' +
    '<section role="tabpanel" data-client-group-panel="overview" id="client-group-panel-overview" aria-labelledby="client-group-tab-overview">' +
      '<div class="client-overview-card"><div><span class="client-overview-kicker">CLIENT AT A GLANCE</span><strong data-client-summary-name>Client information</strong><p data-client-summary-meta>Enter or review the client details below.</p></div>' +
      '<div class="client-overview-shortcuts"><button type="button" data-client-add-campaign>+ Add to Campaign</button><button type="button" data-client-add-appointment>+ Set Appointment</button></div></div>' +
      '<div class="client-glance-activity client-glance-reviews-layout"><section class="client-review-checkoff"><strong>Completed Reviews</strong><label><input type="checkbox" data-client-review-manual> Mark 2026 review complete (outside Athena)</label><span data-client-review-status class="subtle">Loading reviews…</span></section><details class="client-glance-notes-wide" data-client-glance-note-section><summary><strong>Client Note</strong><span class="client-glance-note-hint">Click to expand</span></summary><div class="client-glance-notes-body"><label class="field"><span>Editable note for this client</span><textarea data-client-glance-note rows="6" placeholder="Write or update the client note here…"></textarea></label><small class="subtle">Edit this note anytime. Select Save Client to keep your changes.</small></div></details></div>' +
      '<section id="client-panel-information" data-panel="information">'+panels.information+'</section></section>' +
    '<section role="tabpanel" data-client-group-panel="coverage" id="client-group-panel-coverage" aria-labelledby="client-group-tab-coverage" hidden>' +
      '<div class="client-group-heading"><strong>Insurance & Coverage</strong><p>Open only the type of coverage you need to review or update.</p></div>'+
      categoryMarkup(['medicare','life','hospital_indemnity','retirement'])+'</section>' +
    '<section role="tabpanel" data-client-group-panel="medical" id="client-group-panel-medical" aria-labelledby="client-group-tab-medical" hidden>' +
      '<div class="client-group-heading"><strong>Medical Information</strong><p>Doctors, current medications, pharmacies and supporting files.</p></div>'+
      categoryMarkup(['doctors','medications'])+'</section>' +
    '<section role="tabpanel" data-client-group-panel="files" id="client-group-panel-files" aria-labelledby="client-group-tab-files" hidden>' +
      '<div class="client-group-heading"><strong>Notes & Files</strong><p>Keep client notes and additional documents together. Medicare cards, SOA forms and policy documents remain accessible within their coverage sections.</p></div>'+
      '<section id="client-panel-notes" data-panel="notes">'+panels.notes+'</section></section>' +
    '</form>';
}
// The Home screen uses the already loaded appointment collection. No extra
// database request is needed for these dashboard totals or today's agenda.
export function dailyDashboardMarkup(events = [], loaded = false, date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const today = isoDate(date);
  const monthPrefix = today.slice(0,7);
  const openStatuses = new Set(['completed','cancelled','canceled','deleted']);
  const rows = Array.isArray(events) ? events : [];
  const active = rows.filter(e => !openStatuses.has(String(e.status||'').toLowerCase()));
  const todays = active.filter(e => e.event_date === today && e.status !== 'needs_reschedule')
    .sort((a,b) => String(a.start_time||'99:99').localeCompare(String(b.start_time||'99:99')));
  const followups = active.filter(e => e.status === 'needs_reschedule')
    .sort((a,b) => String(a.event_date||'').localeCompare(String(b.event_date||'')));
  const upcoming = active.filter(e => e.event_date > today && e.event_date?.startsWith(monthPrefix) && e.status !== 'needs_reschedule');
  const readableDate = date.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
  const metric = (label,value,note,kind) => '<article class="daily-stat daily-stat-'+kind+'"><span>'+esc(label)+'</span><strong>'+ (loaded ? String(value) : '—') +'</strong><small>'+esc(note)+'</small></article>';
  const appointment = e => '<button type="button" class="daily-agenda-item" data-daily-event-day="'+esc(e.event_date)+'">' +
      '<span class="daily-agenda-time">'+esc(timeLabel(e.start_time||''))+'</span>' +
      '<span class="daily-agenda-copy"><strong>'+esc(e.title||'Appointment')+'</strong><small>'+esc(e.event_type||'Appointment')+'</small></span>' +
      '<span aria-hidden="true" class="daily-agenda-arrow">›</span></button>';
  const followup = e => '<button type="button" class="daily-agenda-item" data-daily-open-followups>' +
    '<span class="daily-agenda-time daily-followup-date">'+esc(e.event_date||'Date not set')+'</span>' +
    '<span class="daily-agenda-copy"><strong>'+esc(e.title||'Follow-up')+'</strong><small>Needs rescheduling</small></span>' +
    '<span aria-hidden="true" class="daily-agenda-arrow">›</span></button>';
  return '<section class="daily-dashboard" aria-label="Daily work overview">' +
    '<header class="daily-hero"><div><span class="daily-date">'+esc(readableDate)+'</span><h2>Today\'s Work</h2><p>Appointments, follow-ups, and your next actions in one place.</p></div>' +
    '<div class="daily-hero-actions"><button type="button" class="btn primary" data-new-appointment>+ Appointment</button>' +
    '<button type="button" class="btn secondary" data-add-client>+ New Client</button>' +
    '<a class="btn secondary" href="#/clients">Find Client</a></div></header>' +
    '<div class="daily-stats" aria-label="Appointment overview">' +
    metric('Today',todays.length,'Active appointments','today') +
    metric('Follow-ups',followups.length,'Need rescheduling','followups') +
    metric('Coming up',upcoming.length,'Later this month','upcoming') + '</div>' +
    '<div class="daily-work-grid">' +
    '<section class="daily-work-section"><header><div><h3>Today\'s Schedule</h3><p>Your scheduled visits and calls</p></div>' +
    '<button type="button" class="daily-text-action" data-daily-open-today>View day →</button></header>' +
    '<div class="daily-work-list">' +
    (!loaded?'<p class="daily-empty" data-daily-loading>Loading today\'s schedule…</p>':
      todays.length?todays.slice(0,6).map(appointment).join('') :'<p class="daily-empty">No appointments scheduled for today.</p>')+
    '</div>'+ (loaded&&todays.length>6?'<button type="button" class="daily-more-action" data-daily-open-today>See all '+todays.length+' appointments →</button>':'')+
    '</section><section class="daily-work-section"><header><div><h3>Needs Attention</h3><p>Appointments awaiting a new date</p></div>' +
    '<button type="button" class="daily-text-action" data-daily-open-followups>View all →</button></header>' +
    '<div class="daily-work-list">' +
    (!loaded?'<p class="daily-empty">Loading follow-ups…</p>':
      followups.length?followups.slice(0,5).map(followup).join(''):'<p class="daily-empty">No appointments waiting to be rescheduled.</p>')+
    '</div>'+ (loaded&&followups.length>5?'<button type="button" class="daily-more-action" data-daily-open-followups>See all '+followups.length+' follow-ups →</button>':'') +
    '</section></div><div class="daily-work-footer">' +
    '<a class="daily-work-link" href="#/work">Open Work Queue →</a>' +
    '<button type="button" class="daily-text-action" data-daily-open-calendar>Open monthly calendar ↓</button>' +
    '</div></section>';
}

export function calendarMarkup(month, events = [], connected = false, agents = []) {
  const days = monthDays(month.getFullYear(), month.getMonth());
  const today = todayKey();
  // Index the events once. Filtering the entire list for every calendar day
  // makes rendering increasingly slow as appointment history grows.
  const eventsByDate = new Map();
  let todayCount = 0;
  let pendingCount = 0;
  for (const event of events) {
    const status=String(event.status||'').toLowerCase();
    if (status === 'needs_reschedule') { pendingCount++; continue; }
    // Completed or cancelled entries stay in their history, not on the active calendar.
    if (['completed','cancelled','canceled','deleted'].includes(status)) continue;
    if (event.event_date === today) todayCount++;
    const date = event.event_date;
    if (!date) continue;
    let dayEvents = eventsByDate.get(date);
    if (!dayEvents) { dayEvents = []; eventsByDate.set(date, dayEvents); }
    dayEvents.push(event);
  }
  return `<section class="dashboard-calendar"><div class="calendar-queues"><button class="today-queue" type="button" data-queue="today">TODAY’S APPOINTMENTS <span>${connected ? todayCount : '—'}</span></button><button class="reschedule-queue" type="button" data-queue="reschedule">RESCHEDULE <span>${connected ? pendingCount : '—'}</span></button></div><div class="calendar-card"><div class="calendar-head"><div><h2>Calendar</h2><p class="calendar-legend">${agents.length ? agents.map(a => `<span><i></i>${esc(a.full_name)}</span>`).join('') : 'Appointments & activities'}</p></div><div class="calendar-actions"><button type="button" class="btn primary" data-new-appointment>+ ADD APPOINTMENT / ACTIVITY</button><div class="calendar-controls"><button type="button" class="btn secondary" data-month="-1" aria-label="Previous month">‹</button><button type="button" class="btn secondary" data-month="today">Today</button><button type="button" class="btn secondary" data-month="1" aria-label="Next month">›</button></div></div></div><h3 class="calendar-month" aria-live="polite">${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3><p class="calendar-status" role="status">${connected ? '' : 'Calendar layout is ready. Scheduling is not connected yet.'}</p><div class="calendar-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<div class="calendar-weekday">${day}</div>`).join('')}${days.map(day => {
    const key = isoDate(day), entries = eventsByDate.get(key) || [];
    return `<button type="button" class="calendar-day${day.getMonth() !== month.getMonth() ? ' outside' : ''}${key === today ? ' today' : ''}" data-day="${key}" aria-label="${longDate(key)}${connected ? `, ${entries.length} items` : ''}"${key === today ? ' aria-current="date"' : ''}><span class="day-number">${day.getDate()}</span><span class="day-events">${entries.slice(0, 3).map(e => `<span class="calendar-event"><small>${esc(timeLabel(e.start_time))}</small><strong>${esc(e.title)}</strong></span>`).join('')}${entries.length > 3 ? `<small>+${entries.length - 3} more</small>` : ''}</span><span class="day-dots">${entries.slice(0, 4).map(() => '<i></i>').join('')}</span></button>`;
  }).join('')}</div></div></section>`;
}

const NAV_SYMBOLS = Object.freeze({
  home:'<path d="m3 10 9-7 9 7v10h-6v-6H9v6H3z"/>',
  clients:'<circle cx="12" cy="7.5" r="3.5"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  medicare:'<path d="M12 21s-8-4.5-8-10.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8C20 16.5 12 21 12 21Z"/><path d="M8 12h8m-4-4v8"/>',
  work:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  messages:'<path d="M20 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/><path d="M7 10h9m-9 4h6"/>',
  more:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'
});
const navSymbol = key => '<svg class="nav-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' + NAV_SYMBOLS[key] + '</svg>';
const navLink = (route, text, current) => '<a class="nav-child' + (route===current?' active':'') + '" href="#/' + route + '"' + (route===current?' aria-current="page"':'') + '>' + esc(text) + '</a>';
const navAction = (tool, text) => '<button type="button" class="nav-child nav-action" data-tool="' + tool + '">' + esc(text) + '</button>';

export function navigationMarkup(route) {
  const medicareActive=['athena-medicare','ma-plans'].includes(route);
  const workActive=['work','campaigns'].includes(route);
  const moreActive=['carriers','agents','settings'].includes(route);
  const direct=(key,label,iconKey=key)=>{
    const active=route===key;
    return '<a class="nav-primary' + (active?' active':'') + '" href="#/' + key + '"' + (active?' aria-current="page"':'') + '>' + navSymbol(iconKey) + '<span>' + esc(label) + '</span></a>';
  };
  const group=(section,title,href,iconKey,active,children)=>{
    return '<div class="nav-section nav-section-' + section + '" data-nav-section="' + section + '">' +
      '<div class="nav-line"><a class="nav-primary' + (active?' active':'') + '" href="#/' + href + '"' +
      (route===href?' aria-current="page"':'') + '>' + navSymbol(iconKey) + '<span>' + esc(title) + '</span></a>' +
      '<button type="button" class="nav-expander" data-nav-toggle="' + section + '" aria-expanded="' + String(active) +
      '" aria-controls="nav-children-' + section + '" aria-label="Show ' + esc(title) + ' options"><span aria-hidden="true">⌄</span></button></div>' +
      '<div class="nav-children" id="nav-children-' + section + '"' + (active?'':' hidden') + '>' + children + '</div></div>';
  };
  // Keep the five daily shortcuts in the persistent toolbar; other
  // administration and reporting destinations remain under More.
  const moreChildren=navLink('carriers','Carriers',route)+navLink('agents','Agents & Admin',route)+
    navAction('commissions','Commissions');
  const more='<div class="nav-section nav-section-more" data-nav-section="more">' +
    '<button type="button" class="nav-primary nav-more-trigger'+(moreActive?' active':'')+
    '" data-nav-toggle="more" aria-controls="nav-children-more" aria-expanded="'+String(moreActive)+'">' +
    navSymbol('more')+'<span>More</span><span class="nav-chevron" aria-hidden="true">⌄</span></button>' +
    '<div class="nav-children" id="nav-children-more"'+(moreActive?'':' hidden')+'>'+moreChildren+'</div></div>';
  return direct('dashboard','Home','home')+
    direct('clients','Clients')+
    group('medicare','Medicare','athena-medicare','medicare',medicareActive,
      navLink('athena-medicare','Medicare Workspace',route)+navLink('ma-plans','Compare MA Plans',route))+
    group('work','Work','work','work',workActive,
      navLink('work','Work Queue',route)+navAction('notes','Notes')+navAction('leads','Leads')+navLink('campaigns','Campaigns',route)+
      '<a class="nav-child" href="#/dashboard">Today & Follow-ups</a>')+
    direct('communications','Messages','messages')+
    more;
}
// Desktop: top quick-access bar. iPhone: the same controls dock at the bottom.
// Each action is mounted only once, so shortcuts never compete for click events.
export function quickToolbarMarkup() {
  const shortcut=(key,label,short,hint,action) =>
    '<button type="button" class="quick-tool" '+action+' title="'+esc(hint)+'" aria-label="'+esc(label)+'" aria-haspopup="dialog">' +
    icon(key)+'<strong><span class="quick-desktop-label">'+esc(label)+'</span><span class="quick-phone-label" aria-hidden="true">'+esc(short)+'</span></strong></button>';
  return '<div class="quick-tools toolbar-quick-tools" role="group" aria-label="Quick tools">' +
    shortcut('client','New Client','Client','Create a new client','data-add-client') +
    TOOLS.filter(([key])=>key!=='commissions').map(([key,label,short,hint])=>
      shortcut(key,label,short,hint,'data-tool="'+key+'"')).join('')+
    '</div>';
}
export function shell(route, connected, body) {
  const label = NAV.find(([key]) => key === route)?.[1] || 'Dashboard';
  return '<div class="shell"><button class="sidebar-shade" aria-label="Close navigation" hidden></button>' +
    '<aside class="sidebar" id="sidebar"><a class="brand" href="#/dashboard"><img src="/assets/mayer-bear.webp" width="56" height="56" alt="Arctos bear"><span>Arctos<small>Client Management</small></span></a>' +
    '<nav class="nav" aria-label="Main navigation">' + navigationMarkup(route) + '</nav>' +
    '<div class="sidebar-footer">Arctos<small>Client management workspace</small></div></aside>' +
    '<main class="main"><header class="top"><button type="button" class="menu-toggle" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">☰</button>' +
    '<a class="top-brand" href="#/dashboard"><img src="/assets/mayer-bear.webp" alt="Arctos bear" width="40" height="40"><strong>Arctos</strong></a>' +
    '<span class="top-workspace-label">Insurance workspace</span>'+quickToolbarMarkup()+'</header><div class="content"><div class="page-heading"><div><span class="eyebrow">'+esc(label)+'</span><h1>'+esc(label)+'</h1></div></div>'+body+'</div></main></div>';
}
