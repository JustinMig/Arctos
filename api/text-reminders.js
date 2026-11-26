import {randomBytes,randomUUID} from 'node:crypto';
import {adminRest,normalizeUsPhone,requireCrmUser} from '../server/communications.js';

export const config={maxDuration:60};
const owner='9ca80b13-42e7-46eb-9ad8-c0bb700c6ba9';
const table='/rest/v1/arctos_reminder_phone';
const settingsPath=table+'?user_id=eq.'+owner;
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function authorized(request){
 const user=await requireCrmUser(request);
 if(user.id!==owner)throw Object.assign(Error('Justin’s Arctos account is required.'),{status:403});
}
async function settings(){return (await adminRest(settingsPath+'&select=*'))[0];}
function officeNumber(){
 const n=normalizeUsPhone(process.env.TWILIO_PHONE_NUMBER);
 if(!n)throw Error('Missing Twilio number.');
 return n;
}
function display(s){
 const pending=s&&!s.verified_at&&Date.now()-Date.parse(s.requested_at)<15*60000;
 return {number:officeNumber(),state:s?.verified_at?'linked':pending?'pending':'unlinked',ending:s?.phone.slice(-4),code:pending?s.link_code:undefined};
}
function failure(e){return reply({error:e.status&&e.status<500?e.message:'Could not connect to Arctos text reminders. Try again.'},e.status||503);}
export async function GET(request){
 try{await authorized(request);return reply(display(await settings()));}catch(e){return failure(e);}
}
export function parseMessage(m,phone,to){
 if(m.direction!=='inbound'||m.from!==phone||m.to!==to||!/^SM[0-9a-f]{32}$/i.test(m.sid))return null;
 const time=Date.parse(m.date_sent||m.date_created);
 if(!Number.isFinite(time))return null;
 const base={sid:m.sid,sent:new Date(time).toISOString()};
 const body=String(m.body||'').trim();
 const link=/^link arctos\s+([0-9a-f]{12})$/i.exec(body);
 if(link)return {...base,kind:'link',code:link[1].toUpperCase()};
 const note=/^make\s+note(?:\s*[:,\-]\s*|\s+)([\s\S]+)$/i.exec(body)?.[1]?.trim();
 return note&&Array.from(note).length<=1600?{...base,kind:'note',description:note}:null;
}
async function collect(s){
 const start=new Date(),to=officeNumber(),account=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
 if(!account||!token)throw Error('Twilio is unavailable.');
 const since=Math.max(Math.floor(Date.parse(s.requested_at)/1000)*1000,(Date.parse(s.checked_at)||0)-10*60000);
 const url=new URL('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(account)+'/Messages.json');
 url.search=new URLSearchParams({From:s.phone,To:to,'DateSent>':new Date(since).toISOString().slice(0,10),PageSize:'100'});
 const items=[];let next=url;
 while(next){
  if(next.origin!==url.origin||next.pathname!==url.pathname)throw Error('Invalid Twilio page.');
  const response=await fetch(next,{headers:{Authorization:'Basic '+Buffer.from(account+':'+token).toString('base64')},signal:AbortSignal.timeout(12000),redirect:'error',cache:'no-store'});
  if(!response.ok)throw Error('Twilio could not load the messages.');
  const page=await response.json();
  for(const m of page.messages){const item=parseMessage(m,s.phone,to);if(item&&Date.parse(item.sent)>=since)items.push(item);}
  next=page.next_page_uri?new URL(page.next_page_uri,url):null;
 }
 await adminRest('/rest/v1/rpc/arctos_apply_reminder_messages',{method:'POST',body:{p_generation:s.generation,p_items:items,p_checked_at:start.toISOString()}});
}
export async function POST(request){
 try{
  const ticket=request.headers.get('x-reminder-tick');
  if(ticket!==null){
   if(!/^[a-f0-9-]{36}$/i.test(ticket)||!(await adminRest('/rest/v1/rpc/arctos_take_reminder_tick',{method:'POST',body:{p_token:ticket}})))return reply({error:'Invalid reminder job.'},403);
   const s=await settings();if(s)await collect(s);return reply({ok:true});
  }
  await authorized(request);
  const body=await request.json();
  if(body.action==='unlink'){await adminRest(settingsPath,{method:'DELETE'});return reply(display(null));}
  const phone=normalizeUsPhone(body.phone);
  if(body.action!=='link'||!/^\+1\d{10}$/.test(phone)||phone===officeNumber())return reply({error:'Enter your personal US mobile number.'},400);
  const row={user_id:owner,phone,generation:randomUUID(),link_code:randomBytes(6).toString('hex').toUpperCase(),requested_at:new Date().toISOString(),verified_at:null,checked_at:null};
  await adminRest(table+'?on_conflict=user_id',{method:'POST',body:row,prefer:'resolution=merge-duplicates,return=minimal'});
  return reply(display(row));
 }catch(e){return failure(e);}
}
