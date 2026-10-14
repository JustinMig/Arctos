import { observeClientDialogs } from './client-dialog-observer.js';
import {mhRepository,supabase} from './supabase-repository.js';
import {FILE_GROUPS,fileGroup,fileCategoryLabel,fileIndex,fileGroupCounts} from './client-files-hub-model.js';

const BUCKET='mh-client-documents';
const PAGE=200,MAX_ROWS=4000,FILES_REFRESH_MS=20000;
const contexts=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const humanSize=value=>{const n=Number(value||0);return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';};
const displayDate=value=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.valueOf())?'':d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});};

async function readFiles(id){
 const records=[];
 for(let start=0;start<MAX_ROWS;start+=PAGE){
  const {data,error}=await supabase.from('documents')
   .select('id,client_id,category,file_name,storage_path,mime_type,file_size,notes,created_at')
   .eq('client_id',id).order('created_at',{ascending:false}).order('id',{ascending:false})
   .range(start,start+PAGE-1);
  if(error)throw error;
  records.push(...(data||[]));
  if(!data||data.length<PAGE)break;
 }
 return {records,limited:records.length>=MAX_ROWS};
}
async function readNotes(id){
 const {data,error}=await supabase.from('client_notes')
  .select('id,client_id,title,body,author_id,created_at,updated_at')
  .eq('client_id',id).order('created_at',{ascending:false}).limit(40);
 if(error)throw error;
 return data||[];
}
function markup(){
 return '<section class="client-files-hub" data-client-files-hub aria-label="All client notes and documents">'+
  '<div class="cfh-intro"><div><span class="eyebrow">ONE CLIENT FILE LOCATION</span><h3>All Client Files</h3>'+
  '<p>Find files from Medicare, SOA, life policies, hospital plans, pharmacies, and general uploads. Original file locations and policy links stay intact.</p></div>'+
  '<button type="button" class="btn secondary" data-cfh-refresh>Refresh</button></div>'+
  '<div class="cfh-categories" role="group" aria-label="Filter client files"></div>'+
  '<label class="cfh-search"><span>Search client documents</span><input type="search" data-cfh-search placeholder="File name, category, or description" autocomplete="off"></label>'+
  '<div class="cfh-status" data-cfh-status role="status" aria-live="polite">Open this tab to load client files.</div>'+
  '<div class="cfh-records" data-cfh-list></div>'+
  '<div class="cfh-where"><strong>Need to upload more?</strong>'+
  '<p>Use the original upload controls for coverage-specific files. General files can be added below.</p>'+
  '<div class="cfh-jumps"><button type="button" data-cfh-jump="medicare">Medicare &amp; SOA</button>'+
  '<button type="button" data-cfh-jump="life">Life policies</button>'+
  '<button type="button" data-cfh-jump="hospital_indemnity">Hospital plans</button>'+
  '<button type="button" data-cfh-jump="medications">Medical &amp; pharmacy</button>'+
  '<button type="button" data-cfh-general>General uploads ↓</button></div></div>'+
  '<section class="cfh-notes-history" aria-label="Client note history">'+
  '<div class="cfh-notes-head"><div><h3>Saved Client Notes</h3><p>Individual notes previously saved to this client.</p></div></div>'+
  '<div class="cfh-notes-list" data-cfh-notes-list></div>'+
  '<details class="cfh-new-note"><summary>+ Add a Client Note</summary>'+
  '<div class="cfh-note-editor"><label><span>Note Title</span><input data-cfh-note-title maxlength="160" placeholder="Follow-up, review, or phone call" autocomplete="off"></label>'+
  '<label><span>Note</span><textarea data-cfh-note-body maxlength="10000" rows="3" placeholder="Enter client-specific note"></textarea></label>'+
  '<button type="button" class="btn primary" data-cfh-note-save>Save Note</button></div></details>'+
  '<p class="cfh-note-message" data-cfh-note-message role="status" aria-live="polite"></p></section>'+
  '</section>';
}
function openFileModal(record,url){
 const mime=String(record.mime_type||'').toLowerCase();
 const isImage=['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(mime);
 const isPdf=mime==='application/pdf';
 const modal=document.createElement('dialog');
 modal.className='mh-file-preview-dialog cfh-preview';
 modal.innerHTML='<div class="mh-file-preview-frame"><header class="mh-file-preview-head">'+
  '<div><h2>'+esc(record.file_name||'Document')+'</h2><p>'+esc(fileCategoryLabel(record.category))+' · Secure client file</p></div>'+
  '<div class="mh-file-preview-actions"><button type="button" class="btn secondary" data-cfh-download>Download</button>'+
  '<button type="button" class="modal-close" data-cfh-close aria-label="Close file preview">×</button></div></header>'+
  '<div class="mh-file-preview-body">'+(isImage?'<img alt="'+esc(record.file_name||'Document')+'" src="'+esc(url)+'">':
    isPdf?'<iframe title="'+esc(record.file_name||'PDF document')+'" src="'+esc(url)+'"></iframe>':
     '<div class="mh-file-preview-unavailable"><strong>Preview unavailable for this file type.</strong><span>Use Download to open the original document.</span></div>')+
  '</div><div class="cfh-preview-error" data-cfh-preview-error role="status"></div></div>';
 document.body.append(modal);
 const finish=()=>{if(modal.isConnected){modal.close();modal.remove();}};
 modal.querySelector('[data-cfh-close]').onclick=finish;
 modal.addEventListener('cancel',e=>{e.preventDefault();finish();});
 modal.addEventListener('click',e=>{if(e.target===modal)finish();});
 modal.querySelector('[data-cfh-download]').onclick=async e=>{
  const btn=e.currentTarget;btn.disabled=true;
  try{
   const response=await fetch(url);
   if(!response.ok)throw Error('Could not download this secure document.');
   const blob=await response.blob(),objectURL=URL.createObjectURL(blob);
   const link=document.createElement('a');link.href=objectURL;link.download=record.file_name||'client-document';
   document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
  }catch(error){modal.querySelector('[data-cfh-preview-error]').textContent=error?.message||'Download failed.';}
  finally{btn.disabled=false;}
 };
 modal.showModal();
}

function renderFiles(state){
 const host=state.host;
 if(!host?.isConnected)return;
 const cats=host.querySelector('.cfh-categories');
 const counts=fileGroupCounts(state.records);
 cats.innerHTML=FILE_GROUPS.map(({key,name})=>'<button type="button" data-cfh-filter="'+esc(key)+'" aria-pressed="'+(state.filter===key)+'">'+
  esc(name)+' <span>'+counts[key]+'</span></button>').join('');
 const rows=fileIndex(state.records,state.filter,state.query);
 host.querySelector('[data-cfh-list]').innerHTML=!state.loaded?'':rows.length?
  rows.slice(0,120).map(record=>'<article class="cfh-file" data-cfh-file="'+esc(record.id)+'">'+
   '<div class="cfh-file-info"><strong>'+esc(record.file_name||'Untitled Document')+'</strong>'+
   '<small>'+esc(fileCategoryLabel(record.category))+' · '+esc(humanSize(record.file_size))+
    (record.created_at?' · '+esc(displayDate(record.created_at)):'')+'</small></div>'+
   (record.storage_path?'<button type="button" class="btn secondary" data-cfh-view>View</button>':
      '<span class="cfh-unavailable">Original file unavailable</span>')+'</article>').join('')+
   (rows.length>120?'<p class="cfh-more">Showing 120 of '+rows.length+' matching documents. Search or choose a category to narrow the list.</p>':''):
  '<p class="cfh-empty">No documents match this filter.</p>';
 const status=host.querySelector('[data-cfh-status]');
 if(state.loading)status.textContent='Loading your secure client files…';
 else if(state.error)status.textContent=state.error;
 else if(!state.clientId)status.textContent='Save this client first. Notes and general uploads can be prepared below.';
 else status.textContent=counts.all+' file'+(counts.all===1?'':'s')+' available'+(state.limited?' · large collection, showing up to 4,000 records':'')+'.';
}
function renderNotes(state){
 const host=state.host;if(!host?.isConnected)return;
 const list=host.querySelector('[data-cfh-notes-list]');
 if(!state.clientId){
  list.innerHTML='<p class="cfh-empty">Save this client before adding separate saved notes.</p>';return;
 }
 list.innerHTML=state.notes.length?state.notes.map(note=>
  '<details class="cfh-note" data-cfh-note="'+esc(note.id)+'"><summary><strong>'+esc(note.title||'Untitled Note')+'</strong>'+
   '<small>'+esc(displayDate(note.created_at||note.updated_at))+'</small></summary>'+
   '<p>'+esc(note.body||'')+'</p><button type="button" class="btn danger" data-cfh-delete-note>Delete Note</button></details>').join(''):
  '<p class="cfh-empty">No separate client notes have been saved.</p>';
}
function bind(dialog){
 if(!dialog.classList.contains('client-dialog'))return;
 const notesPanel=dialog.querySelector('[data-panel="notes"]');
 if(!notesPanel||notesPanel.querySelector('[data-client-files-hub]'))return;
 const wrap=document.createElement('div');wrap.innerHTML=markup();
 const host=wrap.firstElementChild;
 notesPanel.prepend(host);
 const state={host,dialog,records:[],notes:[],loaded:false,loadedAt:0,loading:false,refreshPending:false,limited:false,error:'',filter:'all',query:'',clientId:'',request:0};
 contexts.set(dialog,state);
 const currentId=()=>dialog.dataset.clientId||'';
 async function reload(force=false){
  if(state.loading){if(force)state.refreshPending=true;return;}
  const id=currentId();
  if(!force && state.loaded && state.clientId===id && Date.now()-state.loadedAt<FILES_REFRESH_MS)return;
  const ticket=++state.request;
  state.clientId=id;
  if(!id){state.records=[];state.notes=[];state.loaded=true;state.loadedAt=Date.now();renderFiles(state);renderNotes(state);return;}
  state.loading=true;state.error='';renderFiles(state);
  const [files,notes]=await Promise.allSettled([readFiles(id),readNotes(id)]);
  if(!dialog.isConnected||ticket!==state.request)return;
  if(files.status==='fulfilled'){
   state.records=files.value.records;state.limited=files.value.limited;
  }else state.error='Files: '+(files.reason?.message||'Could not load documents.');
  if(notes.status==='fulfilled')state.notes=notes.value;
  else state.error+=(state.error?' · ':'')+'Notes: '+(notes.reason?.message||'Could not load notes.');
  state.loaded=true;state.loadedAt=Date.now();state.loading=false;renderFiles(state);renderNotes(state);
  if(state.refreshPending){state.refreshPending=false;void reload(true);}
 }
 host.querySelector('[data-cfh-refresh]').onclick=()=>void reload(true);
 host.querySelector('[data-cfh-search]').oninput=e=>{state.query=e.target.value;renderFiles(state);};
 host.querySelector('.cfh-categories').addEventListener('click',event=>{
  const b=event.target.closest('[data-cfh-filter]');
  if(!b)return;state.filter=b.dataset.cfhFilter;renderFiles(state);
 });
 host.querySelector('[data-cfh-list]').addEventListener('click',async event=>{
  const button=event.target.closest('[data-cfh-view]');if(!button)return;
  const row=button.closest('[data-cfh-file]');
  const record=state.records.find(x=>x.id===row?.dataset.cfhFile);
  if(!record?.storage_path||record.client_id!==currentId())return;
  button.disabled=true;
  try{
   const {data,error}=await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path,120);
   if(error)throw error;if(!data?.signedUrl)throw Error('The secure file could not be opened.');
   openFileModal(record,data.signedUrl);
  }catch(error){state.error=error?.message||'Unable to open document.';renderFiles(state);}
  finally{button.disabled=false;}
 });
 host.querySelectorAll('[data-cfh-jump]').forEach(button=>button.onclick=()=>{
  dialog.querySelector('[data-tab="'+button.dataset.cfhJump+'"]')?.click();
 });
 host.querySelector('[data-cfh-general]').onclick=()=>{
  const general=notesPanel.querySelector('.cfh-general-uploader');
  if(general){general.open=true;general.scrollIntoView({block:'start',behavior:'smooth'});}
 };
 host.querySelector('[data-cfh-note-save]').onclick=async ()=>{
  const button=host.querySelector('[data-cfh-note-save]');
  const title=host.querySelector('[data-cfh-note-title]'),body=host.querySelector('[data-cfh-note-body]'),message=host.querySelector('[data-cfh-note-message]');
  const clientId=currentId(),userId=mhRepository.user?.id;
  if(!clientId||!userId){message.textContent='Save this client and sign in before adding a note.';return;}
  if(!title.value.trim()||!body.value.trim()){message.textContent='Enter a note title and the note text.';return;}
  button.disabled=true;message.textContent='Saving the note…';
  try{
   const {error}=await supabase.from('client_notes').insert({
    client_id:clientId,author_id:userId,title:title.value.trim(),body:body.value.trim()
   });
   if(error)throw error;
   title.value='';body.value='';message.textContent='Client note saved.';
   const {data,error:notesError}=await supabase.from('client_notes')
      .select('id,client_id,title,body,author_id,created_at,updated_at')
      .eq('client_id',clientId).order('created_at',{ascending:false}).limit(40);
   if(notesError)throw notesError;
   state.notes=data||[];renderNotes(state);
  }catch(error){message.textContent=error?.message||'Unable to save client note. Your text is still here.';}
  finally{button.disabled=false;}
 };
 host.querySelector('[data-cfh-notes-list]').addEventListener('click',async event=>{
  const button=event.target.closest('[data-cfh-delete-note]');
  if(!button)return;
  const row=button.closest('[data-cfh-note]'),id=row?.dataset.cfhNote,clientId=currentId();
  if(!id||!clientId||!confirm('Delete this client note permanently?'))return;
  button.disabled=true;
  try{
   const {error}=await supabase.from('client_notes').delete().eq('id',id).eq('client_id',clientId);
   if(error)throw error;
   state.notes=state.notes.filter(note=>note.id!==id);renderNotes(state);
   host.querySelector('[data-cfh-note-message]').textContent='Note deleted.';
  }catch(error){button.disabled=false;host.querySelector('[data-cfh-note-message]').textContent=error?.message||'Unable to delete note.';}
 });
 dialog.addEventListener('click',event=>{
  if(event.target.closest('[data-client-group-tab="files"],[data-tab="notes"]'))void reload();
 });
 dialog.addEventListener('arctos:client-file-change',()=>void reload(true));
 renderFiles(state);renderNotes(state);
 if(dialog.querySelector('[data-client-group-tab="files"]')?.getAttribute('aria-selected')==='true')void reload();
}
// Install on native client dialogs only; unrelated CRM DOM updates no longer
// trigger Notes & Files binding work.
observeClientDialogs(bind);
