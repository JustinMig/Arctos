import { supabase } from './supabase-repository.js';
import { WORK_VIEWS, buildWorkQueue, filterWorkQueue } from './work-queue-model.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const localDay=(value=new Date())=>[value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
const LIMIT=500;
function queryResult(result){
 if(result.error)throw result.error;
 return result.data||[];
}
async function fetchQueue(){
 const [l,c,a]=await Promise.allSettled([
  supabase.from('workspace_leads').select('id,first_name,last_name,phone,notes,status,client_id,created_at').order('created_at',{ascending:false}).limit(LIMIT).then(queryResult),
  supabase.from('campaign_summaries').select('id,name,status,topic,created_at').eq('status','active').order('created_at',{ascending:false}).limit(100).then(queryResult),
  supabase.from('appointments').select('id,client_id,title,event_type,event_date,start_time,status,notes').gte('event_date',localDay(new Date(Date.now()-45*86400000))).lte('event_date',localDay(new Date(Date.now()+45*86400000))).order('event_date',{ascending:true}).limit(LIMIT).then(queryResult)
 ]);
 const errors=[];
 const value=(r,name)=>{if(r.status==='fulfilled')return r.value;errors.push(name+': '+(r.reason?.message||'Could not load'));return[];};
 const leads=value(l,'Leads'),campaigns=value(c,'Campaigns'),appointments=value(a,'Appointments');
 let members=[];
 if(campaigns.length){
  const q=await Promise.allSettled([supabase.from('campaign_member_results')
    .select('id,campaign_id,client_id,first_name,last_name,phone,client_status,contact_status,last_note,next_action,last_contacted_at,added_at,next_event_id,next_event_date,next_event_status')
    .in('campaign_id',campaigns.map(c=>c.id)).order('added_at',{ascending:false}).limit(LIMIT).then(queryResult)]);
  members=value(q[0],'Campaign contacts');
 }
 const overdue=await Promise.allSettled([supabase.from('appointments').select('id,client_id,title,event_type,event_date,start_time,status,notes')
  .eq('status','needs_reschedule').order('event_date',{ascending:true}).limit(LIMIT).then(queryResult)]);
 const followups=value(overdue[0],'Reschedule queue');
 const byId=new Map([...appointments,...followups].map(item=>[item.id,item]));
 const truncated=leads.length===LIMIT||members.length===LIMIT||appointments.length===LIMIT||followups.length===LIMIT||campaigns.length===100;
 return {items:buildWorkQueue({leads,campaigns,members,appointments:[...byId.values()],today:localDay()}),errors,truncated,campaigns};
}

