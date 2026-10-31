import { openAppleFile } from './external-file-opening.js';
import {supabase} from './supabase-repository.js';
const BUCKET='mh-client-documents';
const TYPES=[
 ['medicare_card','Medicare Card'],['medicaid_card','Medicaid Card'],['health_plan_card','Health Plan Card'],
 ['soa','Scope of Appointment (SOA)'],['insurance_policy','Insurance Policy'],['application','Application'],
 ['id','Identification'],['life_policy','Life Policy'],['hospital_indemnity','Hospital Indemnity'],
 ['pharmacy','Pharmacy / Medication Document'],['other','Other / General Document']
];
const allowed=new Set(['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain']);
const mimeOf=file=>file.type||({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',heic:'image/heic',heif:'image/heif',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain'})[file.name.toLowerCase().split('.').pop()]||'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=s=>String(s||'document').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,110);
const label=k=>TYPES.find(([id])=>id===k)?.[1]||String(k||'Other').replaceAll('_',' ');
const size=n=>n>1024*1024?(n/(1024*1024)).toFixed(1)+' MB':Math.ceil((n||0)/1024)+' KB';
export function athenaDocumentsMarkup(){
 return '<section class="at-client-documents" data-at-client-documents style="grid-column:1/-1;border:1.5px solid #a5b7c3;border-radius:11px;padding:14px;background:#f7fafb;margin-top:12px">'+
 '<strong style="display:block;margin-bottom:8px">Client Records Documents — Shared Secure Folder</strong>'+
 '<p class="at-helper">Upload the same document types as Client Records. Files are immediately stored in that client\'s secure Documents folder and are available in both places. New clients are created when you save the review.</p>'+
 '<div class="at-grid"><label class="at-field"><span>Document Type</span><select data-at-doc-type>'+TYPES.map(([v,l])=>'<option value="'+v+'">'+esc(l)+'</option>').join('')+'</select></label>'+
 '<label class="at-field"><span>Choose files</span><input type="file" multiple data-at-doc-files accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.xls,.xlsx,.txt"></label>'+
 '<label class="at-field"><span>Camera / Scan</span><input type="file" capture="environment" accept="image/*" data-at-doc-camera></label></div>'+
 '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin:10px 0"><button type="button" class="at-btn at-btn-primary" data-at-doc-upload>Upload to Client Records</button><button type="button" class="at-btn at-btn-soft" data-at-doc-refresh>Refresh files</button></div>'+
 '<p class="at-helper" data-at-doc-status role="status"></p><div data-at-doc-rows style="display:grid;gap:8px"></div></section>';
}
export function bindAthenaDocuments(host,getClientId,ensureClient){
 const panel=host.querySelector('[data-at-client-documents]');if(!panel)return;
 const status=panel.querySelector('[data-at-doc-status]'),rows=panel.querySelector('[data-at-doc-rows]');
 let records=[],busy=false;
 const say=message=>{status.textContent=message;};
 const draw=()=>{rows.innerHTML=records.length?records.map(r=>'<div class="at-file" style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><span>'+esc(r.file_name)+' — '+esc(label(r.category))+' ('+size(r.file_size)+')</span><button type="button" class="at-text-btn" data-at-doc-open="'+esc(r.id)+'">Open</button></div>').join(''):'<p class="at-helper">No documents stored for this client yet.</p>';};
 const load=async()=>{
  const id=getClientId();if(!id){records=[];draw();say('Link a client or save this review to create a new client before uploading.');return;}
  say('Loading client documents…');
  const {data,error}=await supabase.from('documents').select('id,category,file_name,file_size,storage_path').eq('client_id',id).order('created_at',{ascending:false}).limit(200);
  if(error){say('Unable to load documents: '+error.message);return;}
  records=data||[];draw();say(records.length+' document'+(records.length===1?'':'s')+' in Client Records.');
 };
 panel.querySelector('[data-at-doc-refresh]').addEventListener('click',()=>void load());
 rows.addEventListener('click',async e=>{
  const button=e.target.closest('[data-at-doc-open]');if(!button)return;
  const r=records.find(x=>x.id===button.dataset.atDocOpen);if(!r)return;
  const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(r.storage_path,90);
  if(error){say('Could not open document: '+error.message);return;}if(openAppleFile({url:data.signedUrl,fileName:r.file_name||'Document'}))return;window.open(data.signedUrl,'_blank','noopener,noreferrer');
 });
 panel.querySelector('[data-at-doc-upload]').addEventListener('click',async()=>{
  if(busy)return;
  const input=panel.querySelector('[data-at-doc-files]'),camera=panel.querySelector('[data-at-doc-camera]');
  const files=[...input.files,...camera.files];
  if(!files.length){say('Choose a document or take a photo first.');return;}
  busy=true;const button=panel.querySelector('[data-at-doc-upload]');button.disabled=true;
  try{
   let id=getClientId();
   if(!id){say('Saving the intake and creating the client first…');id=await ensureClient();}
   if(!id)throw Error('Save a client before uploading documents.');
   const category=panel.querySelector('[data-at-doc-type]').value;
   for(const file of files){
    const mime=mimeOf(file);
    if(!allowed.has(mime))throw Error('Unsupported file format: '+file.name);
    if(file.size>25*1024*1024)throw Error('File must be 25 MB or smaller: '+file.name);
    const path=id+'/'+crypto.randomUUID()+'-'+safe(file.name);
    say('Uploading '+file.name+'…');
    const upload=await supabase.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:mime});
    if(upload.error)throw upload.error;
    const {data:{user}}=await supabase.auth.getUser();
    const {error}=await supabase.from('documents').insert({client_id:id,category,file_name:file.name,storage_path:path,mime_type:mime,file_size:file.size,uploaded_by:user?.id||null});
    if(error){await supabase.storage.from(BUCKET).remove([path]);throw error;}
   }
   input.value='';camera.value='';await load();say('Documents securely uploaded to Client Records.');
  }catch(error){say('Upload failed: '+(error.message||'Please retry.'));}
  finally{busy=false;button.disabled=false;}
 });
 void load();
 return {refresh:load};
}
