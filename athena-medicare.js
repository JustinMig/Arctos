import { openAppleFile } from './external-file-opening.js';

import { supabase } from './supabase-client.js';
import { esc, dateISO, dateText } from './core.js';
import { loadAthenaClientSections, syncAthenaClient } from './athena-crm-sync.js?v=sunfire-review-1';
import { saveAthenaRecoveryDraft, readAthenaRecoveryDraft, clearAthenaRecoveryDraft } from './athena-draft-store.js';
import { openSoaForClient, viewLatestSoaForClient } from './client-soa-compliance.js';
import { athenaDocumentsMarkup, bindAthenaDocuments } from './athena-client-documents.js';

// A standalone, secure workflow alongside (not replacing) Medicare Reviews.
// Private identity numbers live in the CRM's encrypted client-sensitive vault.
const TABLE = 'athena_medicare_reviews';
const BUCKET = 'mh-client-documents';
const DOC_CATEGORY = 'medicare_intake_pharmacy';
const FILE_LIMIT = 25 * 1024 * 1024;
const ALLOWED_FILES = new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']);
const FIELD_GROUPS = {
  1: ['first_name','last_name','dob','phone','email','address','city','state','zip','county','gender','veteran'],
  2: ['part_a','part_b','medicaid_status','medicaid_level','medicare_status','eligibility_notes','sunfire_code','medicare_gov_username','medicare_gov_email','medicare_gov_notes'],
  3: ['current_carrier','current_plan','current_plan_id','current_year','current_member_id','current_plan_type','current_premium','current_like','current_dislike','old_plan_carrier','old_plan_id','old_plan_member_id','old_plan_year'],
  4: [],
  5: [],
  6: ['care_priorities','dental_need','vision_need','hearing_need','transport_need','otc_need','giveback_need','food_need','preferred_hospitals','network_concerns'],
  7: ['recommended_carrier','recommended_plan','recommended_plan_id','new_effective','new_premium','new_moop','dental_benefit','vision_benefit','hearing_benefit','otc_benefit','food_benefit','transport_benefit','giveback_benefit','pcp_copay','specialist_copay','hospital_copay','recommendation_reason','doctor_network_verified','drug_coverage_verified'],
  8: ['hip_hospital_day','hip_days','hip_hospital_total','hip_ambulance_cost','hip_ambulance','hip_outpatient_cost','hip_outpatient','hip_cancer_face','hip_cancer','hip_snf_cost','hip_snf','hip_notes'],
  9: ['review_date','soa_status','soa_reason','workflow_status','private_notes']
};
const DATE_FIELDS = new Set(['dob','part_a','part_b','new_effective','review_date','followup_date']);
const HIP_TOTALS = ['hip_hospital_total','hip_ambulance','hip_outpatient','hip_cancer','hip_snf'];
const SECTIONS = [
  ['Client & contact','Confirm who we are helping and link their CRM profile.'],
  ['Medicare & Medicaid','Eligibility dates and coverage assistance.'],
  ['Current coverage','What they have today and what works or does not.'],
  ['Doctors & pharmacies','People and locations that must remain accessible.'],
  ['Prescriptions','Medication information to verify coverage and costs.'],
  ['Needs & priorities','What matters most when comparing plans.'],
  ['Plan recommendation','Record the proposed plan and benefit comparison.'],
  ['Hospital protection','Optional indemnity needs and cost comparison.'],
  ['Review, SOA & follow-up','Document the conversation, next steps and outcome.']
];
const DOCTOR_COLS = [['name','Doctor name'],['specialty','Specialty'],['city','City'],['state','State'],['network','Network notes']];
const CARRIER_OPTIONS = ['Aetna','Humana','Cigna/Healthspring','Devoted','United Health Care'];
const NEED_KEYS = ['dental_need','vision_need','hearing_need','transport_need','otc_need','food_need','giveback_need'];
const needCheckbox = (key,label) => '<label class="at-field at-need-check"><input type="checkbox" name="'+key+'" value="yes"><span>'+esc(label)+'</span></label>';
const PHARMACY_COLS = [['name','Pharmacy'],['city','City'],['state','State'],['preferred','Preferred / notes']];
const MED_COLS = [['name','Medication'],['strength','Strength / dosage'],['notes','Notes']];