export function createWorkQueueFeature({openCampaign,openLead,openClient,openAppointment}={}){
 let host=null,view='leads',items={leads:[],contact:[],followups:[],completed:[]},campaigns=[],errors=[],truncated=false,search='',loading=false,token=0;
 const isActive=()=>host?.isConnected;
 const filter=()=>filterWorkQueue(items[view]||[],search);
 function itemCard(item){
  const kind=item.kind;
  const action=kind==='lead'?'data-work-open-lead="'+esc(item.id)+'"':
    kind==='campaign'?'data-work-open-campaign="'+esc(item.campaignId)+'"':
      'data-work-open-appointment="'+esc(item.eventId||item.id)+'"';
  const actionText=kind==='lead'?'Open lead':kind==='campaign'?'Open campaign':'Open appointment';
  const date=item.due ? '<span class="wq-due">'+esc(item.due)+'</span>' : '';
  return '<article class="wq-card" data-work-item="'+esc(item.key)+'">' +
   '<div class="wq-card-main"><div class="wq-card-title"><strong>'+esc(item.name)+'</strong><span class="wq-tag">'+esc(item.label)+'</span></div>'+
   '<p class="wq-meta">'+esc(item.source)+(item.campaign?' · '+esc(item.campaign):'')+
    (item.phone?' · '+esc(item.phone):'')+'</p>'+
   (item.note?'<p class="wq-note">'+esc(item.note)+'</p>':'')+'</div>'+
   '<div class="wq-card-actions">'+date+
    '<button type="button" class="wq-open" '+action+'>'+actionText+' →</button>'+
    (item.kind==='campaign'&&item.clientId?'<button type="button" class="wq-link" data-work-open-client="'+esc(item.clientId)+'">Client record</button>':'')+
    (item.kind==='lead'&&item.phone?'<a class="wq-link" href="tel:'+esc(item.phone.replace(/\D/g,''))+'">Call</a>':'')+
   '</div></article>';
 }
 function render(){
  if(!isActive())return;
  host.innerHTML='<section class="work-queue" aria-label="Arctos Work Queue"><header class="wq-header">'+
    '<div><span class="eyebrow">ARCTOS / DAILY WORK</span><h2>Work Queue</h2><p>Leads, campaign contacts and follow-ups in one place. Actions still save to their original records.</p></div>'+
    '<div class="wq-actions"><button type="button" class="btn primary" data-work-new-lead>+ Lead</button><button type="button" class="btn secondary" data-work-campaigns>Campaigns</button>'+
    '<button type="button" class="btn secondary" data-work-refresh '+(loading?'disabled':'')+'>Refresh</button></div></header>'+
    '<nav class="wq-tabs" role="tablist" aria-label="Work status">'+WORK_VIEWS.map(([key,label])=>'<button type="button" role="tab" data-work-tab="'+key+'" aria-selected="'+(key===view)+'" class="'+(key===view?'active':'')+'">'+esc(label)+
    '<span class="wq-number">'+(loading?'—':items[key].length)+'</span></button>').join('')+'</nav>'+
    '<div class="wq-filter"><label><span>Search this list</span><input data-work-search type="search" placeholder="Client, phone, campaign, next action" value="'+esc(search)+'"></label>'+
    '<span class="wq-list-total" data-work-total></span></div>'+
    '<div class="wq-status" data-work-status role="status" aria-live="polite">'+(loading?'Loading your current work…':'')+'</div>'+
    '<div class="wq-list" data-work-list></div>'+
    '<p class="wq-footnote">Each entry opens its original lead, campaign, or appointment. A campaign follow-up and its linked calendar appointment appear only once.</p></section>';
  host.querySelectorAll('[data-work-tab]').forEach(b=>b.onclick=()=>{view=b.dataset.workTab;render();});
  host.querySelector('[data-work-search]').oninput=e=>{search=e.target.value;renderList();};
  host.querySelector('[data-work-new-lead]').onclick=()=>openLead?.(null);
  host.querySelector('[data-work-campaigns]').onclick=()=>openCampaign?.(null);
  host.querySelector('[data-work-refresh]').onclick=()=>void load();
  host.querySelector('[data-work-list]').addEventListener('click',event=>{
    const lead=event.target.closest('[data-work-open-lead]');
    const campaign=event.target.closest('[data-work-open-campaign]');
    const client=event.target.closest('[data-work-open-client]');
    const appointment=event.target.closest('[data-work-open-appointment]');
    if(lead)void openLead?.(lead.dataset.workOpenLead);
    if(campaign)void openCampaign?.(campaign.dataset.workOpenCampaign);
    if(client)void openClient?.(client.dataset.workOpenClient);
    if(appointment)void openAppointment?.(appointment.dataset.workOpenAppointment);
  });
  renderList();
 }
 function renderList(){
  if(!isActive())return;
  const total=host.querySelector('[data-work-total]'),list=host.querySelector('[data-work-list]'),status=host.querySelector('[data-work-status]');
  if(!list)return;
  const visible=filter();
  if(total)total.textContent=loading?'':visible.length+' of '+(items[view]||[]).length+' shown';
  if(status){
   if(loading){status.hidden=false;status.textContent='Loading your current work…';}
   else if(errors.length){status.hidden=false;status.textContent='Some records could not load: '+errors.join(' · ')+'. Refresh to retry.';}
   else if(truncated){status.hidden=false;status.textContent='Showing a limited set of records. Open Leads or Campaigns for full lists.';}
   else status.hidden=true;
  }
  list.innerHTML=loading?'<p class="wq-empty">Loading…</p>':
    visible.length?visible.slice(0,150).map(itemCard).join(''):'<p class="wq-empty">No records in this view.</p>';
  if(visible.length>150)list.insertAdjacentHTML('beforeend','<p class="wq-empty">Showing the first 150 matches. Search to narrow the list.</p>');
 }
 async function load(){
  const t=++token;loading=true;render();
  try{
   const data=await fetchQueue();
   if(t!==token||!isActive())return;
   ({items,errors,truncated,campaigns}=data);
  }catch(error){if(t===token)errors=[error?.message||'Work Queue failed to load'];}
  finally{if(t===token){loading=false;render();}}
 }
 function refresh(){if(isActive())void load();}
 function mount(node){host=node;view='leads';search='';items={leads:[],contact:[],followups:[],completed:[]};void load();}
 function unmount(){token++;host=null;}
 return {mount,unmount,refresh,destroy:unmount};
}
