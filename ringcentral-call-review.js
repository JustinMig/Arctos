import {supabase} from './supabase-repository.js';
import {smsAuthHeaders} from './client-texting.js';
import {communicationsChanged,releaseRecordings} from './communications-events.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when=value=>new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const dateParts=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
const dayKey=value=>{
  const parts=Object.fromEntries(dateParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const missed=call=>call.direction==='Inbound' && /missed|no answer|unanswered|abandoned/i.test(String(call.result||''));
const DAY_ALL='all';
let syncingVoicemail=null,lastVoicemailSync=0;
async function voicemailSync(force=false){
  if(syncingVoicemail)return syncingVoicemail;
  if(!force && Date.now()-lastVoicemailSync<5*60000)return {skipped:true};
  syncingVoicemail=(async()=>{
    const response=await fetch('/api/ringcentral-voicemail-sync',{headers:await smsAuthHeaders(),cache:'no-store'});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.error||'RingCentral voicemail sync failed.');
    lastVoicemailSync=Date.now();return result;
  })().finally(()=>{syncingVoicemail=null;});
  return syncingVoicemail;
}
async function loadReviewData(){
  const [callResult,vmResult]=await Promise.all([
    supabase.from('ringcentral_calls').select('id,client_id,direction,result,started_at,contact_phone,from_phone,to_phone,recording_id,staff_note')
      .order('started_at',{ascending:false}).limit(1000),
    supabase.from('ringcentral_voicemails').select('id,client_id,received_at,from_phone,duration_seconds,audio_attachment_id,read_status,staff_note')
      .order('received_at',{ascending:false}).limit(1000)
  ]);
  if(callResult.error)throw callResult.error;
  if(vmResult.error)throw vmResult.error;
  const calls=(callResult.data||[]).filter(missed);
  const voicemails=vmResult.data||[];
  const ids=[...new Set([...calls,...voicemails].map(r=>r.client_id).filter(Boolean))];
  let people=[];
  for(let i=0;i<ids.length;i+=150){
    const {data,error}=await supabase.from('clients').select('id,first_name,last_name,phone,status').in('id',ids.slice(i,i+150));
    if(error)throw error;people.push(...(data||[]));
  }
  const peopleById=new Map(people.map(person=>[person.id,person]));
  return {
    calls:calls.filter(c=>peopleById.has(c.client_id)).map(r=>({...r,type:'call',date:r.started_at,person:peopleById.get(r.client_id)})),
    voicemails:voicemails.filter(c=>peopleById.has(c.client_id)).map(r=>({...r,type:'voicemail',date:r.received_at,person:peopleById.get(r.client_id)}))
  };
}
function card(row){
 const person=row.person||{};
 const name=[person.first_name,person.last_name].filter(Boolean).join(' ')||'Client';
 const phone=row.contact_phone||row.from_phone||person.phone||'';
 const isVoice=row.type==='voicemail';
 const label=isVoice?'Voicemail':(row.result||'Missed Call');
 return `<article class="mh-review-card" data-review-id="${esc(row.id)}" data-review-type="${esc(row.type)}">
   <div class="mh-review-top"><strong>${esc(name)}</strong><small>${esc(when(row.date))}</small></div>
   <div class="mh-review-meta"><span class="mh-review-kind">${esc(label)}</span><span>${esc(phone)}</span>
     ${isVoice && row.duration_seconds?`<span>${Math.floor(row.duration_seconds/60)}:${String(row.duration_seconds%60).padStart(2,'0')}</span>`:''}
     ${isVoice && row.read_status==='Unread'?'<span>Unread in RingCentral</span>':''}
   </div>
   ${isVoice && row.audio_attachment_id?`<div class="mh-review-audio" data-review-audio><button class="btn secondary" type="button" data-review-play>▶ Play Voicemail</button></div>`:''}
   <details class="mh-review-notes">
     <summary>Notes${row.staff_note?' • Saved':''} <span aria-hidden="true">⌄</span></summary>
     <div class="mh-review-note-body">
       <label><span>Call / Voicemail Note</span><textarea maxlength="4000" rows="3" data-review-note placeholder="Add an optional note for this call…">${esc(row.staff_note||'')}</textarea></label>
       <button type="button" class="btn secondary" data-review-save>Save Note</button>
     </div>
   </details>
   <div class="mh-review-actions"><button type="button" class="btn secondary" data-review-appointment${person.status==='deceased'?' disabled':''}>+ Appointment</button>
     <button type="button" class="btn secondary mh-review-delete" data-review-delete>Delete from CRM</button></div>
   <p class="mh-review-message" role="status" aria-live="polite" data-review-message></p>
  </article>`;
}
function makeUI(panel){
 const wrapper=document.createElement('section');
 wrapper.className='mh-review-dashboard';
 wrapper.innerHTML=`<div class="mh-review-filter-head">
  <div class="mh-review-tabs" role="tablist" aria-label="RingCentral call data sections">
    <button type="button" class="active" data-review-view="all" aria-selected="true">All Calls</button>
    <button type="button" data-review-view="missed" aria-selected="false">Missed Calls <strong data-missed-count>—</strong></button>
    <button type="button" data-review-view="voicemail" aria-selected="false">Voicemails <strong data-vm-count>—</strong></button>
  </div>
  <div class="mh-review-date-tools" data-review-date-tools hidden>
    <label>Day <input type="date" data-review-date aria-label="Filter by day"></label>
    <button type="button" class="btn secondary" data-review-all-days>All Days</button>
    <button type="button" class="btn secondary" data-review-today>Today</button>
    <button type="button" class="btn secondary" data-review-refresh>Refresh</button>
  </div>
 </div>
 <p class="mh-review-status" role="status" aria-live="polite" data-review-status>Open Missed Calls or Voicemails to review them by day.</p>
 <div class="mh-review-results" data-review-results hidden></div>`;
 const allList=panel.querySelector('[data-call-list]');
 allList?.before(wrapper);
 let mode='all',date=DAY_ALL,records={calls:[],voicemails:[]},loaded=false,token=0,loading=false;
 const list=wrapper.querySelector('[data-review-results]');
 const status=wrapper.querySelector('[data-review-status]');
 const dates=wrapper.querySelector('[data-review-date-tools]');
 const input=wrapper.querySelector('[data-review-date]');
 const visibleRows=()=>mode==='missed'?records.calls:records.voicemails;
 const draw=()=>{
  if(!wrapper.isConnected || mode==='all')return;
  wrapper.querySelector('[data-missed-count]').textContent=String(records.calls.length);
  wrapper.querySelector('[data-vm-count]').textContent=String(records.voicemails.length);
  const chosen=visibleRows().filter(row=>date===DAY_ALL||dayKey(row.date)===date).sort((a,b)=>new Date(b.date)-new Date(a.date));
  releaseRecordings(list);
  if(!chosen.length){
   list.innerHTML=`<div class="mh-client-call-empty">No ${mode==='missed'?'missed calls':'voicemails'} ${date===DAY_ALL?'found for saved Arctos clients':'on this day'}.</div>`;
   status.textContent=loaded?`0 ${mode==='missed'?'missed calls':'voicemails'} for selected dates.`:'Loading RingCentral call data…';
   return;
  }
  let previous='';
  list.innerHTML=chosen.map(row=>{
   const group=dayKey(row.date);
   const head=group!==previous?`<h3 class="mh-review-day-heading">${new Date(group+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</h3>`:'';
   previous=group;
   return head+card(row);
  }).join('');
  status.textContent=`${chosen.length} ${mode==='missed'?'missed call':'voicemail'}${chosen.length===1?'':'s'} ${date===DAY_ALL?'across available days':'on '+date} · saved Arctos clients only.`;
  bindRows();
 };
 const refresh=async({force=false}={})=>{
  if(loading)return;
  loading=true;const current=++token;
  const refreshButton=wrapper.querySelector('[data-review-refresh]');
  refreshButton.disabled=true;
  status.textContent=mode==='voicemail'?'Checking RingCentral voicemail inbox…':'Loading missed calls…';
  try{
   if(mode==='voicemail')await voicemailSync(force);
   const result=await loadReviewData();
   if(current!==token||!wrapper.isConnected)return;
   records=result;loaded=true;draw();
  }catch(error){
   if(current===token&&wrapper.isConnected){
    status.textContent=error?.message||'Unable to load RingCentral call data.';
    // Still show locally saved items if a fresh RingCentral sync fails.
    try{records=await loadReviewData();loaded=true;draw();status.textContent+=(records.voicemails.length?' · Showing saved voicemail records.':'');}catch{}
   }
  }finally{loading=false;if(wrapper.isConnected)refreshButton.disabled=false;}
 };
 const selectMode=value=>{
  mode=value;
  wrapper.querySelectorAll('[data-review-view]').forEach(button=>{
   const active=button.dataset.reviewView===value;
   button.classList.toggle('active',active);
   button.setAttribute('aria-selected',String(active));
  });
  dates.hidden=value==='all';
  list.hidden=value==='all';
  if(allList)allList.hidden=value!=='all';
  status.hidden=value==='all';
  if(value!=='all')void refresh();
 };
 const bindRows=()=>{
  list.querySelectorAll('.mh-review-card').forEach(node=>{
   const id=node.dataset.reviewId,kind=node.dataset.reviewType;
   const row=[...records.calls,...records.voicemails].find(item=>item.id===id&&item.type===kind);
   if(!row)return;
   const feedback=node.querySelector('[data-review-message]');
   node.querySelector('[data-review-save]').onclick=async event=>{
    const button=event.currentTarget,note=node.querySelector('[data-review-note]').value;
    button.disabled=true;feedback.textContent='Saving note…';
    try{
     const {error}=await supabase.rpc('save_ringcentral_review_note',{p_kind:kind,p_id:id,p_note:note});
     if(error)throw error;
     row.staff_note=note.trim();
     feedback.textContent='Note saved.';
     node.querySelector('summary').textContent=row.staff_note?'Notes • Saved':'Notes';
    }catch(error){feedback.textContent=error?.message||'Unable to save note.';}
    finally{button.disabled=false;}
   };
   node.querySelector('[data-review-delete]').onclick=async event=>{
    if(!window.confirm('Remove this '+(kind==='call'?'missed call':'voicemail')+' from Arctos permanently? It will stay hidden after future RingCentral syncs. The original item in RingCentral will not be deleted.'))return;
    const button=event.currentTarget;button.disabled=true;feedback.textContent='Removing from Arctos…';
    try{
     const {error}=await supabase.rpc('hide_my_communication',{p_kind:kind,p_id:id});
     if(error)throw error;
     records[kind==='call'?'calls':'voicemails']=records[kind==='call'?'calls':'voicemails'].filter(item=>item.id!==id);
     if(kind==='call')communicationsChanged('calls');
     draw();
    }catch(error){button.disabled=false;feedback.textContent=error?.message||'Delete failed.';}
   };
   node.querySelector('[data-review-appointment]').onclick=()=>{
    window.dispatchEvent(new CustomEvent('mig:communications-appointment',{detail:{clientId:row.client_id,origin:kind,recordId:id}}));
    feedback.textContent='Opening appointment calendar…';
   };
   const play=node.querySelector('[data-review-play]');
   if(play)play.onclick=async()=>{
    const box=node.querySelector('[data-review-audio]');
    play.disabled=true;play.textContent='Loading voicemail…';
    try{
     const response=await fetch('/api/ringcentral-voicemail-audio?id='+encodeURIComponent(id),{
      headers:await smsAuthHeaders(),cache:'no-store'
     });
     if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Unable to play voicemail.');}
     const blob=await response.blob();
     if(!box.isConnected)return;
     const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';
     audio.src=URL.createObjectURL(blob);audio.onended=()=>{};
     box.replaceChildren(audio);try{await audio.play();}catch{}
    }catch(error){play.disabled=false;play.textContent='▶ Play Voicemail';feedback.textContent=error?.message||'Voicemail audio unavailable.';}
   };
  });
 };
 wrapper.querySelectorAll('[data-review-view]').forEach(button=>button.onclick=()=>selectMode(button.dataset.reviewView));
 input.onchange=()=>{date=input.value||DAY_ALL;draw();};
 wrapper.querySelector('[data-review-all-days]').onclick=()=>{date=DAY_ALL;input.value='';draw();};
 wrapper.querySelector('[data-review-today]').onclick=()=>{date=dayKey(new Date());input.value=date;draw();};
 wrapper.querySelector('[data-review-refresh]').onclick=()=>void refresh({force:true});
 const onCallsChanged=event=>{if(event.detail?.kind==='calls' && mode!=='all')void refresh();};
 window.addEventListener('mig:communications-changed',onCallsChanged);
 wrapper.addEventListener('DOMNodeRemoved',()=>window.removeEventListener('mig:communications-changed',onCallsChanged),{once:true});
 panel.dataset.callReviewMounted='true';
}
function mount(){
 const panel=document.querySelector('.mh-call-panel');
 if(panel && !panel.dataset.callReviewMounted)makeUI(panel);
}
window.addEventListener('mig:call-panel-ready',mount);
window.addEventListener('hashchange',()=>setTimeout(mount,0));
window.addEventListener('mig:communications-rendered',mount);
setTimeout(mount,0);