function control(name,label,kind='text',hint='') {
  const type = kind === 'date' ? 'text' : kind;
  const attrs = kind === 'date' ? ' data-at-date inputmode="numeric" maxlength="10" placeholder="MM/DD/YYYY"' :
    kind === 'number' ? ' inputmode="decimal" min="0" step="0.01" placeholder="0.00"' :
    kind === 'tel' ? ' inputmode="tel" autocomplete="tel"' : '';
  return '<label class="at-field"><span>' + esc(label) + '</span><input name="' + name + '" type="' + type + '"' + attrs + (hint ? ' placeholder="' + esc(hint) + '"' : '') + '></label>';
}
function choice(name,label,entries) {
  return '<label class="at-field"><span>' + esc(label) + '</span><select name="' + name + '">' +
    '<option value="">Select…</option>' + entries.map(x => '<option value="' + esc(x[0]) + '">' + esc(x[1]) + '</option>').join('') +
    '</select></label>';
}
function area(name,label,hint='') {
  return '<label class="at-field at-span"><span>' + esc(label) + '</span><textarea name="' + name + '" rows="3" placeholder="' + esc(hint) + '"></textarea></label>';
}
const yesNo = (name,label) => choice(name,label,[['yes','Yes'],['no','No'],['unknown','Not sure']]);
const options = (s) => s.map(x => [x,x]);
function repeatArea(kind,title,columns) {
  return '<div class="at-repeat-wrap at-span"><div class="at-repeat-title"><strong>' + esc(title) + '</strong></div>' +
    '<div data-at-repeat="' + kind + '" class="at-repeat"></div>' +
    '<button type="button" class="at-btn at-btn-soft" data-at-add="' + kind + '">+ Add ' + esc(title.slice(0,-1)) + '</button></div>';
}
function repeatRow(kind,index,data={}) {
  const cols = kind === 'doctors' ? DOCTOR_COLS : kind === 'pharmacies' ? PHARMACY_COLS : MED_COLS;
  const title=esc((kind === 'doctors' ? 'Doctor' : kind === 'pharmacies' ? 'Pharmacy' : 'Medication') + ' ' + (index+1));
  const fields=cols.map(([key,label]) => '<label class="at-field"><span>' + esc(label) + '</span><input name="' + key +
      '" value="' + esc(data[key] || '') + '" autocomplete="off"></label>').join('');
  if(kind==='doctors')return '<details class="at-repeat-row at-doctor-collapse" data-at-row="doctors" data-at-crm-id="'+esc(data.crm_id||'')+'"' +(index===0?' open':'')+'><summary><strong>'+title+(data.name?' — '+esc(data.name):'')+'</strong><span>Expand / Collapse</span></summary><div class="at-grid">'+fields+'</div><button class="at-text-btn" type="button" data-at-remove="doctors">Remove Doctor</button></details>';
  return '<div class="at-repeat-row" data-at-row="' + kind + '" data-at-crm-id="' + esc(data.crm_id || '') + '"><div class="at-row-head"><strong>' +
    title + '</strong><button class="at-text-btn" type="button" data-at-remove="' + kind + '">Remove</button></div><div class="at-grid">' + fields + '</div></div>';
}
function atSubsection(title,kind,fields){return '<fieldset class="at-subsection at-subsection-'+kind+' at-span"><legend>'+esc(title)+'</legend><div class="at-grid">'+fields+'</div></fieldset>';}
function sectionBody(index) {
  switch(index) {
    case 1: return control('first_name','First name') + control('last_name','Last name') + control('dob','Date of birth','date') +
      control('phone','Phone number','tel') + control('email','Email','email') + yesNo('veteran','Veteran') +
      control('address','Street address') + control('city','City') + control('state','State','text','MS') +
      control('zip','ZIP code','text','38801') + control('county','County') +
      choice('gender','Sex',[['male','Male'],['female','Female'],['other','Other / prefer not to say']]);
    case 2: return '<div class="at-note at-span">Medicare and Medicaid numbers are stored securely in the CRM vault.</div>' +
      atSubsection('Medicare','medicare', '<label class="at-field"><span>Medicare number (secure)</span><input name="medicare_number" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="25"></label>' +
      control('part_a','Part A effective date','date') + control('part_b','Part B effective date','date') ) +
      atSubsection('Medicaid','medicaid',
      '<label class="at-field"><span>Medicaid number (secure)</span><input name="medicaid_number" type="text" autocomplete="off" spellcheck="false" maxlength="35"></label>' +
      choice('medicaid_level','Medicaid level',[['QMB','QMB'],['QMB+','QMB+'],['SLMB','SLMB'],['SLMB+','SLMB+'],['FBDE','Full Benefit Dual Eligible'],['QI','QI'],['QDWI','QDWI'],['other','Other']]) +
      area('eligibility_notes','Eligibility / assistance notes') ) +
      atSubsection('SunFire','sunfire', control('sunfire_code','SunFire Code','text','Enter SunFire Code')) +
      atSubsection('Medicare.gov','medicare-gov', '<label class="at-field"><span>Username</span><input name="medicare_gov_username" autocomplete="off" autocapitalize="none" spellcheck="false"></label>' +
      '<label class="at-field"><span>Password</span><input name="medicare_gov_password_temporary" type="text" autocomplete="off" spellcheck="false"></label>' +
      '<label class="at-field"><span>Verification Type</span><select name="medicare_gov_verification_type_temporary"><option value="">Select…</option><option value="text">Text</option><option value="email">Email</option></select></label>' +
      '<label class="at-field" data-at-medicare-gov-verification="text"><span>Verification Phone Number</span><input name="medicare_gov_verification_phone_temporary" type="tel"></label>' +
      '<label class="at-field" data-at-medicare-gov-verification="email"><span>Verification Email</span><input name="medicare_gov_verification_email_temporary" type="email"></label>' +
      '<label class="at-field at-span"><span>Security Answer</span><input name="medicare_gov_security_answer_temporary" type="text" autocomplete="off" spellcheck="false"></label>');
    case 3: return '<div class="at-old-plan-details at-span"><h3>Old Plan Details</h3><div class="at-old-plan-grid">' +
      choice('old_plan_carrier','Insurance Company',[...CARRIER_OPTIONS,'Blue Cross Blue Shield','Wellcare','Original Medicare','Other'].map(x=>[x,x])) +
      control('old_plan_id','Plan ID') + control('old_plan_member_id','Member ID') + control('old_plan_year','Year','text','2026') +
      '</div></div>' + choice('current_carrier','Current carrier',CARRIER_OPTIONS.map(x=>[x,x])) + '<input type="hidden" name="current_plan">' +
      control('current_plan_id','Plan ID') + control('current_year','Plan year','text','2027') +
      control('current_member_id','Member ID') +
      choice('current_plan_type','Plan type',[['HMO','HMO'],['PPO','PPO'],['HMO-POS','HMO-POS'],['D-SNP','D-SNP'],['C-SNP','C-SNP'],['Medigap','Supplement'],['Original Medicare','Original Medicare'],['Other','Other']]) +
      control('current_premium','Monthly plan premium','number') +
      area('current_like','Benefits or features they want to keep') + area('current_dislike','Problems with current coverage');
    case 4: return repeatArea('doctors','Doctors',DOCTOR_COLS) + repeatArea('pharmacies','Pharmacies',PHARMACY_COLS) +
      '<p class="at-helper at-span">Record the doctor\'s preferred location. Verify network status directly with the plan before enrollment.</p>';
    case 5: return repeatArea('medications','Medications',MED_COLS) +
      '<p class="at-helper at-span">Confirm medication strengths, quantity, preferred pharmacy, formulary and any prior authorization requirements.</p>';
    case 6: return area('care_priorities','Top priorities','What matters most: cost, doctors, dental, prescriptions, etc.') +
      needCheckbox('dental_need','Dental / dentures') + needCheckbox('vision_need','Vision') +
      needCheckbox('hearing_need','Hearing') + needCheckbox('transport_need','Transportation') +
      needCheckbox('otc_need','OTC allowance') + needCheckbox('food_need','Food / utilities') +
      needCheckbox('giveback_need','Part B giveback') +
      area('preferred_hospitals','Preferred hospitals and specialists');
    case 7: return control('recommended_carrier','Recommended carrier') + control('recommended_plan','Recommended plan') +
      control('new_effective','Planned start date','date') +
      control('new_premium','Monthly premium','number') + control('new_moop','In-network medical MOOP','number') +
      control('dental_benefit','Dental') + control('vision_benefit','Vision') + control('hearing_benefit','Hearing') +
      control('otc_benefit','OTC amount / frequency') + control('food_benefit','Food / utility benefits') +
      control('transport_benefit','Transportation') + control('giveback_benefit','Part B giveback') +
      control('pcp_copay','PCP copay') + control('specialist_copay','Specialist copay') +
      control('hospital_copay','Inpatient hospital cost per day') +
      yesNo('doctor_network_verified','Doctor network verified?') + yesNo('drug_coverage_verified','Drugs / pharmacy verified?') +
      area('recommendation_reason','Why this plan was recommended');
    case 8: return control('hip_hospital_day','Hospital cost per day','number') + control('hip_days','Hospital days','number') +
      control('hip_hospital_total','Hospital total price','number') + '<div class="at-span"></div>' +
      control('hip_ambulance_cost','Ambulance cost','number') + control('hip_ambulance','Ambulance total','number') +
      control('hip_outpatient_cost','Outpatient cost','number') + control('hip_outpatient','Outpatient total','number') +
      control('hip_cancer_face','Cancer face amount','number') + control('hip_cancer','Cancer total','number') +
      control('hip_snf_cost','Skilled nursing cost','number') + control('hip_snf','Skilled nursing total','number') +
      '<div class="at-hip-total at-span">Total planned HIP amount <strong data-at-hip-total>$0.00</strong></div>' +
      area('hip_notes','Hospital indemnity comparison / notes');
    case 9: return '<div class="at-span" style="border:1.5px solid #8baaa2;border-radius:11px;padding:14px;background:#eaf3ef"><strong>Scope of Appointment — Complete SOA</strong><p class="at-helper">Use the same secure SOA process as Client Records. Signed SOAs are saved in the client\'s Documents folder.</p><div style="display:flex;flex-wrap:wrap;gap:9px;margin:10px 0"><button type="button" class="at-btn at-btn-primary" data-at-soa-text>Text SOA</button><button type="button" class="at-btn at-btn-soft" data-at-soa-sign>Sign Now</button><button type="button" class="at-btn at-btn-soft" data-at-soa-view>View Signed SOA</button></div><p class="at-helper" data-at-soa-message role="status">For a new client, the client record will be created before signing or texting.</p></div>' + control('review_date','Conversation date','date') +
      choice('soa_status','Scope of Appointment (SOA)',[['signed','Signed'],['not_signed','Not signed'],['not_required','Not required / confirmed'],['pending','Pending']]) +
      area('soa_reason','SOA details / reason if not signed') +
      area('private_notes','Additional review notes') +
      '<div class="at-span at-appointment-action"><strong>Another appointment</strong><p class="at-helper">Schedule a follow-up in the CRM appointment calendar.</p><button type="button" class="at-btn at-btn-soft" data-at-schedule-appointment>+ Set Appointment</button></div>' +
      '<p class="at-helper at-span">Recording an SOA status here does not replace the signed Scope of Appointment. Confirm plan and eligibility details in official carrier/CMS documents.</p>';
    default: return '';
  }
}
function stepMarkup(index) {
  const [title,subtitle] = SECTIONS[index-1];
  return '<details class="at-step" data-at-step="' + index + '"' + (index === 1 ? ' open' : '') + '>' +
    '<summary><span class="at-step-no">' + String(index).padStart(2,'0') + '</span><span class="at-step-title"><strong>' + esc(title) +
    '</strong><small>' + esc(subtitle) + '</small></span><span class="at-step-state" data-at-state>Not started</span><span class="at-arrow">⌄</span></summary>' +
    '<div class="at-step-inner"><label class="at-skip"><input type="checkbox" data-at-skip="' + index +
    '"><span>Already in CRM — skip this section</span></label>' +
    '<div data-at-step-fields><div class="at-grid">' + sectionBody(index) + '</div></div>' +
    '<div class="at-skipped" data-at-skipped hidden>Already recorded in the CRM. You can skip this section or uncheck the box to update it here.</div>' +
    '<div class="at-step-actions"><button type="button" class="at-btn at-btn-outline" data-at-next="' + index + '">' +
    (index === SECTIONS.length ? 'Finish review' : 'Continue →') + '</button></div></div></details>';
}
function dateInput(raw) {
  if (!raw) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? dateText(raw) : String(raw);
}
function cleanDate(value,label) {
  if (!value) return null;
  const date = dateISO(value);
  if (!date) throw Error('Enter ' + label + ' as MM/DD/YYYY.');
  return date;
}
function maskDate(value) {
  const d = String(value || '').replace(/\D/g,'').slice(0,8);
  return d.slice(0,2) + (d.length > 2 ? '/' + d.slice(2,4) : '') + (d.length > 4 ? '/' + d.slice(4) : '');
}
function displayName(c) { return [c?.first_name,c?.last_name].filter(Boolean).join(' ').trim(); }
function num(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function dollars(value) { return num(value).toLocaleString('en-US',{style:'currency',currency:'USD'}); }
function mimeOf(file) {
  const ext = String(file.name || '').toLowerCase().split('.').pop();
  return file.type || ({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',pdf:'application/pdf'})[ext];
}
function shortFileName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,90); }

export function createAthenaMedicareFeature() {
  let host=null, mode='home', record=null, linkedClient=null, files=[],queued=[],busy=false,dirty=false;
  let epoch=0, searchToken=0, searchTimer=0, medicareGovLoadToken=0, vaultOriginal={}, vaultLoaded=false;
  let crmLoadToken=0, recoveryTimer=0, recoveryWrites=Promise.resolve(), recoveryUserPromise=null;
  const editedFields=new Set(), editedLists=new Set(), editedRows=new Set();
  const active = () => host?.isConnected;
  const canLeave = () => !busy && (!dirty || window.confirm('Athena\'s Medicare has unsaved changes. Leave this screen? A secure recovery draft will stay on this device.'));
  const say = (msg,error=false) => {
    if (!host) return;
    host.querySelectorAll('[data-at-status]').forEach(node => {
      node.textContent=msg; node.classList.toggle('at-error',error);
    });
  };
  function recoveryUser() {
    if(!recoveryUserPromise)recoveryUserPromise=supabase.auth.getUser()
      .then(({data,error})=>{if(error)throw error;return data?.user?.id||null;})
      .catch(()=>{recoveryUserPromise=null;return null;});
    return recoveryUserPromise;
  }
  // Capture even incomplete dates and form sections: a recovery draft must not
  // fail validation just because an agent was interrupted mid-keystroke.
  // Never capture Medicare/Medicaid IDs, passwords, verification secrets or files.
  function captureRecovery() {
    if(mode!=='edit'||!dirty||!host?.querySelector('.at-form'))return null;
    const form=host.querySelector('.at-form'),data={};
    for(const field of Object.values(FIELD_GROUPS).flat()){
      if(field.startsWith('medicare_gov_'))continue;
      const input=form.elements.namedItem(field);
      data[field]=input?.type==='checkbox'?(input.checked?'yes':'no'):String(input?.value||'');
    }
    data.overview_notes=String(form.elements.namedItem('overview_notes')?.value||'');
    for(const kind of ['doctors','pharmacies','medications'])data[kind]=collectRows(kind);
    data.skipped_sections=skipped();
    const open=host.querySelector('[data-at-step][open]');
    return {
      version:1,review_kind:record?.review_kind||form.elements.namedItem('review_kind')?.value||'new_intake',
      record_id:record?.id||'',record_updated_at:record?.updated_at||'',client_id:linkedClient?.id||'',
      data,edited_fields:[...editedFields],edited_lists:[...editedLists],edited_rows:[...editedRows],
      active_step:Number(open?.dataset.atStep)||1,queued_file_count:queued.length,
      saved_at:new Date().toISOString()
    };
  }
  function persistRecovery() {
    clearTimeout(recoveryTimer);
    const snapshot=captureRecovery();
    if(!snapshot)return recoveryWrites;
    const task=recoveryWrites.catch(()=>{}).then(async()=>{
      const uid=await recoveryUser();
      if(!uid)throw Error('Sign in to enable draft recovery.');
      await saveAthenaRecoveryDraft(uid,snapshot);
    });
    recoveryWrites=task;
    task.then(()=>{
      if(mode==='edit'&&dirty&&host?.querySelector('.at-form'))
        say('Recovery draft saved automatically on this device.');
    }).catch(error=>{
      if(mode==='edit'&&dirty&&host?.querySelector('.at-form'))
        say('Automatic draft recovery is unavailable: '+(error.message||'Save your review manually.'),true);
    });
    return task;
  }
  function scheduleRecovery() {
    if(mode!=='edit'||!dirty)return;
    clearTimeout(recoveryTimer);
    recoveryTimer=setTimeout(()=>{void persistRecovery();},350);
  }
  function clearRecovery() {
    clearTimeout(recoveryTimer);
    const task=recoveryWrites.catch(()=>{}).then(async()=>{
      const uid=await recoveryUser();
      if(uid)await clearAthenaRecoveryDraft(uid);
    });
    recoveryWrites=task;
    return task;
  }
  async function recoverOnOpen() {
    const request=epoch;
    try{
      const uid=await recoveryUser();
      if(!uid)return;
      const saved=await readAthenaRecoveryDraft(uid);
      if(!saved||request!==epoch||!active()||mode!=='home')return;
      let existing={review_kind:saved.review_kind},client=null,stale=false;
      if(saved.record_id){
        const {data,error}=await supabase.from(TABLE).select('*').eq('id',saved.record_id).single();
        if(error)throw error;
        existing=data;
        stale=!!saved.record_updated_at && data.updated_at!==saved.record_updated_at;
        if(stale)existing={...data,updated_at:saved.record_updated_at};
      }
      if(saved.client_id){
        const {data,error}=await supabase.from('clients')
          .select('id,first_name,last_name,phone,date_of_birth,email,address1,city,state,zip_code,county,gender,veteran')
          .eq('id',saved.client_id).single();
        if(error)throw error;
        client=data;
      }
      if(request!==epoch||!active()||mode!=='home')return;
      reset();record=existing;linkedClient=client;
      renderEditor(saved.data||{});
      editedFields.clear();(saved.edited_fields||[]).forEach(x=>editedFields.add(x));
      editedLists.clear();(saved.edited_lists||[]).forEach(x=>editedLists.add(x));
      editedRows.clear();(saved.edited_rows||[]).forEach(x=>editedRows.add(x));
      const step=host.querySelector('[data-at-step="'+(saved.active_step||1)+'"]');
      if(step){host.querySelectorAll('[data-at-step]').forEach(x=>x.open=false);step.open=true;}
      dirty=true;updateSections();
      const warning=saved.queued_file_count?' Any attachments not uploaded yet must be selected again.':'';
      say('Your '+(saved.review_kind==='annual_review'?'Medicare review':'Medicare intake')+
        ' was recovered from this device. Medicare/Medicaid numbers and login credentials were not stored in the recovery draft.'+
        (stale?' The saved record changed elsewhere; reopen it before saving to avoid overwriting newer work.':'')+warning);
      if(client){
        void loadOverviewNotes(client.id);
        void loadCRMForClient(client.id,!existing?.id);
        void loadMedicareGovFromCRM(client.id);
        void readVault(client.id);
        if(existing?.id)void loadFileList();
      }
    }catch(error){
      if(request===epoch&&mode==='home'&&active()){
        const top=host.querySelector('.at-home-grid');
        if(top){
          const notice=document.createElement('p');
          notice.className='at-error';
          notice.textContent='An Athena recovery draft exists but could not be restored: '+(error.message||'Please retry.');
          top.insertAdjacentElement('beforebegin',notice);
        }
      }
    }
  }
  const onAppHidden=()=>{if(document.visibilityState==='hidden')void persistRecovery();};
  const onPageHide=()=>{void persistRecovery();};
  function reset() {
    record=null;linkedClient=null;files=[];queued=[];dirty=false;busy=false;vaultOriginal={};vaultLoaded=false;
    editedFields.clear();editedLists.clear();editedRows.clear();++crmLoadToken;
    clearTimeout(searchTimer);++searchToken;
  }
  function hero(subtitle) {
    return '<div class="at-hero"><div class="at-eyebrow">ARCTOS / ATHENA WORKSPACE</div>' +
      '<div class="at-hero-row"><div><h2>Athena\'s Medicare</h2><p>' + esc(subtitle) +
      '</p></div><span class="at-hero-mark">A<span>+</span></span></div></div>';
  }
  function home() {
    mode='home';reset();
    ++epoch;
    host.innerHTML = '<div class="at-app">' + hero('A dedicated workspace for thoughtful Medicare conversations, from first enrollment to annual review.') +
      '<div class="at-home-grid">' +
      '<button class="at-start-card" type="button" data-at-new="new_intake"><span class="at-card-num">01 / NEW</span><strong>New Medicare intake</strong><small>Build a client profile, confirm eligibility and record plan recommendations.</small><span class="at-card-link">Start intake →</span></button>' +
      '<button class="at-start-card" type="button" data-at-new="annual_review"><span class="at-card-num">02 / EXISTING</span><strong>Annual Medicare review</strong><small>Link an existing CRM client, identify changes and document next steps.</small><span class="at-card-link">Start review →</span></button>' +
      '<a class="at-start-card at-start-card-wide at-compare-card" href="#/ma-plans" data-at-compare><span class="at-card-num">03 / COMPARE</span><strong>Compare Medicare plans</strong><small>Review available Mississippi Medicare Advantage plans and compare 2027 coverage and benefits.</small><span class="at-card-link">Compare plans →</span></a>' +
      '<button class="at-start-card at-start-card-wide" type="button" data-at-saved><span class="at-card-num">YOUR WORK</span><strong>All saved reviews</strong><small>Browse previously saved Athena records.</small><span class="at-card-link">Open saved work →</span></button></div>' +
      '<section class="at-unfinished-home" aria-label="Unfinished client reviews"><div class="at-unfinished-head"><strong>Unfinished Client Reviews</strong><small>Pick up an unfinished review only when you choose to.</small></div><div data-at-unfinished-list><p class="at-helper">Checking unfinished reviews…</p></div></section>' +
      '<div class="at-security-line"><strong>Private by design.</strong> Your records stay in this CRM under your existing access permissions. Never enter card CVVs, payment-card numbers or Social Security numbers in notes.</div></div>';
    void loadUnfinishedHome();
  }
  async function loadUnfinishedHome(){
    const container=host?.querySelector('[data-at-unfinished-list]');
    if(!container)return;
    const request=epoch;
    try{
      const uid=await recoveryUser();
      const [local,remote]=await Promise.all([
        uid?readAthenaRecoveryDraft(uid).catch(()=>null):Promise.resolve(null),
        supabase.from(TABLE).select('id,full_name,review_kind,workflow_status,updated_at')
          .neq('workflow_status','completed').order('updated_at',{ascending:false}).limit(100)
      ]);
      if(request!==epoch||mode!=='home'||!container.isConnected)return;
      if(remote.error)throw remote.error;
      const seen=new Set();
      const rows=[];
      if(local){
        const name=[local.data?.first_name,local.data?.last_name].filter(Boolean).join(' ')||'Unfinished client review';
        rows.push('<div class="at-unfinished-item"><div><strong>'+esc(name)+'</strong><small>Unsaved changes on this device · '+esc(local.saved_at?new Date(local.saved_at).toLocaleString('en-US'):'Recent')+'</small></div><button type="button" class="at-btn at-btn-primary" data-at-resume-local>Resume</button><button type="button" class="at-btn at-btn-delete" data-at-delete-local>Delete</button></div>');
        if(local.record_id)seen.add(local.record_id);
      }
      for(const row of remote.data||[]){
        if(seen.has(row.id))continue;
        rows.push('<div class="at-unfinished-item"><div><strong>'+esc(row.full_name||'Unnamed client')+'</strong><small>'+esc(row.review_kind==='annual_review'?'Annual Medicare review':'New Medicare intake')+' · '+esc(new Date(row.updated_at).toLocaleDateString('en-US'))+'</small></div><button type="button" class="at-btn at-btn-soft" data-at-open="'+esc(row.id)+'">Continue</button><button type="button" class="at-btn at-btn-delete" data-at-delete="'+esc(row.id)+'" data-at-name="'+esc(row.full_name||'this client')+'" data-at-updated="'+esc(row.updated_at)+'">Delete</button></div>');
      }
      container.innerHTML=rows.length?'<div class="at-unfinished-grid">'+rows.join('')+'</div>':'<p class="at-helper">No unfinished client reviews. Start a new intake or annual review above.</p>';
    }catch(error){
      if(request===epoch&&mode==='home'&&container.isConnected)
        container.textContent='Could not load unfinished reviews: '+(error.message||'Please retry.');
    }
  }
  function clientPicker() {
    const label = linkedClient ? '<div class="at-linked"><div><small>LINKED CRM CLIENT</small><strong>' + esc(displayName(linkedClient)) +
      '</strong><span>' + esc(linkedClient.phone || '') + '</span></div>' +
      '<button type="button" class="at-btn at-btn-soft" data-at-unlink>Change client</button></div>' : '';
    return '<div class="at-client-picker"><div class="at-client-pick-head"><div><strong>Link to CRM client</strong><small>' +
      (record?.review_kind === 'annual_review' ? 'Required for an annual review.' : 'Recommended to avoid duplicate records; new clients can be created when saving.') +
      '</small></div></div>' + label +
      (linkedClient ? '' : '<label class="at-field at-search"><span>Find existing client by name or phone</span>' +
      '<input type="search" data-at-client-search placeholder="Search clients…" autocomplete="off"></label>' +
      '<div data-at-client-results class="at-client-results"></div>') + '</div>';
  }
  function renderEditor(data={}) {
    mode='edit';
    const type = record?.review_kind || data.review_kind || 'new_intake';
    const heading=type==='annual_review' ? 'Annual Medicare review' : 'New Medicare intake';
    host.innerHTML='<div class="at-app">' + hero('A clear record of eligibility, needs, comparison, and follow-through.') +
      '<div class="at-toolbar"><button type="button" class="at-btn at-btn-soft" data-at-home>← Workspace</button>' +
      '<div class="at-toolbar-right"><span class="at-kind">' + esc(heading) + '</span>' +
      (record?.id ? '<button type="button" class="at-btn at-btn-delete" data-at-delete>Delete</button>' : '') +
      '<button type="button" class="at-btn at-btn-primary" data-at-save>Save review</button></div></div>' +
      '<div class="at-form-layout"><div class="at-form-main">' +
      '<div class="at-overview"><strong>' + esc(heading) + '</strong><p>Open each section, record the conversation and save as a draft or completed review. When linked to a CRM client, edits to contact information, Medicare details, current coverage, doctors, medications and the first two pharmacies also update that client record when saved. Sections marked Already in CRM are not changed. A recommended future plan stays a recommendation until enrollment.</p></div>' +
      clientPicker() +
      '<form class="at-form" autocomplete="off" novalidate><input type="hidden" name="review_kind" value="' + esc(type) + '">' +
      '<section class="at-overview-client-note"><strong>Notes</strong><p class="at-helper">These notes are shared with the Client Records Overview note. Saving this review updates the same note.</p><textarea name="overview_notes" rows="4" placeholder="Client overview notes…"></textarea></section>' +
      '<div class="at-steps">' + SECTIONS.map((_,i)=>stepMarkup(i+1)).join('') + '</div>' +
      '<div class="at-attachments"><div><strong>Supporting documents</strong><p>Securely attach plan letters, medication lists or pharmacy pictures. Files upload when you save.</p></div>' +
      '<div class="at-attachment-actions"><label class="at-btn at-btn-soft at-file-button">+ Add photos or PDFs<input type="file" data-at-files accept="image/*,application/pdf" multiple hidden></label><label class="at-btn at-btn-soft at-file-button">Take Picture<input type="file" data-at-files data-at-camera accept="image/*" capture="environment" hidden></label></div>' +
      '<div class="at-drop-zone" data-at-drop-zone role="region" aria-label="Drop supporting documents here" tabindex="0">Drag and drop photos or PDFs here, or use the buttons above.</div>' +
      '<div data-at-file-list class="at-file-list"></div></div>' +
      '<div class="at-save-footer"><span data-at-status role="status" aria-live="polite">Ready to complete.</span>' +
      '<button type="button" class="at-btn at-btn-primary" data-at-save>Save Athena review</button></div>' +
      '</form></div><aside class="at-sidebar"><div class="at-side-card"><span class="at-side-overline">WORKFLOW</span><h3>Your review checklist</h3>' +
      '<div data-at-progress><strong>0 of 9</strong><small>sections recorded or skipped</small></div>' +
      '<div class="at-progress-track"><i data-at-progress-bar></i></div>' +
      '<p>Use “Already in CRM” where the information is already recorded. Your review will remember what you skipped.</p></div>' +
      '<div class="at-side-card at-side-note"><strong>Need a second opinion?</strong><p>Verify benefits with current official plan documents. This form records your discussion, not a guarantee of enrollment or coverage.</p></div></aside></div></div>';
    const form=host.querySelector('.at-form');
    form.elements.namedItem('medicare_gov_verification_type_temporary')?.addEventListener('change',()=>updateMedicareGovVisibility(form));
    updateMedicareGovVisibility(form);
    for(const keys of Object.values(FIELD_GROUPS)) for(const key of keys){
      const el=form.elements.namedItem(key);
      if (!el) continue;
      if(el.type==='checkbox')el.checked=data[key]==='yes'||data[key]===true;
      else if(el.tagName==='SELECT' && data[key] && !Array.from(el.options).some(option=>option.value===String(data[key]))) {
        el.add(new Option(String(data[key])+' (Existing)',String(data[key])));
        el.value=String(data[key]);
      }else el.value=DATE_FIELDS.has(key) ? dateInput(data[key]) : String(data[key] ?? '');
    }
    const overviewNote=form.elements.namedItem('overview_notes');
    if(overviewNote)overviewNote.value=String(data.overview_notes??'');
    const skipped=new Set(Array.isArray(data.skipped_sections) ? data.skipped_sections.map(Number) : []);
    host.querySelectorAll('[data-at-skip]').forEach(x=>x.checked=skipped.has(Number(x.dataset.atSkip)));
    const statusField=form.elements.namedItem('workflow_status');
    if(statusField)statusField.value=record?.workflow_status||data.workflow_status||'draft';
    for(const kind of ['doctors','pharmacies','medications']) {
      const rows=Array.isArray(data[kind]) && data[kind].length ? data[kind] : [{}];
      const box=host.querySelector('[data-at-repeat="'+kind+'"]');
      if(box)box.innerHTML=rows.map((x,i)=>repeatRow(kind,i,x)).join('');
    }
    fillFiles();
    bindAthenaDocuments(host,()=>linkedClient?.id,ensureAthenaClient);
    updateSections(); calcHip();
    dirty=false;
    say(record?.id ? 'Saved review loaded. Changes you make will also update the linked CRM client.' : 'New review — nothing saved yet.');
  }
  function updateSections() {
    const form=host?.querySelector('.at-form');if(!form)return;
    let done=0;
    host.querySelectorAll('[data-at-step]').forEach(section=>{
      const number=Number(section.dataset.atStep);
      const skipped=section.querySelector('[data-at-skip]')?.checked;
      section.classList.toggle('at-is-skipped',Boolean(skipped));
      const fieldBox=section.querySelector('[data-at-step-fields]');
      const message=section.querySelector('[data-at-skipped]');
      if(fieldBox)fieldBox.hidden=!!skipped;
      if(message)message.hidden=!skipped;
      const filled=FIELD_GROUPS[number].some(key=>{const el=form.elements.namedItem(key);return el?.type==='checkbox'?el.checked:String(el?.value||'').trim();}) ||
        (number===4 && (collectRows('doctors').length || collectRows('pharmacies').length)) ||
        (number===5 && collectRows('medications').length);
      if(skipped || filled)done++;
      const label=section.querySelector('[data-at-state]');
      if(label)label.textContent=skipped?'In CRM ✓':filled?'In progress':'Not started';
    });
    const progress=host.querySelector('[data-at-progress]');
    if(progress)progress.innerHTML='<strong>'+done+' of '+SECTIONS.length+'</strong><small>sections recorded or skipped</small>';
    const bar=host.querySelector('[data-at-progress-bar]');
    if(bar)bar.style.width=Math.round(100*done/SECTIONS.length)+'%';
  }
  function collectRows(kind) {
    if(!host)return[];
    return Array.from(host.querySelectorAll('[data-at-row="'+kind+'"]')).map(node=>{
      const out={};
      node.querySelectorAll('input').forEach(i=>out[i.name]=i.value.trim());
      if(Object.values(out).some(Boolean)){
        if(!node.dataset.atCrmId)node.dataset.atCrmId=crypto.randomUUID();
        out.crm_id=node.dataset.atCrmId;
      }
      return out;
    }).filter(row=>Object.values(row).some(Boolean));
  }
  function skipped() {
    return Array.from(host?.querySelectorAll('[data-at-skip]:checked')||[],i=>Number(i.dataset.atSkip));
  }
  function collectData() {
    const form=host.querySelector('.at-form'),result={},skip=new Set(skipped());
    const previous=record?.form_data||{};
    for(const [number,keys] of Object.entries(FIELD_GROUPS)){
      for(const key of keys){
        const element=form.elements.namedItem(key);
        let val=element?.type==='checkbox'?(element.checked?'yes':'no'):String(element?.value||'').trim();
        if(skip.has(Number(number)))val=String(previous[key]||'');
        if(DATE_FIELDS.has(key) && val){
          if(!skip.has(Number(number)))val=cleanDate(val,key.replaceAll('_',' '));
        }
        result[key]=val;
      }
    }
    for(const [step,kind] of [[4,'doctors'],[4,'pharmacies'],[5,'medications']])
      result[kind]=skip.has(step) ? (previous[kind]||[]) : collectRows(kind);
    result.overview_notes=String(form.elements.namedItem('overview_notes')?.value||'');
    result.skipped_sections=[...skip];
    result.hip_total=HIP_TOTALS.reduce((sum,key)=>sum+num(result[key]),0).toFixed(2);
    result.schema_version=1;
    return result;
  }
  function calcHip(){
    const total=HIP_TOTALS.reduce((sum,key)=>sum+num(host?.querySelector('[name="'+key+'"]')?.value),0);
    const out=host?.querySelector('[data-at-hip-total]');if(out)out.textContent=dollars(total);
  }
  function fillFiles(){
    const box=host?.querySelector('[data-at-file-list]');if(!box)return;
    box.innerHTML=files.map(f=>'<div class="at-file"><span>📎 '+esc(f.file_name)+'</span><button class="at-text-btn" type="button" data-at-view="'+esc(f.id)+'">View</button></div>').join('') +
      queued.map((f,i)=>'<div class="at-file"><span>⏳ '+esc(f.name)+' — queued</span><button class="at-text-btn" type="button" data-at-unqueue="'+i+'">Remove</button></div>').join('') ||
      '<small>No attachments added yet.</small>';
  }
  async function invokeSensitive(body) {
    const {data,error}=await supabase.functions.invoke('client-sensitive',{body});
    if(error)throw error;
    if(data?.error)throw Error(data.error);
    return data?.sensitive||{};
  }
  async function readVault(clientId) {
    const task=++epoch;
    try{
      const data=await invokeSensitive({action:'get',client_id:clientId});
      if(task!==epoch || !active() || linkedClient?.id!==clientId)return;
      vaultOriginal=data;vaultLoaded=true;
      const form=host.querySelector('.at-form');
      if(!form)return;
      for(const name of ['medicare_number','medicaid_number']){
        const el=form.elements.namedItem(name);
        if(el && !el.value)el.value=String(data[name]||'');
      }
    }catch(error){
      if(task===epoch) say('Existing secure ID fields could not load. You can still save your review; retry the secure fields later.',true);
    }
  }
  async function findClients(text) {
    const term=String(text||'').trim().replace(/[%*,"()]/g,' ').slice(0,80);
    const results=host?.querySelector('[data-at-client-results]');
    const token=++searchToken;
    if(!results)return;
    if(term.length<2){results.replaceChildren();return;}
    results.textContent='Searching CRM clients…';
    try{
      const q='"%'+term.replaceAll('"','')+'%"';
      const {data,error}=await supabase.from('clients')
        .select('id,first_name,last_name,phone,date_of_birth,email,address1,city,state,zip_code,county,gender,veteran')
        .or('first_name.ilike.'+q+',last_name.ilike.'+q+',phone.ilike.'+q)
        .order('last_name').limit(15);
      if(error)throw error;
      if(token!==searchToken || !results.isConnected)return;
      results.innerHTML=(data||[]).length?(data||[]).map(x=>
        '<button type="button" class="at-client-option" data-at-select-client="'+esc(x.id)+'"><strong>'+esc(displayName(x))+
        '</strong><small>'+esc(x.phone||x.date_of_birth||'')+'</small></button>').join('') :
        '<span class="at-helper">No matching CRM clients found.</span>';
      results._athenaClients=data||[];
    }catch(error){
      if(token===searchToken && results.isConnected)results.textContent='Unable to search CRM clients: '+(error.message||'Please retry.');
    }
  }
  async function loadOverviewNotes(clientId){
    try{
      const {data,error}=await supabase.from('clients').select('notes').eq('id',clientId).single();
      if(error)throw error;
      if(linkedClient?.id!==clientId || !host?.querySelector('.at-form'))return;
      const field=host.querySelector('[name="overview_notes"]');
      if(field && !editedFields.has('overview_notes'))field.value=String(data.notes||'');
    }catch(error){console.warn('Could not load client overview notes',error);}
  }
  function selectClient(client){
    const replacingClient=Boolean(linkedClient?.id && linkedClient.id!==client.id);
    linkedClient=client; ++searchToken; clearTimeout(searchTimer);
    const picker=host.querySelector('.at-client-picker');
    if(picker)picker.outerHTML=clientPicker();
    const form=host.querySelector('.at-form');
    const copy={first_name:client.first_name,last_name:client.last_name,dob:dateInput(client.date_of_birth),
      phone:client.phone,email:client.email,address:client.address1,city:client.city,state:client.state,zip:client.zip_code,
      county:client.county,gender:client.gender,veteran:client.veteran===true?'yes':client.veteran===false?'no':''};
    for(const [key,value] of Object.entries(copy)){
      const field=form?.elements.namedItem(key);
      if(field && !field.value)field.value=String(value||'');
    }
    vaultOriginal={};vaultLoaded=false;
    if(replacingClient)for(const name of ['medicare_number','medicaid_number']){
      const el=form?.elements.namedItem(name);if(el)el.value='';
    }
    void readVault(client.id);
    void loadOverviewNotes(client.id);
    void loadMedicareGovFromCRM(client.id);
    void loadCRMForClient(client.id, !record?.id);
    dirty=true;updateSections();scheduleRecovery();
    host.querySelector('[data-at-doc-refresh]')?.click();
    say('Linked to existing CRM client '+displayName(client)+'.');
  }

  function updateMedicareGovVisibility(form) {
    const type=String(form?.elements.namedItem('medicare_gov_verification_type_temporary')?.value||'');
    for(const node of form?.querySelectorAll('[data-at-medicare-gov-verification]')||[])
      node.hidden=node.dataset.atMedicareGovVerification!==type;
  }
  // Load the separate encrypted Medicare.gov record directly from the CRM.
  // Secrets remain transient DOM values and never enter Athena form_data.
  async function loadMedicareGovFromCRM(clientId) {
    const token=++medicareGovLoadToken;
    try {
      const {data,error}=await supabase.functions.invoke('medicare-gov-credentials',{body:{action:'get',client_id:clientId}});
      if(error)throw error;
      if(data?.error)throw Error(data.error);
      if(token!==medicareGovLoadToken || linkedClient?.id!==clientId || !active())return;
      const credentials=data?.credentials || {};
      const form=host.querySelector('.at-form');
      if(!form)return;
      const assign=(name,value,overwrite=false)=>{
        const field=form.elements.namedItem(name);
        if(field && (overwrite || (!field.value && !editedFields.has(name))))
          field.value=String(value??'');
      };
      assign('medicare_gov_username',credentials.username);
      if(credentials.verification_type==='email')assign('medicare_gov_email',credentials.verification_destination);
      assign('medicare_gov_password_temporary',credentials.password,true);
      assign('medicare_gov_verification_type_temporary',credentials.verification_type,true);
      assign('medicare_gov_verification_phone_temporary',credentials.verification_type==='text'?credentials.verification_destination:'',true);
      assign('medicare_gov_verification_email_temporary',credentials.verification_type==='email'?credentials.verification_destination:'',true);
      updateMedicareGovVisibility(form);
      assign('medicare_gov_security_answer_temporary',credentials.security_answer,true);
    }catch(error){
      if(token===medicareGovLoadToken)console.warn('Medicare.gov CRM credentials unavailable:',error);
    }
  }
  // Bring existing CRM information into a freshly linked intake. Respect
  // values the agent already typed, and never overwrite saved review history.
  async function loadCRMForClient(clientId,fillBlanks=true) {
    const token=++crmLoadToken;
    try {
      const crm=await loadAthenaClientSections(supabase,clientId);
      if(token!==crmLoadToken || linkedClient?.id!==clientId || !active())return;
      const form=host.querySelector('.at-form');
      if(!form)return;
      if(fillBlanks){
        for(const [name,value] of Object.entries(crm.fields)){
          const input=form.elements.namedItem(name);
          if(input && !String(input.value||'').trim() && !editedFields.has(name)){
            input.value=DATE_FIELDS.has(name)?dateInput(value):String(value??'');
          }
        }
      }
      for(const kind of ['doctors','medications','pharmacies']){
        const box=host.querySelector('[data-at-repeat="'+kind+'"]');
        if(!box)continue;
        const have=collectRows(kind);
        if(fillBlanks && !editedLists.has(kind) && !have.length && crm[kind]?.length){
          box.innerHTML=crm[kind].map((row,i)=>repeatRow(kind,i,row)).join('');
        }else if(kind!=='pharmacies'){
          // Older Athena reviews did not store CRM row IDs. Resolve the
          // connection by name before edits to avoid accidental duplicates.
          const saved=crm[kind]||[];
          for(const node of box.querySelectorAll('[data-at-row]')){
            if(node.dataset.atCrmId)continue;
            const name=node.querySelector('input[name="name"]')?.value?.trim().toLowerCase();
            const match=name&&saved.find(x=>x.name?.trim().toLowerCase()===name);
            if(match)node.dataset.atCrmId=match.crm_id;
          }
        }
      }
      updateSections();
    }catch(error) {
      if(token===crmLoadToken && active())say(
        'Client linked, but some CRM details could not be loaded: '+(error.message||'Please retry.'),true);
    }
  }

  async function findPotentialDuplicate(data) {
    if(!data.first_name || !data.last_name)return null;
    const {data:people,error}=await supabase.from('clients')
      .select('id,first_name,last_name,date_of_birth,phone,email,address1,city,state,zip_code,county,gender,veteran')
      .ilike('first_name',data.first_name).ilike('last_name',data.last_name).limit(25);
    if(error)throw error;
    return (people||[]).find(x=>
      (data.dob && x.date_of_birth===data.dob) ||
      (data.phone && String(x.phone||'').replace(/\D/g,'')===String(data.phone).replace(/\D/g,'')))||null;
  }
  async function createClient(data,userId) {
    const {data:client,error}=await supabase.from('clients').insert({
      assigned_agent_id:userId,first_name:data.first_name,last_name:data.last_name,
      date_of_birth:data.dob||null,phone:data.phone||null,email:data.email||null,address1:data.address||null,
      city:data.city||null,state:data.state||null,zip_code:data.zip||null,county:data.county||null,
      gender:data.gender||null,veteran:data.veteran==='yes'?true:data.veteran==='no'?false:null,
      products:['medicare']
    }).select('id,first_name,last_name,phone,date_of_birth,email,address1,city,state,zip_code,county,gender,veteran').single();
    if(error)throw error;
    return client;
  }
  async function ensureAthenaClient() {
    if(linkedClient?.id)return linkedClient.id;
    const data=collectData();
    if(!data.first_name||!data.last_name)throw Error('Enter the client first and last name in Section 1 before using SOA or documents.');
    const {data:auth,error}=await supabase.auth.getUser();
    if(error||!auth?.user?.id)throw Error('Sign in to create the client.');
    const duplicate=await findPotentialDuplicate(data);
    if(duplicate){
      if(!window.confirm('A matching client exists: '+displayName(duplicate)+'. Link this client and use their documents?'))throw Error('Choose the existing client in Section 1 before continuing.');
      selectClient(duplicate);
    }else{
      const client=await createClient(data,auth.user.id);
      selectClient(client);
      say('Client created in CRM. You can now sign the SOA and upload documents; remember to save the Athena review.');
    }
    return linkedClient.id;
  }
  async function doAthenaSoa(method){
    const status=host?.querySelector('[data-at-soa-message]');
    try{
      if(status)status.textContent='Opening SOA…';
      const id=await ensureAthenaClient();
      if(method==='view')await viewLatestSoaForClient(id);
      else await openSoaForClient(id,method);
      if(status)status.textContent='SOA opened. Signed documents are stored in the linked client record.';
    }catch(error){if(status)status.textContent=error?.message||'Could not open SOA.';}
  }
  function confirmSoaAndSave(statusOverride=''){
    if(busy)return;
    const modal=document.createElement('dialog');
    modal.className='at-soa-confirm-dialog';
    modal.innerHTML='<div class="at-soa-confirm-inner"><h2>Did you complete the SOA?</h2><p>Confirm that the Scope of Appointment has been completed before saving or finishing this review.</p><div class="at-soa-confirm-actions"><button type="button" class="at-btn at-btn-soft" data-soa-confirm-no>No — Go Back</button><button type="button" class="at-btn at-btn-primary" data-soa-confirm-yes>Yes — Continue</button></div></div>';
    document.body.append(modal);
    const close=()=>{modal.close();modal.remove();};
    modal.querySelector('[data-soa-confirm-no]').addEventListener('click',close);
    modal.querySelector('[data-soa-confirm-yes]').addEventListener('click',()=>{
      close();
      const field=host?.querySelector('[name="soa_status"]');
      if(field && field.value!=='signed'){field.value='signed';editedFields.add('soa_status');dirty=true;}
      void saveReview(statusOverride);
    });
    modal.addEventListener('cancel',event=>{event.preventDefault();close();});
    modal.showModal();
  }
  async function saveReview(statusOverride='') {
    if(busy||!host?.querySelector('.at-form'))return;
    busy=true;
    host.querySelectorAll('[data-at-save]').forEach(b=>b.disabled=true);
    say('Saving securely…');
    let savedRecord=false;
    let crmSections=[];
    try{
      const data=collectData(),skip=new Set(data.skipped_sections);
      const type=record?.review_kind || host.querySelector('[name="review_kind"]').value;
      if(type==='annual_review' && !linkedClient?.id)throw Error('Select the existing CRM client before saving an annual review.');
      if(!linkedClient?.id && (!data.first_name||!data.last_name))
        throw Error('Enter the client\'s first and last name or select an existing CRM client.');
      if(!skip.has(9)&&data.soa_status==='not_signed'&&!data.soa_reason)
        throw Error('Record why the Scope of Appointment was not signed (section 9).');
      const {data:auth,error:authError}=await supabase.auth.getUser();
      let createdClient=false;
      if(authError || !auth?.user?.id)throw Error('Sign in to save your review.');
      if(!linkedClient?.id){
        const dup=await findPotentialDuplicate(data);
        if(dup && window.confirm('A matching CRM client already exists: '+displayName(dup)+'. Link this review to that CRM client instead of creating a duplicate?')){
          selectClient(dup);
        }else{
          linkedClient=await createClient(data,auth.user.id);
          createdClient=true;
          // Keep the client linked if the following save fails; retries will not duplicate it.
          say('CRM client created. Saving the review…');
        }
      }
      // Edited client names are reflected in both the review list and CRM.
      // Never rename the client using stale/skipped Athena information.
      const changedName=!skip.has(1) &&
        (editedFields.has('first_name') || editedFields.has('last_name'));
      const name=changedName ? [data.first_name||linkedClient.first_name,data.last_name||linkedClient.last_name].filter(Boolean).join(' ').trim() :
        displayName(linkedClient)||[data.first_name,data.last_name].filter(Boolean).join(' ').trim();
      const status=statusOverride||host.querySelector('[name="workflow_status"]')?.value||record?.workflow_status||'draft';
      const payload={client_id:linkedClient.id,full_name:name,review_kind:type,
        workflow_status:status,review_date:data.review_date||null,next_contact_date:data.followup_date||null,
        form_data:data,updated_at:new Date().toISOString()};
      let result;
      if(record?.id){
        const {client_id,...changes}=payload;
        let q=supabase.from(TABLE).update(changes).eq('id',record.id);
        if(record.updated_at)q=q.eq('updated_at',record.updated_at);
        result=await q.select('*').maybeSingle();
        if(!result.error && !result.data)throw Error('This review was changed elsewhere. Reopen it before overwriting the newer version.');
      }else{
        result=await supabase.from(TABLE).insert(payload).select('*').single();
      }
      if(result.error)throw result.error;
      record=result.data;savedRecord=true;
      // Apply only fields actually edited in this form. Skipped sections,
      // future plan recommendations and unrelated CRM records are untouched.
      crmSections=await syncAthenaClient(supabase,{
        clientId:record.client_id,data,edited:[...editedFields],
        editedLists:[...editedLists],editedRows:[...editedRows],
        skipped:data.skipped_sections,createdClient
      });
      if(crmSections.includes('client information')){
        const {data:updated,error:updatedError}=await supabase.from('clients')
          .select('id,first_name,last_name,phone,date_of_birth,email,address1,city,state,zip_code,county,gender,veteran')
          .eq('id',record.client_id).single();
        if(updatedError)throw updatedError;
        linkedClient=updated;
      }
      if(editedFields.has('overview_notes')){
        const {error:noteError}=await supabase.from('clients').update({notes:data.overview_notes}).eq('id',record.client_id);
        if(noteError)throw Error('Review saved, but Overview notes could not sync: '+noteError.message);
      }
      // Only store changed secure values in the separate encrypted vault.
      const med=String(host.querySelector('[name="medicare_number"]')?.value||'').trim();
      const mcd=String(host.querySelector('[name="medicaid_number"]')?.value||'').trim();
      if(!skip.has(2) && ((med && med!==String(vaultOriginal.medicare_number||'')) ||
          (mcd && mcd!==String(vaultOriginal.medicaid_number||'')))){
        const previous=vaultLoaded ? vaultOriginal : await invokeSensitive({action:'get',client_id:record.client_id});
        const saved=await invokeSensitive({action:'save',client_id:record.client_id,sensitive:{
          ssn:previous.ssn||'',drivers_license_number:previous.drivers_license_number||'',
          medicare_number:med||previous.medicare_number||'',medicaid_number:mcd||previous.medicaid_number||''
        }});
        vaultOriginal={...previous,...saved,medicare_number:med||previous.medicare_number||'',medicaid_number:mcd||previous.medicaid_number||''};
        vaultLoaded=true;
      }
      if(queued.length)await uploadQueuedFiles();
      dirty=false;
      await clearRecovery().catch(error=>console.warn('Could not clear a completed recovery draft:',error));
      editedFields.clear();editedLists.clear();editedRows.clear();
      renderEditor(record.form_data||{});
      if(record.client_id){void loadOverviewNotes(record.client_id);void loadMedicareGovFromCRM(record.client_id);}
      // Restore encrypted numbers to the editor after its form is rebuilt.
      for(const k of ['medicare_number','medicaid_number']){
        const el=host.querySelector('[name="'+k+'"]');
        if(el)el.value=String(vaultOriginal[k]||'');
      }
      say('Saved successfully. '+(crmSections.length ? 'Linked CRM updated: '+crmSections.join(', ')+'. ' : 'Linked client kept unchanged. ')+(status==='completed'?'Review marked complete.':'You can reopen this review anytime.'));
      window.dispatchEvent(new CustomEvent('mig:client-updated',{detail:{client_id:record.client_id,source:'athena-medicare'}}));
      void loadFileList();
    }catch(error){
      dirty=true;
      say((savedRecord?'Review saved, but a secure detail or attachment needs attention: ':'Could not save: ')+(error.message||'Please retry.'),true);
    }finally{
      busy=false;
      host?.querySelectorAll('[data-at-save]').forEach(b=>b.disabled=false);
    }
  }
  async function loadFileList(){
    if(!record?.id || !active())return;
    const id=record.id;
    const {data,error}=await supabase.from('documents').select('id,file_name,storage_path').eq('client_id',record.client_id)
      .eq('category',DOC_CATEGORY).eq('notes','athena-medicare:'+id).order('created_at',{ascending:false});
    if(error){say('Review loaded; attachments could not be retrieved: '+error.message,true);return;}
    if(record?.id!==id)return;
    files=data||[];fillFiles();
  }
  async function uploadQueuedFiles(){
    for(const file of [...queued]){
      const mime=mimeOf(file);
      if(!ALLOWED_FILES.has(mime)||file.size>FILE_LIMIT)throw Error('Only PDF and photo files up to 25 MB are accepted.');
      const path=record.client_id+'/athena-medicare/'+record.id+'/'+crypto.randomUUID()+'-'+shortFileName(file.name);
      const uploaded=await supabase.storage.from(BUCKET).upload(path,file,{contentType:mime,upsert:false});
      if(uploaded.error)throw uploaded.error;
      const result=await supabase.from('documents').insert({
        client_id:record.client_id,category:DOC_CATEGORY,file_name:file.name,storage_path:path,mime_type:mime,
        file_size:file.size,notes:'athena-medicare:'+record.id
      }).select('id,file_name,storage_path').single();
      if(result.error){
        await supabase.storage.from(BUCKET).remove([path]).catch(()=>{});
        throw result.error;
      }
      files.unshift(result.data);queued=queued.filter(f=>f!==file);
      fillFiles();
    }
  }
  function savedListCard(x){
    const kind=x.review_kind==='annual_review'?'Annual review':'New intake';
    const status=x.workflow_status==='completed'?'Complete':x.workflow_status==='follow_up'?'Follow-up':'Draft';
    const stamp=new Date(x.updated_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    return '<div class="at-saved-card" data-at-list-card><button type="button" class="at-saved-open" data-at-open="'+esc(x.id)+'">' +
      '<span class="at-kind-badge">'+esc(kind)+'</span><strong>'+esc(x.full_name)+'</strong>' +
      '<small>'+esc(stamp)+' · '+esc(status)+(x.next_contact_date?' · Follow up '+esc(dateText(x.next_contact_date)):'')+'</small></button>' +
      '<button type="button" class="at-btn at-btn-delete" data-at-delete="'+esc(x.id)+'" data-at-name="'+esc(x.full_name)+'" data-at-updated="'+esc(x.updated_at)+'">Delete</button></div>';
  }
  async function savedList(){
    if(!canLeave())return;
    mode='list';reset();
    const request=++epoch;
    host.innerHTML='<div class="at-app">'+hero('Your saved Athena reviews and new intakes, ready when you need them.')+
      '<div class="at-toolbar"><button type="button" class="at-btn at-btn-soft" data-at-home>← Workspace</button><button class="at-btn at-btn-primary" type="button" data-at-new="new_intake">+ New intake</button></div>'+
      '<div class="at-saved-head"><div><h3>Saved Athena records</h3><p>Open to continue editing, or delete only the saved Athena record.</p></div>'+
      '<label class="at-field at-filter"><span>Search</span><input type="search" data-at-list-search placeholder="Name or status" autocomplete="off"></label></div>'+
      '<p class="at-list-status" data-at-status role="status">Loading saved reviews…</p><div data-at-saved-list class="at-saved-list"></div></div>';
    try{
      const {data,error}=await supabase.from(TABLE).select('id,client_id,full_name,review_kind,workflow_status,updated_at,next_contact_date')
        .order('updated_at',{ascending:false}).limit(250);
      if(error)throw error;
      if(request!==epoch||!active())return;
      const box=host.querySelector('[data-at-saved-list]');
      const list=data||[];box._records=list;
      renderList();
      say(list.length+' saved review'+(list.length===1?'':'s')+'.');
    }catch(error){if(request===epoch)say('Could not load saved reviews: '+error.message,true);}
  }
  function renderList(){
    const box=host?.querySelector('[data-at-saved-list]');if(!box)return;
    const search=String(host.querySelector('[data-at-list-search]')?.value||'').toLowerCase();
    const matches=(box._records||[]).filter(r=>(r.full_name+' '+r.review_kind+' '+r.workflow_status).toLowerCase().includes(search));
    box.innerHTML=matches.length?matches.map(savedListCard).join(''):'<p class="at-empty">No matching saved Athena reviews yet.</p>';
  }
  async function openSaved(id){
    if(!canLeave())return;
    const task=++epoch;
    mode='loading';reset();epoch=task;
    host.innerHTML='<div class="at-app">'+hero('Opening saved review…')+'<p class="at-loading">Loading review details…</p></div>';
    try{
      const {data,error}=await supabase.from(TABLE).select('*').eq('id',id).single();
      if(error)throw error;
      if(task!==epoch||!active())return;
      const {data:client,error:clientError}=await supabase.from('clients')
        .select('id,first_name,last_name,phone,date_of_birth,email,address1,city,state,zip_code,county,gender,veteran').eq('id',data.client_id).single();
      if(clientError)throw clientError;
      if(task!==epoch||!active())return;
      record=data;linkedClient=client;
      renderEditor(data.form_data||{});
      void loadCRMForClient(client.id,true);
      void loadMedicareGovFromCRM(client.id);
      void readVault(client.id);
      void loadFileList();
    }catch(error){if(task===epoch && active()){
      host.innerHTML='<div class="at-app">'+hero('Could not open review')+
        '<p class="at-error">'+esc(error.message||'Please retry.')+'</p><button class="at-btn at-btn-soft" data-at-saved>Saved reviews</button></div>';
    }}
  }
  function newReview(kind){
    if(!canLeave())return;
    ++epoch;void clearRecovery();
    reset();record={review_kind:kind};renderEditor({review_date:dateText(new Date().toISOString().slice(0,10))});
  }
  async function deleteLocalUnfinished(){
    if(!window.confirm('Delete the unfinished recovery draft saved on this device? The CRM client and any saved reviews will remain.'))return;
    try{
      await clearRecovery();
      await loadUnfinishedHome();
    }catch(error){
      alert('Could not delete the unfinished draft: '+(error.message||'Please retry.'));
    }
  }
  async function removeReview(id,name,updatedAt){
    if(busy||!id)return;
    if(!window.confirm('Permanently delete the Athena Medicare review for '+(name||'this client')+
      '?\n\nThe CRM client, insurance policies and saved documents will remain. The deleted review cannot be recovered.'))return;
    busy=true;
    try{
      let q=supabase.from(TABLE).delete().eq('id',id);
      if(updatedAt)q=q.eq('updated_at',updatedAt);
      const {data,error}=await q.select('id').maybeSingle();
      if(error)throw error;
      if(!data?.id)throw Error('The saved record has changed or is already removed. Refresh and try again.');
      busy=false;dirty=false;
      if(mode==='home')await loadUnfinishedHome();else await savedList();
    }catch(error){say('Delete failed: '+(error.message||'Please retry.'),true);}
    finally{busy=false;}
  }
  async function viewAttachment(id){
    const found=files.find(f=>f.id===id);
    if(!found)return;
    const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(found.storage_path,90);
    if(error){say('Could not open attachment: '+error.message,true);return;}
    if(openAppleFile({url:data.signedUrl,fileName:found.file_name||'Attachment',mimeType:found.mime_type||''}))return;
    window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }
  function onClick(event){
    const target=event.target.closest('button');
    if(!target||!host?.contains(target))return;
    if(target.hasAttribute('data-at-home')){if(canLeave())home();return;}
    if(target.hasAttribute('data-at-new')){newReview(target.dataset.atNew);return;}
    if(target.hasAttribute('data-at-saved')){void savedList();return;}
    if(target.hasAttribute('data-at-resume-local')){void recoverOnOpen();return;}
    if(target.hasAttribute('data-at-delete-local')){void deleteLocalUnfinished();return;}
    if(target.hasAttribute('data-at-save')){void confirmSoaAndSave();return;}
    if(target.hasAttribute('data-at-schedule-appointment')){
      // The main CRM appointment editor is hosted on the dashboard.
      // Save the current Athena draft before navigating to its scheduler.
      if(dirty)void persistRecovery();
      location.hash='#/dashboard';
      let tries=0;
      const timer=setInterval(()=>{
        const button=document.querySelector('[data-new-appointment]');
        if(button){clearInterval(timer);button.click();}
        else if(++tries>=25){clearInterval(timer);alert('Open the Dashboard and select + Appointment to book the follow-up.');}
      },120);
      return;
    }
    if(target.hasAttribute('data-at-soa-text')){void doAthenaSoa('text');return;}
    if(target.hasAttribute('data-at-soa-sign')){void doAthenaSoa('sign');return;}
    if(target.hasAttribute('data-at-soa-view')){void doAthenaSoa('view');return;}
    if(target.hasAttribute('data-at-complete')){void confirmSoaAndSave('completed');return;}
    if(target.hasAttribute('data-at-open')){void openSaved(target.dataset.atOpen);return;}
    if(target.hasAttribute('data-at-delete')){
      const id=target.dataset.atDelete||record?.id;
      const name=target.dataset.atName||record?.full_name;
      const updated=target.dataset.atUpdated||record?.updated_at;
      void removeReview(id,name,updated);return;
    }
    if(target.hasAttribute('data-at-select-client')){
      const results=host.querySelector('[data-at-client-results]');
      const client=results?._athenaClients?.find(x=>x.id===target.dataset.atSelectClient);
      if(client)selectClient(client);return;
    }
    if(target.hasAttribute('data-at-unlink')){
      if(record?.id){say('Saved Athena reviews cannot be moved to another CRM client. Start a new review for a different client.',true);return;}
      linkedClient=null;vaultOriginal={};vaultLoaded=false;++epoch;
      for(const name of ['medicare_number','medicaid_number']){
        const el=host.querySelector('[name="'+name+'"]');if(el)el.value='';
      }
      const picker=host.querySelector('.at-client-picker');
      if(picker)picker.outerHTML=clientPicker();
      ++crmLoadToken;dirty=true;scheduleRecovery();say('Client link removed. Select another existing client.');return;
    }
    if(target.hasAttribute('data-at-next')){
      const index=Number(target.dataset.atNext);
      if(index===SECTIONS.length){void confirmSoaAndSave('completed');return;}
      const next=host.querySelector('[data-at-step="'+(index+1)+'"]');
      host.querySelectorAll('[data-at-step]').forEach(e=>e.open=false);
      if(next){next.open=true;next.scrollIntoView({behavior:'smooth',block:'nearest'});}return;
    }
    if(target.hasAttribute('data-at-add')){
      const kind=target.dataset.atAdd,box=host.querySelector('[data-at-repeat="'+kind+'"]');
      if(!box)return;
      box.insertAdjacentHTML('beforeend',repeatRow(kind,box.querySelectorAll('[data-at-row]').length));
      editedLists.add(kind);dirty=true;updateSections();scheduleRecovery();return;
    }
    if(target.hasAttribute('data-at-remove')){
      const el=target.closest('[data-at-row]');if(el)el.remove();
      editedLists.add(target.dataset.atRemove);dirty=true;updateSections();scheduleRecovery();return;
    }
    if(target.hasAttribute('data-at-unqueue')){
      queued.splice(Number(target.dataset.atUnqueue),1);fillFiles();dirty=true;scheduleRecovery();return;
    }
    if(target.hasAttribute('data-at-view')){void viewAttachment(target.dataset.atView);return;}

  }
  function onInput(event){
    const control=event.target;
    if(control.matches('[data-at-list-search]')){renderList();return;}
    if(control.matches('[data-at-client-search]')){
      clearTimeout(searchTimer);const value=control.value;
      searchTimer=setTimeout(()=>void findClients(value),260);return;
    }
    if(!control.closest('.at-form'))return;
    if(control.hasAttribute('data-at-date'))control.value=maskDate(control.value);
    const row=control.closest('[data-at-row]');
    if(row){
      if(!row.dataset.atCrmId)row.dataset.atCrmId=crypto.randomUUID();
      editedLists.add(row.dataset.atRow);editedRows.add(row.dataset.atCrmId);
    }else if(control.name)editedFields.add(control.name);
    dirty=true;
    if(HIP_TOTALS.includes(control.name))calcHip();
    updateSections();say('Unsaved changes.');scheduleRecovery();
  }
  function queueSupportingFiles(fileList){
    let added=0;
    for(const file of Array.from(fileList||[])){
      const mime=mimeOf(file);
      if(!ALLOWED_FILES.has(mime)||file.size>FILE_LIMIT){
        say('Choose photos or PDFs no larger than 25 MB.',true);continue;
      }
      queued.push(file);dirty=true;added++;
    }
    if(added){fillFiles();say(added+' attachment'+(added===1?'':'s')+' queued. Save the review to upload securely.');scheduleRecovery();}
  }
  function onAttachmentDrag(event){
    const zone=event.target.closest?.('[data-at-drop-zone]');
    if(!zone||!host?.contains(zone))return;
    event.preventDefault();
    if(event.type==='drop'){
      zone.classList.remove('at-drop-active');
      queueSupportingFiles(event.dataTransfer?.files);
    }else if(event.type==='dragleave'){
      if(!zone.contains(event.relatedTarget))zone.classList.remove('at-drop-active');
    }else zone.classList.add('at-drop-active');
  }
  function onChange(event){
    const input=event.target;
    if(input.hasAttribute('data-at-skip')){
      dirty=true;updateSections();say('Skip selection changed. Save to keep it.');scheduleRecovery();return;
    }
    if(input.closest('.at-form') && input.name){
      const row=input.closest('[data-at-row]');
      if(row){
        if(!row.dataset.atCrmId)row.dataset.atCrmId=crypto.randomUUID();
        editedLists.add(row.dataset.atRow);editedRows.add(row.dataset.atCrmId);
      }else editedFields.add(input.name);
      dirty=true;updateSections();scheduleRecovery();return;
    }
    if(!input.hasAttribute('data-at-files'))return;
    queueSupportingFiles(input.files);
    input.value='';
  }
  async function openHandoffClient(node,id){
    try{
      const {data,error}=await supabase.from('clients')
        .select('id,first_name,last_name,phone,date_of_birth,email,address1,city,state,zip_code,county,gender,veteran')
        .eq('id',id).single();
      if(error)throw error;
      if(!data?.id)throw Error('This client is no longer available.');
      if(host!==node || !active() || mode!=='home')return;
      newReview('annual_review');
      selectClient(data);
    }catch(error){
      if(host!==node || !active() || mode!=='home')return;
      const notice=document.createElement('p');
      notice.className='at-handoff-error';
      notice.setAttribute('role','alert');
      notice.textContent='Could not automatically link the client: '+(error.message||'Please search for the client in Athena.');
      node.querySelector('.at-home-grid')?.insertAdjacentElement('beforebegin',notice);
    }
  }
  function mount(node){
    host=node;home();
    document.addEventListener('visibilitychange',onAppHidden);
    window.addEventListener('pagehide',onPageHide);
    host.addEventListener('click',onClick);
    host.addEventListener('input',onInput);
    host.addEventListener('change',onChange);
    for(const type of ['dragenter','dragover','dragleave','drop'])host.addEventListener(type,onAttachmentDrag);
    host.addEventListener('toggle',onToggle,true);
    let handoff='';
    try {
      handoff=sessionStorage.getItem('arctos:athena-review-client')||'';
      sessionStorage.removeItem('arctos:athena-review-client');
    } catch {}
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handoff))
      void openHandoffClient(node,handoff);
    // Stay on the Athena home screen; unfinished reviews are listed for explicit selection.
  }
  function onToggle(event){
    if(!event.target.matches('[data-at-step]') || !event.target.open)return;
    host?.querySelectorAll('[data-at-step]').forEach(step=>{if(step!==event.target)step.open=false;});
  }
  function unmount(){
    if(dirty)void persistRecovery();
    document.removeEventListener('visibilitychange',onAppHidden);
    window.removeEventListener('pagehide',onPageHide);
    ++epoch;clearTimeout(searchTimer);clearTimeout(recoveryTimer);++searchToken;
    if(host){host.removeEventListener('click',onClick);host.removeEventListener('input',onInput);
      host.removeEventListener('change',onChange);host.removeEventListener('toggle',onToggle,true);
      for(const type of ['dragenter','dragover','dragleave','drop'])host.removeEventListener(type,onAttachmentDrag);}
    host=null;reset();
  }
  return {mount,unmount,canLeave,destroy:unmount};
}
