import { supabase } from './supabase-client.js';
import { esc, dateISO, dateText } from './core.js';

// Saved form JSON intentionally excludes SSNs, Medicare/Medicaid IDs and payment credentials.
// Those are read and written exclusively via the CRM's existing encrypted Edge Functions.
const BUCKET = 'mh-client-documents';
const CATEGORY = 'medicare_intake_pharmacy';
const LIMIT = 25 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);
const SIMPLE = [
  'first_name','last_name','dob','phone','address','city','state','zip','county','gender','veteran',
  'current_plan','current_year','current_member','part_a','part_b','has_medicaid','medicaid_level',
  'soa_signed','soa_reason','new_plan','new_plan_id','new_start','dental','vision','otc','pcp_copay',
  'specialist_copay','hearing','transportation','food_utilities','hospital_cost_day','hospital_days',
  'hospital_total','ambulance_cost','ambulance_total','outpatient_cost','outpatient_total',
  'cancer_amount','cancer_total','snf_cost','snf_total','hip_total','payment_method','bank_name',
  'bank_location','other_payment','card_note','needs_phone','working_email','notes'
];
const SENSITIVE = ['ssn','medicare_number','medicaid_number','bank_routing','bank_account','card_number','card_expiration'];
const dateNames = ['dob','part_a','part_b','new_start'];
const moneyNames = ['hospital_cost_day','hospital_total','ambulance_cost','ambulance_total','outpatient_cost','outpatient_total','cancer_amount','cancer_total','snf_cost','snf_total','hip_total'];
const field = (name, label, attr = '', wide = false) =>
  '<label class="mi-field' + (wide ? ' mi-wide' : '') + '"><span>' + esc(label) + '</span><input name="' + name + '" ' + attr + '></label>';
const input = (name, label, wide = false, attr = '') => field(name,label,attr,wide);
const date = (name, label) => field(name,label,'data-mi-date placeholder="MM/DD/YYYY" inputmode="numeric" maxlength="10" autocomplete="off"');
const secret = (name, label, attrs = '') => field(name,label,'type="password" autocomplete="off" spellcheck="false" ' + attrs);
function choice(name, label, values, wide = false) {
  return '<label class="mi-field' + (wide ? ' mi-wide' : '') + '"><span>' + esc(label) + '</span><select name="' + name + '"><option value="">Select…</option>' +
    values.map(v => '<option value="' + esc(v[0]) + '">' + esc(v[1]) + '</option>').join('') + '</select></label>';
}
const yesNo = (name,label) => choice(name,label,[['yes','Yes'],['no','No']]);
const amount = (name,label) => field(name,label,'type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"');
const block = (number,title,body) =>
  '<details class="mi-step" data-mi-step="' + number + '"><summary><span class="mi-step-n">' + String(number).padStart(2,'0') + '</span><span class="mi-step-label">' + esc(title) + '</span><span class="mi-chevron" aria-hidden="true">⌄</span></summary>' +
  '<label class="mi-already-in-crm"><input type="checkbox" data-mi-skip-toggle="' + number + '" aria-label="Step ' + number + ': Already in CRM"><span>Already in CRM</span></label>' +
  '<div class="mi-step-inner"><div class="mi-step-fields"><div class="mi-grid">' + body + '</div><div class="mi-step-next"><button type="button" class="btn secondary" data-mi-next="' + number + '">' + (number === 13 ? 'Finish & Save' : 'Continue to Step ' + (number + 1)) + '</button></div></div>' +
  '<div class="mi-skip-panel" data-mi-skip-panel hidden><div class="mi-skip-message"><strong>✓ Already in CRM</strong><span>This section is marked to skip. Uncheck the box to enter or change information.</span></div>' +
  (number === 1 ? '<div class="mi-skip-client" data-mi-client-lookup><label class="mi-field"><span>Find existing CRM client</span><input type="search" data-mi-client-search placeholder="Search name or phone" autocomplete="off"></label><div class="mi-client-results" data-mi-client-results></div><div class="mi-client-linked" data-mi-client-linked></div></div>' : '') +
  '<div class="mi-step-next"><button type="button" class="btn secondary" data-mi-next="' + number + '">' + (number === 13 ? 'Finish & Save' : 'Skip to Step ' + (number + 1) + ' →') + '</button></div></div></div></details>';
