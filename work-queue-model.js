// The Work Queue is a read-only projection of existing Arctos records.
// A campaign contact and its linked appointment represent ONE next action.
// Changes to a campaign or lead continue through their existing editors.
export const WORK_VIEWS=Object.freeze([
 ['leads','New Leads'],['contact','Need Contact'],['followups','Follow-ups'],['completed','Completed']
]);
const status=x=>String(x||'').toLowerCase();
const key=x=>String(x||'');
const person=x=>[x.first_name,x.last_name].filter(Boolean).join(' ').trim()||x.full_name||'Client';
const complete=new Set(['completed','cancelled','canceled','deleted']);
const followupStatus=x=>status(x)==='needs_reschedule';
const scheduled=x=>!complete.has(status(x))&&!followupStatus(x);
const orderBy=(a,b)=>key(a.due||'9999').localeCompare(key(b.due||'9999'))||key(a.name).localeCompare(key(b.name));
export function buildWorkQueue({leads=[],campaigns=[],members=[],appointments=[],today=''}={}) {
 const items={leads:[],contact:[],followups:[],completed:[]};
 const activeCampaign=new Map(campaigns.filter(c=>status(c.status)==='active').map(c=>[c.id,c]));
 const linkedEvents=new Set();
 const contactByClient=new Map();
 for(const lead of leads){
  const item={key:'lead:'+lead.id,kind:'lead',id:lead.id,clientId:lead.client_id||null,
   name:person(lead),phone:lead.phone||'',note:lead.notes||'',campaign:'',
   label:lead.status==='converted'?'Converted lead':'New lead',date:lead.created_at||'',due:'',
   source:'Lead',sortTime:lead.created_at||''};
  if(status(lead.status)==='lead')items.leads.push(item);
  else if(status(lead.status)==='converted')items.completed.push(item);
 }
 for(const member of members){
  const campaign=activeCampaign.get(member.campaign_id);
  if(!campaign || status(member.client_status)==='deceased')continue;
  const action=status(member.contact_status);
  const base={key:'campaign:'+member.id,kind:'campaign',id:member.id,campaignId:campaign.id,
   clientId:member.client_id||null,name:person(member),phone:member.phone||'',
   note:member.next_action||member.last_note||'',campaign:campaign.name||'Campaign',
   source:'Campaign',date:member.last_contacted_at||member.added_at||'',
   sortTime:member.last_contacted_at||member.added_at||'',due:member.next_event_date||'',
   eventId:member.next_event_id||'',label:'Contact client'};
  // The member is the single source shown for its calendar-linked action.
  if(member.next_event_id)linkedEvents.add(member.next_event_id);
  if(['not_contacted','no_answer','voicemail'].includes(action)){
   // One visible contact entry per client; repeated memberships are still
   // accessible in their respective campaigns.
   if(member.next_event_id && scheduled(member.next_event_status))continue;
   const next={...base,label:action==='not_contacted'?'First contact':action==='voicemail'?'Voicemail left':'Try again'};
   const previous=contactByClient.get(member.client_id);
   if(!previous||key(next.date)>key(previous.date))contactByClient.set(member.client_id,next);
  }else if(action==='follow_up'){
   const done=complete.has(status(member.next_event_status))&&status(member.next_event_status)==='completed';
   const next={...base,label:done?'Follow-up completed':'Campaign follow-up'};
   items[done?'completed':'followups'].push(next);
  }else if(action==='declined'){
   items.completed.push({...base,label:'Declined'});
  }
 }
 items.contact.push(...contactByClient.values());
 for(const appointment of appointments){
  if(linkedEvents.has(appointment.id))continue;
  const st=status(appointment.status);
  const isFollow=String(appointment.event_type||'').toLowerCase().includes('follow');
  if(!isFollow && st!=='needs_reschedule' && st!=='completed')continue;
  const next={key:'appointment:'+appointment.id,kind:'appointment',id:appointment.id,
   eventId:appointment.id,clientId:appointment.client_id||null,
   name:appointment.title||'Appointment',phone:'',note:appointment.notes||'',
   campaign:'',source:'Calendar',date:appointment.event_date||'',due:appointment.event_date||'',
   sortTime:appointment.event_date||'',label:st==='needs_reschedule'?'Needs rescheduling':st==='completed'?'Completed appointment':'Scheduled follow-up'};
  if(st==='completed')items.completed.push(next);
  else if(st==='needs_reschedule'||(isFollow && scheduled(st)))items.followups.push(next);
 }
 items.leads.sort((a,b)=>key(b.sortTime).localeCompare(key(a.sortTime)));
 items.contact.sort((a,b)=>key(a.sortTime).localeCompare(key(b.sortTime)));
 items.followups.sort(orderBy);
 items.completed.sort((a,b)=>key(b.sortTime).localeCompare(key(a.sortTime)));
 return items;
}
export function filterWorkQueue(items,search='') {
 const term=String(search).trim().toLowerCase();
 if(!term)return items;
 return items.filter(item=>[item.name,item.phone,item.note,item.campaign,item.label,item.source].some(x=>String(x||'').toLowerCase().includes(term)));
}
