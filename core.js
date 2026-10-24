/** Pure helpers and an explicit disconnected boundary. No legacy CRM requests or local persistence. */
export const NAV = Object.freeze([
  ['dashboard', 'Dashboard'], ['clients', 'Clients'], ['work', 'Work'], ['ma-plans', 'MA Plans'], ['campaigns', 'Campaigns'], ['communications', 'Communications'], ['carriers', 'Carriers'],
  ['agents', 'Agents & Admin'], ['athena-medicare', "Athena's Medicare"], ['settings', 'Settings']
]);
export const CLIENT_TABS = Object.freeze([
  ['information', 'Client Information'], ['medicare', 'Medicare'], ['doctors', 'Doctors'], ['medications', 'Medications'],
  ['hospital_indemnity', 'Hospital Indemnity'], ['life', 'Life'], ['retirement', 'Retirement'], ['notes', 'Notes / Extras']
]);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
export const isoDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const todayKey = () => isoDate(new Date());
export function parseISO(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return null;
  const date = new Date(+m[1], +m[2] - 1, +m[3], 12);
  return isoDate(date) === value ? date : null;
}
export function dateText(value) {
  const d = parseISO(value);
  return d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}` : (value || '');
}
export function dateISO(value) {
  const raw = String(value || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw) || /^(\d{2})(\d{2})(\d{4})$/.exec(raw);
  if (!m) return null;
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return +m[3] >= 1900 && +m[3] <= 2200 && parseISO(iso) ? iso : null;
}
export function monthDays(year, month) {
  const first = new Date(year, month, 1, 12);
  const last = new Date(year, month + 1, 0, 12);
  const start = new Date(year, month, 1 - first.getDay(), 12);
  const count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12));
}
export const longDate = key => {
  const d = parseISO(key);
  return d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
};
// Supabase time values can include seconds. Normalize for chronological
// appointment ordering without relying on how the database returned rows.
export function appointmentStartMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value || '').trim());
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number(match[1]), minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.POSITIVE_INFINITY;
  return hours * 60 + minutes;
}
export function sortAppointmentsByStartTime(appointments) {
  return [...appointments].sort((a, b) => {
    const time = appointmentStartMinutes(a.start_time) - appointmentStartMinutes(b.start_time);
    // For two missing times, subtraction yields NaN; keep consistent ordering
    // using the stored date, then title, then record id.
    if (Number.isFinite(time) && time !== 0) return time;
    return String(a.event_date || '').localeCompare(String(b.event_date || '')) ||
      String(a.title || '').localeCompare(String(b.title || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''));
  });
}
export function timeLabel(value) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value || ''));
  if (!m) return 'All day';
  return `${+m[1] % 12 || 12}:${m[2]} ${+m[1] >= 12 ? 'PM' : 'AM'}`;
}
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function snapshot(form) {
  const result = {};
  for (const el of Array.from(form.elements)) {
    if (!el.name || el.disabled || ['button', 'submit', 'reset'].includes(el.type)) continue;
    if (el.type === 'checkbox') result[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) result[el.name] = el.value; }
    else if (el.type === 'file') result[el.name] = Array.from(el.files || []).map(f => ({ name: f.name, size: f.size, modified: f.lastModified }));
    else result[el.name] = el.value;
  }
  return result;
}
export function hydrate(form, record) {
  for (const el of Array.from(form.elements)) {
    if (!el.name || el.type === 'file' || !(el.name in record)) continue;
    if (el.type === 'checkbox') el.checked = record[el.name] === true;
    else if (el.type === 'radio') el.checked = el.value === record[el.name];
    else el.value = el.hasAttribute('data-date') ? dateText(record[el.name]) : String(record[el.name] ?? '');
  }
}
const wiredDateInputs = new WeakMap();
export function wireDates(form) {
  form.querySelectorAll('[data-date]').forEach(input => {
    if (wiredDateInputs.has(input)) { wiredDateInputs.get(input)(); return; }
    const validate = () => input.setCustomValidity(!input.value || dateISO(input.value) ? '' : 'Enter a valid date as MM/DD/YYYY.');
    wiredDateInputs.set(input, validate);
    input.addEventListener('input', validate);
    input.addEventListener('blur', () => { const v = dateISO(input.value); if (v) input.value = dateText(v); validate(); });
    validate();
  });
}
export function serializable(form) {
  const value = snapshot(form);
  form.querySelectorAll('[data-date]').forEach(el => {
    if (!el.disabled && el.name) value[el.name] = el.value ? dateISO(el.value) : '';
  });
  return value;
}
export class NotConnectedError extends Error {
  constructor() {
    super('The standalone M&H database is not connected. Nothing was saved. Your changes are still open; keep editing or discard them to close.');
    this.name = 'NotConnectedError';
  }
}
const unavailable = async () => { throw new NotConnectedError(); };
export const disconnectedRepository = Object.freeze({
  connected: false, agents: [],
  searchClients: unavailable, getClient: unavailable, saveClient: unavailable,
  listEvents: unavailable, saveEvent: unavailable, listNotes: unavailable, saveNote: unavailable,
  searchContacts: unavailable, getBuildChart: unavailable, commissions: unavailable
});