const repeatRow = (kind, index, row = {}) => {
  const label = kind === 'doctor' ? 'Doctor' : 'Pharmacy';
  const typeField = kind === 'doctor' ? input('kind','Type of Practice',false,'placeholder="Primary Care, Cardiology, etc."') : '';
  return '<div class="mi-repeat-row" data-mi-row="' + kind + '"><div class="mi-row-head"><strong>' + label + ' ' + (index + 1) +
    '</strong><button class="btn secondary" type="button" data-mi-remove="' + kind + '">Remove</button></div><div class="mi-grid">' +
    input('name',label + ' Name') + typeField + input('city','City') + input('state','State',false,'maxlength="2" placeholder="MS"') +
    '</div></div>';
};
const fmt = v => v == null ? '' : String(v);
const safe = v => esc(fmt(v));
const num = v => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) || n < 0 ? 0 : n; };
function formHTML() {
  const docs = '<div class="mi-repeat" data-mi-repeat="doctor"></div><button class="btn secondary mi-add" type="button" data-mi-add="doctor">+ Add Another Doctor</button>';
  const pharma = '<div class="mi-repeat" data-mi-repeat="pharmacy"></div><button class="btn secondary mi-add" type="button" data-mi-add="pharmacy">+ Add Another Pharmacy</button>' +
    '<div class="mi-photo-area"><label class="mi-upload">📷 Take Pharmacy Photo<input type="file" accept="image/*" capture="environment" data-mi-photo hidden></label>' +
    '<label class="mi-upload">Upload Photo / PDF<input type="file" accept="image/*,application/pdf" multiple data-mi-upload hidden></label>' +
    '<div data-mi-files class="mi-file-list"></div></div>';
  const benefits = [
    ['dental','Dental Benefit'],['vision','Vision Benefit'],['otc','OTC Amount'],['pcp_copay','PCP Copay'],
    ['specialist_copay','Specialist Copay'],['hearing','Hearing Benefit'],['transportation','Transportation'],
    ['food_utilities','Food / Utilities Amount']
  ].map(x => input(x[0],x[1],false,'placeholder="Amount / frequency / details"')).join('');
  // Hospital Total Price is entered manually, exactly like the other total price fields.
  // Each remaining cost and its total price share one row on desktop and tablet.
  // Only the five *total price* fields are included in Total HIP Amount.
  const hip = amount('hospital_cost_day','In-Hospital Cost Per Day') +
    field('hospital_days','Number of Hospital Days','type="number" inputmode="numeric" min="0" step="1"') +
    field('hospital_total','Hospital Total Price','type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"',true) +
    amount('ambulance_cost','Ambulance Ride Cost') + amount('ambulance_total','Ambulance Total Price') +
    amount('outpatient_cost','Outpatient Cost') + amount('outpatient_total','Outpatient Total Price') +
    amount('cancer_amount','Cancer Coverage Amount') + amount('cancer_total','Cancer Total Price') +
    amount('snf_cost','Skilled Nursing Cost') + amount('snf_total','Skilled Nursing Total Price') +
    '<div class="mi-total mi-wide"><span>Total HIP Amount</span><output data-mi-total>$0.00</output><input name="hip_total" type="hidden"></div>' +
    '<p class="mi-wide mi-muted mi-hip-note">Calculated from the five Total Price fields only: Hospital, Ambulance, Outpatient, Cancer, and Skilled Nursing.</p>';
  const banking = choice('payment_method','Payment Method',[['bank','Bank Account'],['card','Credit / Debit Card'],['mail_in','Check / Direct Mail'],['other','Other']]) +
    '<div class="mi-wide mi-payment-panel" data-mi-pay="bank">' + input('bank_name','Bank Name') + input('bank_location','Bank City / State') +
    secret('bank_routing','Routing Number','inputmode="numeric"') + secret('bank_account','Account Number','inputmode="numeric"') + '</div>' +
    '<div class="mi-wide mi-payment-panel" data-mi-pay="card">' + secret('card_number','Card Number','inputmode="numeric" maxlength="23"') +
    field('card_expiration','Expiration Date','placeholder="MM/YY" inputmode="numeric" maxlength="7" autocomplete="off"') +
    '<label class="mi-field mi-card-note mi-wide"><span>Card Note</span><textarea name="card_note" rows="1" maxlength="300" placeholder="Optional note" autocomplete="off"></textarea></label>' +
    '</div>' +
    '<div class="mi-wide mi-payment-panel" data-mi-pay="mail_in"><p>Check / payment will be mailed directly.</p></div>' +
    '<div class="mi-wide mi-payment-panel" data-mi-pay="other">' + input('other_payment','Other Payment Instructions',true) + '</div>' +
    '<p class="mi-wide mi-warning">Sensitive information uses existing encrypted CRM storage. Do not include card security codes (CVV) in notes or uploaded payment-card photos.</p>';
  return '<div class="mi-editor-head"><div><strong data-mi-editor-title>New Medicare Intake</strong><p>All 13 steps are on one page. Open a section, collect the information, then continue.</p></div>' +
    '<div class="mi-editor-buttons"><button type="button" class="btn secondary" data-mi-back>Saved Forms</button><button type="button" class="btn primary" data-mi-save>Save Form</button></div></div>' +
    '<form class="mi-form" autocomplete="off" novalidate>' +
    block(1,'Client Information',input('first_name','First Name') + input('last_name','Last Name') +
      date('dob','Date of Birth') + input('phone','Phone Number',false,'type="tel" inputmode="tel"') +
      input('address','Street Address',true) + input('city','City') + input('state','State',false,'maxlength="2" placeholder="MS"') +
      input('zip','ZIP Code',false,'inputmode="numeric" maxlength="10"') + input('county','County') +
      choice('gender','Sex',[['male','Male'],['female','Female']]) + yesNo('veteran','Veteran') +
      secret('ssn','Social Security Number','inputmode="numeric" maxlength="11" placeholder="XXX-XX-XXXX"')) +
    block(2,'Current Medicare Plan',input('current_plan','Current Plan Name',true) +
      input('current_year','Plan Year',false,'inputmode="numeric" maxlength="4"') + input('current_member','Member ID')) +
    block(3,'Medicare Information',secret('medicare_number','Medicare Number','maxlength="25"') +
      date('part_a','Part A Effective Date') + date('part_b','Part B Effective Date')) +
    block(4,'Medicaid Information',yesNo('has_medicaid','Has Medicaid?') +
      '<div class="mi-wide mi-dependent" data-mi-medicaid>' + secret('medicaid_number','Medicaid Number') +
      choice('medicaid_level','Medicaid Level',[['QMB','QMB'],['QMB+','QMB+'],['SLMB','SLMB'],['SLMB+','SLMB+'],['QI','QI'],['QDWI','QDWI'],['FBDE','FBDE / Full Medicaid'],['other','Other']]) + '</div>') +
    block(5,'Scope of Appointment',yesNo('soa_signed','SOA Signed?') +
      '<div class="mi-wide mi-dependent" data-mi-soa>' + input('soa_reason','If No, Explain Why',true) + '</div>' +
      '<p class="mi-wide mi-muted">This records SOA status; it does not replace a required signed Scope of Appointment.</p>') +
    block(6,'Doctors',docs) +
    block(7,'Pharmacies & Photos',pharma) +
    block(8,'New Plan Selected',input('new_plan','Selected Plan Name',true) + input('new_plan_id','Plan ID') + date('new_start','Plan Start Date')) +
    block(9,'New Plan Benefits',benefits) +
    block(10,'Hospital Indemnity Plan',hip) +
    block(11,'Payment Information',banking) +
    block(12,'Cell Phone Needed?',yesNo('needs_phone','Cell Phone Needed?') +
      '<div class="mi-wide mi-dependent" data-mi-email>' + field('working_email','Working Email Address','type="email" inputmode="email" autocomplete="off"') + '</div>') +
    block(13,'Notes','<label class="mi-field mi-wide"><span>Intake Notes</span><textarea name="notes" rows="8" placeholder="Notes from your Medicare conversation…"></textarea></label>') +
    '</form><div class="mi-editor-footer"><div class="mi-status" data-mi-status role="status" aria-live="polite">Not saved yet.</div>' +
    '<button type="button" class="btn primary" data-mi-save>Save Medicare Intake</button></div>';
}
async function invoke(name,body) {
  const { data,error } = await supabase.functions.invoke(name,{ body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data || {};
}
function normalDate(value,label) {
  if (!value) return null;
  const date = dateISO(value);
  if (!date) throw new Error('Enter a valid ' + label + ' as MM/DD/YYYY.');
  return date;
}
function dateMask(v) {
  const x = String(v || '').replace(/\D/g,'').slice(0,8);
  return x.slice(0,2) + (x.length > 2 ? '/' + x.slice(2,4) : '') + (x.length > 4 ? '/' + x.slice(4,8) : '');
}
function moneyLabel(v) { return num(v).toLocaleString('en-US',{style:'currency',currency:'USD'}); }
function paymentDigits(v) { return String(v || '').replace(/\D/g,''); }
function escapeName(v) { return String(v || 'photo').replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,90); }
export function createMedicareIntakeFeature() {
  let host = null, row = null, queued = [], uploaded = [], dirty = false, busy = false, epoch = 0;
  let linkedClient = null, clientSearchTimer = 0, clientSearchToken = 0;
  let currentMode = 'home';
  const isSkipped = number => Boolean(host?.querySelector('[data-mi-skip-toggle="' + number + '"]')?.checked);
  const skippedSections = () => Array.from(host?.querySelectorAll('[data-mi-skip-toggle]:checked') || [], box => Number(box.dataset.miSkipToggle));
  function showSkipSections() {
    host?.querySelectorAll('.mi-step').forEach(step => {
      const number = Number(step.dataset.miStep);
      const skip = isSkipped(number);
      step.classList.toggle('mi-skipped', skip);
      const fields = step.querySelector('.mi-step-fields');
      const panel = step.querySelector('[data-mi-skip-panel]');
      if (fields) fields.hidden = skip;
      if (panel) panel.hidden = !skip;
      if (number === 1) {
        const lookup = step.querySelector('[data-mi-client-lookup]');
        if (lookup) lookup.hidden = !skip || Boolean(row?.client_id);
        const linked = step.querySelector('[data-mi-client-linked]');
        if (linked) linked.textContent = linkedClient ? 'Selected CRM client: ' + [linkedClient.first_name, linkedClient.last_name].filter(Boolean).join(' ') : (row?.client_id ? 'Using the client already linked to this intake.' : '');
      }
    });
  }
  async function searchExistingClients(term) {
    const target = host?.querySelector('[data-mi-client-results]');
    if (!target || !isSkipped(1) || row?.client_id) return;
    const request = ++clientSearchToken;
    const q = String(term || '').trim().replace(/[%*(),"]/g, ' ').trim().slice(0,80);
    if (q.length < 2) {target.replaceChildren();return;}
    target.textContent = 'Searching CRM clients…';
    try {
      // Search only rows the currently authenticated agent is allowed to see.
      const {data,error} = await supabase.from('clients')
        .select('id,first_name,last_name,phone,date_of_birth')
        .or('first_name.ilike.' + JSON.stringify('%' + q + '%') + ',last_name.ilike.' + JSON.stringify('%' + q + '%') + ',phone.ilike.' + JSON.stringify('%' + q + '%'))
        .order('last_name').limit(12);
      if (error) throw error;
      if (request !== clientSearchToken || !target.isConnected) return;
      target.innerHTML = (data || []).length ? data.map(c =>
        '<button type="button" class="mi-client-result" data-mi-client-select="' + safe(c.id) + '"><strong>' +
        safe([c.first_name,c.last_name].filter(Boolean).join(' ')) + '</strong><small>' + safe(c.phone || c.date_of_birth || '') + '</small></button>').join('')
        : '<small>No matching clients found. Try another name or phone number.</small>';
      target._miClients = data || [];
    } catch(e) {
      if (request === clientSearchToken && target.isConnected) target.textContent = 'Could not search clients: ' + (e.message || 'Retry');
    }
  }
  function setStatus(message,error = false) {
    if (!host) return;
    const s = host.querySelector('[data-mi-status]');
    if (s) { s.textContent = message; s.classList.toggle('mi-error',error); }
  }
  function canLeave() { return !busy && (!dirty || window.confirm('This Medicare intake has unsaved changes. Discard your changes?')); }
  function reset() { row = null; linkedClient = null; queued = []; uploaded = []; dirty = false; clearTimeout(clientSearchTimer); ++clientSearchToken; }
  function home() {
    currentMode = 'home'; reset();
    host.innerHTML = '<div class="mi-home"><p>Start a complete Medicare conversation or return to a saved intake. Forms remain in the CRM for later editing.</p>' +
      '<div class="mi-home-actions"><button class="mi-home-card" type="button" data-mi-new><strong>+ New Form</strong><span>Start a 13-step Medicare intake</span></button>' +
      '<button class="mi-home-card" type="button" data-mi-saved><strong>Saved Forms</strong><span>Search and reopen existing forms</span></button></div></div>';
  }
  function renderRepeat(kind, items) {
    const target = host?.querySelector('[data-mi-repeat="' + kind + '"]');
    if (!target) return;
    target.innerHTML = items.map((item,i) => repeatRow(kind,i,item)).join('');
    target.querySelectorAll('[data-mi-row]').forEach((node,i) => {
      const item = items[i];
      ['name','kind','city','state'].forEach(key => { const control = node.querySelector('[name="' + key + '"]'); if (control) control.value = fmt(item[key]); });
    });
  }
  function repeatValues(kind) {
    return Array.from(host.querySelectorAll('[data-mi-row="' + kind + '"]')).map(r => {
      const out = {};
      r.querySelectorAll('input').forEach(el => { out[el.name] = el.value.trim(); });
      return out;
    }).filter(r => Object.values(r).some(Boolean));
  }
  function filePanel() {
    const node = host?.querySelector('[data-mi-files]'); if (!node) return;
    node.innerHTML = uploaded.map(f => '<div class="mi-file-item"><span>📎 ' + safe(f.file_name) + '</span><button type="button" class="btn secondary" data-mi-view="' + safe(f.id) + '">View</button></div>').join('') +
      queued.map((f,i) => '<div class="mi-file-item"><span>📷 ' + safe(f.name) + ' <small>(pending upload)</small></span><button type="button" class="btn secondary" data-mi-remove-file="' + i + '">Remove</button></div>').join('');
    if (!uploaded.length && !queued.length) node.innerHTML = '<small>No pharmacy pictures or files yet.</small>';
  }
  function showDependencies() {
    const f = host?.querySelector('.mi-form'); if (!f) return;
    const val = name => f.elements.namedItem(name)?.value || '';
    const show = (sel,visible) => { const node = f.querySelector(sel); if (node) node.hidden = !visible; };
    show('[data-mi-medicaid]',val('has_medicaid') === 'yes');
    show('[data-mi-soa]',val('soa_signed') === 'no');
    show('[data-mi-email]',val('needs_phone') === 'yes');
    f.querySelectorAll('[data-mi-pay]').forEach(el => el.hidden = el.dataset.miPay !== val('payment_method'));
  }
  function calc() {
    const f = host?.querySelector('.mi-form'); if (!f) return;
    const read = k => f.elements.namedItem(k)?.value || '';
    const total = ['hospital_total','ambulance_total','outpatient_total','cancer_total','snf_total'].reduce((n,k) => n + num(read(k)),0);
    f.elements.namedItem('hip_total').value = total.toFixed(2);
    f.querySelector('[data-mi-total]').textContent = moneyLabel(total);
  }
  function renderEditor(data = {}, sensitive = {}, banking = {}) {
    currentMode = 'edit'; dirty = false;
    host.innerHTML = formHTML();
    const f = host.querySelector('.mi-form');
    for (const k of SIMPLE) {
      const el = f.elements.namedItem(k);
      if (el) el.value = dateNames.includes(k) && data[k] && /^\d{4}-\d{2}-\d{2}$/.test(String(data[k])) ? dateText(data[k]) : fmt(data[k]);
    }
    for (const k of ['ssn','medicare_number','medicaid_number']) {
      const el = f.elements.namedItem(k); if (el) el.value = fmt(sensitive[k]);
    }
    for (const [from,to] of [['routing_number','bank_routing'],['account_number','bank_account'],['card_number','card_number'],['card_expiration','card_expiration']]) {
      const el = f.elements.namedItem(to); if (el) el.value = fmt(banking[from]);
    }
    const flags = Array.isArray(data.already_in_crm) ? data.already_in_crm : [];
    f.querySelectorAll('[data-mi-skip-toggle]').forEach(box => {
      box.checked = flags.includes(Number(box.dataset.miSkipToggle));
    });
    if (banking.payment_method && !f.elements.namedItem('payment_method').value) f.elements.namedItem('payment_method').value = banking.payment_method;
    if (banking.bank_name && !f.elements.namedItem('bank_name').value) f.elements.namedItem('bank_name').value = banking.bank_name;
    renderRepeat('doctor',data.doctors?.length ? data.doctors : [{}]);
    renderRepeat('pharmacy',data.pharmacies?.length ? data.pharmacies : [{}]);
    const title = host.querySelector('[data-mi-editor-title]');
    title.textContent = row ? 'Edit Intake — ' + (row.client_name || 'Client') : 'New Medicare Intake';
    host.querySelector('[data-mi-step="1"]').open = true;
    showDependencies(); showSkipSections(); calc(); filePanel();
    if (row) setStatus('Saved form loaded. Changes will update this same form.');
    else setStatus('New form — enter the client information and save when ready.');
  }
  function readEditor() {
    const f = host.querySelector('.mi-form');
    const out = {};
    for (const k of SIMPLE) out[k] = fmt(f.elements.namedItem(k)?.value).trim();
    out.already_in_crm = skippedSections();
    if (isSkipped(1) && linkedClient) {
      out.first_name = linkedClient.first_name || '';
      out.last_name = linkedClient.last_name || '';
      out.phone = linkedClient.phone || '';
      out.dob = linkedClient.date_of_birth || '';
    }
    if (isSkipped(1) && !row?.client_id && !linkedClient)
      throw new Error('Step 1: Select an existing CRM client before skipping Client Information.');
    if (!out.first_name || !out.last_name) throw new Error('First name and last name are required to save a form.');
    const dateSections = {dob:1,part_a:3,part_b:3,new_start:8};
    dateNames.forEach(k => {
      if (out[k] && !isSkipped(dateSections[k]))
        out[k] = /^\d{4}-\d{2}-\d{2}$/.test(out[k]) ? out[k] : normalDate(out[k],k.replaceAll('_',' '));
    });
    if (!isSkipped(5) && out.soa_signed === 'no' && !out.soa_reason) throw new Error('Step 5: Explain why the Scope of Appointment was not signed.');
    if (!isSkipped(12) && out.needs_phone === 'yes' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.working_email)) throw new Error('Step 12: Enter a working email address when a cell phone is needed.');
    out.doctors = repeatValues('doctor');
    out.pharmacies = repeatValues('pharmacy');
    // Payment credentials, SSN, Medicare and Medicaid numbers NEVER enter intake_data.
    out.hip_total = f.elements.namedItem('hip_total').value;
    return out;
  }
  function getSecrets() {
    const f = host.querySelector('.mi-form');
    const s = {};
    SENSITIVE.forEach(k => s[k] = String(f.elements.namedItem(k)?.value || '').trim());
    return s;
  }
  async function loadFiles() {
    uploaded = [];
    if (!row) return;
    const { data,error } = await supabase.from('documents').select('id,file_name,storage_path').eq('client_id',row.client_id)
      .eq('category',CATEGORY).eq('notes','medicare-intake:' + row.id).order('created_at',{ascending:false});
    if (error) throw error;
    uploaded = data || [];
    filePanel();
  }
  async function uploadFiles() {
    if (!queued.length || !row) return;
    for (const file of [...queued]) {
      const mime = file.type || ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',pdf:'application/pdf'})[String(file.name).toLowerCase().split('.').pop()];
      if (!ACCEPTED.has(mime) || file.size > LIMIT) throw new Error('Pharmacy files must be PDF/photos smaller than 25 MB.');
      const path = row.client_id + '/medicare-intake/' + row.id + '/' + crypto.randomUUID() + '-' + escapeName(file.name);
      const uploadedFile = await supabase.storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false});
      if (uploadedFile.error) throw uploadedFile.error;
      const { data,error } = await supabase.from('documents').insert({
        client_id:row.client_id,category:CATEGORY,file_name:file.name,storage_path:path,mime_type:mime,file_size:file.size,
        notes:'medicare-intake:' + row.id
      }).select('id,file_name,storage_path').single();
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
      uploaded.unshift(data);
      queued = queued.filter(f => f !== file);
      filePanel();
    }
  }
  async function save() {
    if (busy || !host?.querySelector('.mi-form')) return;
    busy = true;
    host.querySelectorAll('[data-mi-save]').forEach(b => b.disabled = true);
    setStatus('Saving the intake securely…');
    try {
      calc();
      const value = readEditor(), sec = getSecrets();
      const payment = value.payment_method;
      if (!isSkipped(11) && payment === 'bank' && (sec.bank_routing || sec.bank_account) &&
          (!value.bank_name || !sec.bank_routing || !sec.bank_account))
        throw new Error('Step 11: Complete the bank name, routing number and account number before saving bank details.');
      if (!isSkipped(11) && payment === 'card' && (sec.card_number || sec.card_expiration) &&
          (paymentDigits(sec.card_number).length < 12 || !sec.card_expiration))
        throw new Error('Step 11: Complete the card number and expiration before saving card details.');
      const { data: auth,error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error('Please sign in again to save.');
      const clientInfo = {
        first_name:value.first_name,last_name:value.last_name,phone:value.phone || null,
        date_of_birth:value.dob || null, address1:value.address || null,city:value.city || null,
        state:value.state || null,zip_code:value.zip || null,county:value.county || null,
        gender:value.gender || null, veteran: value.veteran ? value.veteran === 'yes' : null
      };
      let createdClient = false;
      if (!row?.client_id && isSkipped(1) && linkedClient) {
        // Skipped demographics must link an existing CRM client, never
        // create a new empty record or rewrite their saved information.
        row = {client_id:linkedClient.id};
      }
      if (!row?.client_id) {
        let matched = null;
        // Respect the CRM's duplicate-client workflow: prefer linking exact name plus DOB/phone.
        if (value.dob || value.phone) {
          const {data:candidates,error:matchError} = await supabase.from('clients')
            .select('id,first_name,last_name,date_of_birth,phone')
            .ilike('first_name',value.first_name).ilike('last_name',value.last_name).limit(15);
          if (matchError) throw matchError;
          matched = (candidates || []).find(x =>
            (value.dob && x.date_of_birth === value.dob) ||
            (value.phone && paymentDigits(x.phone) && paymentDigits(x.phone) === paymentDigits(value.phone)));
        }
        if (matched && window.confirm('A matching CRM client already exists. Save this Medicare intake under that client instead of creating a duplicate?')) {
          row = {client_id:matched.id};
        } else {
          const { data: client,error } = await supabase.from('clients').insert({
            ...clientInfo,assigned_agent_id:auth.user.id,products:['medicare']
          }).select('id').single();
          if (error) throw error;
          row = { client_id:client.id };
          createdClient = true;
        }
      }
      if (!createdClient && !isSkipped(1)) {
        // A skipped section is NEVER allowed to overwrite existing CRM demographics.
        const changed = Object.fromEntries(Object.entries(clientInfo).filter(([,v]) => v !== null));
        if (Object.keys(changed).length) {
          const { error } = await supabase.from('clients').update(changed).eq('id',row.client_id);
          if (error) throw error;
        }
      }
      const payload = { client_id:row.client_id,client_name:value.first_name + ' ' + value.last_name,
        client_phone:value.phone || null,intake_data:value,updated_at:new Date().toISOString() };
      if (row.id) {
        let query = supabase.from('medicare_intakes').update(payload).eq('id',row.id);
        if (row.updated_at) query = query.eq('updated_at',row.updated_at);
        const { data,error } = await query.select('*').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('This form was edited elsewhere. Reopen the saved form before overwriting it.');
        row = data;
      } else {
        const { data,error } = await supabase.from('medicare_intakes').insert(payload).select('*').single();
        if (error) throw error;
        row = data;
      }
      // Reuse encrypted identity vault. Preserve any existing driver's license, which is not part of this form.
      const saveIdentity = (!isSkipped(1) && sec.ssn) || (!isSkipped(3) && sec.medicare_number) ||
        (!isSkipped(4) && (sec.medicaid_number || value.has_medicaid === 'no'));
      if (saveIdentity) {
        const current = await invoke('client-sensitive',{action:'get',client_id:row.client_id});
        const old = current.sensitive || {};
        await invoke('client-sensitive',{action:'save',client_id:row.client_id,sensitive:{
          ssn:!isSkipped(1) && sec.ssn ? sec.ssn : old.ssn || '',
          medicare_number:!isSkipped(3) && sec.medicare_number ? sec.medicare_number : old.medicare_number || '',
          medicaid_number:isSkipped(4) ? old.medicaid_number || '' :
            value.has_medicaid === 'no' ? '' : sec.medicaid_number || old.medicaid_number || '',
          drivers_license_number:old.drivers_license_number || ''
        }});
      }
      const bankType = value.payment_method;
      const bankReady = bankType === 'bank' && value.bank_name && sec.bank_routing && sec.bank_account;
      const cardReady = bankType === 'card' && paymentDigits(sec.card_number).length >= 12 && sec.card_expiration;
      if (!isSkipped(11) && (bankReady || cardReady || bankType === 'mail_in')) {
        await invoke('client-banking',{action:'save',client_id:row.client_id,banking:{
          payment_method:bankType,bank_name:bankType === 'bank' ? value.bank_name : '',
          routing_number:bankType === 'bank' ? paymentDigits(sec.bank_routing) : '',
          account_number:bankType === 'bank' ? sec.bank_account : '',
          card_number:bankType === 'card' ? paymentDigits(sec.card_number) : '',
          card_expiration:bankType === 'card' ? sec.card_expiration : ''
        }});
      }
      const medical = {client_id:row.client_id};
      if (!isSkipped(3) && (value.part_a || value.part_b)) {
        medical.part_a_date = value.part_a || null;
        medical.part_b_date = value.part_b || null;
      }
      if (!isSkipped(4) && (value.has_medicaid || value.medicaid_level)) {
        medical.medicaid_level = value.has_medicaid === 'no' ? null : value.medicaid_level || null;
      }
      if (Object.keys(medical).length > 1) {
        const {error} = await supabase.from('medicare_details').upsert(medical,{onConflict:'client_id'});
        if (error) throw error;
      }
      if (!isSkipped(7)) await uploadFiles();
      dirty = false;
      host.querySelector('[data-mi-editor-title]').textContent = 'Edit Intake — ' + row.client_name;
      setStatus('Saved successfully. Reopen this same form under Saved Forms to make changes.');
    } catch(e) {
      dirty = true;
      setStatus('Could not finish saving: ' + (e.message || 'Please try again.') + '. Keep this form open and retry.',true);
    } finally {
      busy = false;
      host?.querySelectorAll('[data-mi-save]').forEach(b => b.disabled = false);
    }
  }
  async function savedForms() {
    if (!canLeave()) return;
    const request = ++epoch; reset(); currentMode = 'list';
    host.innerHTML = '<div class="mi-list-head"><button type="button" class="btn primary" data-mi-new>+ New Form</button><h2>Saved Medicare Intakes</h2></div><p class="mi-muted">Loading your saved forms…</p>';
    try {
      const {data,error} = await supabase.from('medicare_intakes').select('id,client_id,client_name,client_phone,updated_at,created_at')
        .order('updated_at',{ascending:false}).limit(500);
      if (error) throw error;
      if (request !== epoch || !host?.isConnected) return;
      host.innerHTML = '<div class="mi-list-head"><button type="button" class="btn primary" data-mi-new>+ New Form</button><h2>Saved Medicare Intakes <small>(' + data.length + ')</small></h2></div>' +
        '<label class="mi-list-filter">Search Forms<input type="search" data-mi-filter placeholder="Search name or phone number" autocomplete="off"></label>' +
        '<div data-mi-list>' + (data.length ? data.map(f => '<button type="button" class="mi-saved-row" data-mi-open="' + safe(f.id) + '"><strong>' + safe(f.client_name) +
          '</strong><span>' + safe(f.client_phone || 'No phone') + '</span><small>Updated ' + safe(new Date(f.updated_at).toLocaleString()) + '</small><b>Open →</b></button>').join('') :
          '<div class="mi-empty">No saved Medicare intakes yet. Choose New Form to start.</div>') + '</div>';
    } catch(e) {
      if (request === epoch) host.innerHTML = '<button class="btn secondary" type="button" data-mi-home>Back</button><p class="mi-error">Unable to load saved forms: ' + safe(e.message) + '</p>';
    }
  }
  async function openSaved(id) {
    if (!canLeave()) return;
    ++epoch; dirty = false; queued = []; uploaded = [];
    host.innerHTML = '<div class="mi-loading">Opening saved intake…</div>';
    try {
      const {data,error} = await supabase.from('medicare_intakes').select('*').eq('id',id).single();
      if (error) throw error;
      row = data;
      const [s,b] = await Promise.all([
        invoke('client-sensitive',{action:'get',client_id:row.client_id}),
        invoke('client-banking',{action:'get',client_id:row.client_id})
      ]);
      renderEditor(data.intake_data || {},s.sensitive || {},b.banking || {});
      await loadFiles();
    } catch(e) {
      reset();
      host.innerHTML = '<button type="button" class="btn secondary" data-mi-saved>Saved Forms</button><p class="mi-error">Could not open this form: ' + safe(e.message) + '</p>';
    }
  }
  function newForm() {
    if (!canLeave()) return;
    ++epoch; reset(); renderEditor();
  }
  function onClick(e) {
    const target = e.target.closest('button,[data-mi-photo],[data-mi-upload]');
    if (!target || !host?.contains(target)) return;
    if (target.matches('[data-mi-new]')) return newForm();
    if (target.matches('[data-mi-home]')) { if (canLeave()) home(); return; }
    if (target.matches('[data-mi-saved],[data-mi-back]')) return void savedForms();
    if (target.matches('[data-mi-open]')) return void openSaved(target.dataset.miOpen);
    if (target.matches('[data-mi-save]')) return void save();
    if (target.matches('[data-mi-client-select]')) {
      const results = host.querySelector('[data-mi-client-results]');
      const client = results?._miClients?.find(c => String(c.id) === target.dataset.miClientSelect);
      if (!client || !isSkipped(1)) return;
      linkedClient = client;
      const form = host.querySelector('.mi-form');
      for (const [fieldName,value] of [['first_name',client.first_name],['last_name',client.last_name],
        ['phone',client.phone],['dob',client.date_of_birth]]) {
        const input = form.elements.namedItem(fieldName);
        if (input) input.value = fieldName === 'dob' && value ? dateText(value) : fmt(value);
      }
      if (results) results.replaceChildren();
      showSkipSections();
      dirty = true;
      setStatus('CRM client selected. This intake will link to that client when saved.');
      return;
    }
    if (target.matches('[data-mi-next]')) {
      const n = Number(target.dataset.miNext);
      if (n === 13) return void save();
      const next = host.querySelector('[data-mi-step="' + (n+1) + '"]');
      host.querySelectorAll('.mi-step').forEach(x => x.open = false);
      if (next) {next.open = true;next.scrollIntoView({behavior:'smooth',block:'nearest'});}
      return;
    }
    if (target.matches('[data-mi-add]')) {
      const kind = target.dataset.miAdd, node = host.querySelector('[data-mi-repeat="' + kind + '"]');
      const el = document.createElement('div'); el.innerHTML = repeatRow(kind,node.querySelectorAll('[data-mi-row]').length);
      node.append(el.firstElementChild); dirty = true; return;
    }
    if (target.matches('[data-mi-remove]')) {
      const node = target.closest('[data-mi-row]'), parent = node?.parentElement;
      if (node) {node.remove();dirty = true;}
      if (parent && !parent.children.length) {
        const el = document.createElement('div'); el.innerHTML = repeatRow(target.dataset.miRemove,0);
        parent.append(el.firstElementChild);
      }
      return;
    }
    if (target.matches('[data-mi-remove-file]')) { queued.splice(Number(target.dataset.miRemoveFile),1);filePanel();dirty = true;return; }
    if (target.matches('[data-mi-view]')) {
      const f = uploaded.find(x => x.id === target.dataset.miView);
      if (f) void supabase.storage.from(BUCKET).createSignedUrl(f.storage_path,90)
        .then(({data,error}) => {if(error) throw error;window.open(data.signedUrl,'_blank','noopener,noreferrer');})
        .catch(err => setStatus('Could not open the photo: ' + err.message,true));
      return;
    }
  }
  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-mi-filter]')) {
      const text = t.value.trim().toLowerCase();
      host.querySelectorAll('[data-mi-open]').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(text));
      return;
    }
    if (!t.closest('.mi-form')) return;
    if (t.matches('[data-mi-client-search]')) {
      linkedClient = null;
      ++clientSearchToken;
      showSkipSections();
      clearTimeout(clientSearchTimer);
      clientSearchTimer = setTimeout(() => void searchExistingClients(t.value), 220);
      return;
    }
    if (t.matches('[data-mi-date]')) t.value = dateMask(t.value);
    if (t.name === 'card_number') t.value = paymentDigits(t.value).slice(0,19);
    if (t.name === 'card_expiration') {
      const d = paymentDigits(t.value).slice(0,4); t.value = d.slice(0,2) + (d.length > 2 ? '/' + d.slice(2) : '');
    }
    dirty = true;
    if (moneyNames.includes(t.name) || t.name === 'hospital_days') calc();
    if (['has_medicaid','soa_signed','needs_phone','payment_method'].includes(t.name)) showDependencies();
    setStatus('Unsaved changes.');
  }
  function onStepChange(e) {
    const checkbox = e.target.closest('[data-mi-skip-toggle]');
    if (checkbox && host?.contains(checkbox)) {
      const step = checkbox.closest('.mi-step');
      if (checkbox.checked && step) step.open = true;
      showSkipSections();
      dirty = true;
      setStatus('Section status changed. Save the intake to keep this selection.');
    }
  }
  function onFiles(e) {
    if (!e.target.matches('[data-mi-photo],[data-mi-upload]')) return;
    for (const file of Array.from(e.target.files || [])) {
      const mime = file.type || ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',pdf:'application/pdf',heic:'image/heic',heif:'image/heif',webp:'image/webp'})[file.name.toLowerCase().split('.').pop()];
      if (!ACCEPTED.has(mime) || file.size > LIMIT) {setStatus('Only PDF or photo files up to 25 MB are allowed.',true);continue;}
      queued.push(file);dirty = true;
    }
    e.target.value = '';
    filePanel();setStatus('Photo added to upload queue. Save the form to store it securely.');
  }
  function mount(node) {
    host = node; home();
    host.addEventListener('click',onClick);
    host.addEventListener('input',onInput);
    host.addEventListener('change',onFiles);
    host.addEventListener('change',onStepChange);
    host.addEventListener('change',e => {if(e.target.closest('.mi-form')) {showDependencies();dirty=true;}});
    host.addEventListener('toggle',e => {if(e.target.matches('.mi-step') && e.target.open) host.querySelectorAll('.mi-step').forEach(d => {if(d!==e.target)d.open=false;});},true);
  }
  function unmount() { ++epoch; if(host){host.removeEventListener('click',onClick);host.removeEventListener('input',onInput);host.removeEventListener('change',onFiles);host.removeEventListener('change',onStepChange);} host=null;reset(); }
  return {mount,unmount,canLeave,destroy:unmount};
}
