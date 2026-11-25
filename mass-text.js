import {installMassTextStyles} from './mass-text-styles.js';
import {supabase} from './supabase-repository.js';
import {smsAuthHeaders} from './sms-sync.js';
import './text-attachments.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scope='arctos';
const textingAgent='';
const normalize=v=>{const n=String(v||'').replace(/\D/g,'');return n.length===10?'1'+n:n.length===11&&n[0]==='1'?n:'';};
export async function openMassText({clients:initial=null,agentId=''}={}){
  installMassTextStyles();
  const dialog=document.createElement('dialog');dialog.className='sms-mass-dialog crm-mass-text-dialog';
  dialog.innerHTML=`<div class="crm-mass-frame">
    <header class="crm-mass-head"><h2>Mass Text Clients</h2><button type="button" class="btn secondary" data-close>Close</button></header>
    <div class="crm-mass-layout">
      <section class="crm-mass-picker" aria-label="Choose recipients">
        <label class="crm-mass-field" data-agent-label>Agent<select data-agent></select></label>
        <label class="crm-mass-field">Find a client<input type="search" data-find placeholder="Search name or phone"></label>
        <div class="crm-mass-tools"><button type="button" class="btn secondary" data-all>Select All</button><button type="button" class="btn secondary" data-none>Deselect All</button></div>
        <p class="crm-mass-count" data-count role="status"></p>
        <div class="crm-mass-recipients" data-recipients></div>
      </section>
      <form class="crm-mass-compose">
        <label class="crm-mass-field">Message<textarea name="body" maxlength="1500" rows="5" placeholder="Write your message"></textarea></label>
        <div data-file></div>
        <label class="crm-mass-consent"><input type="checkbox" name="consent" required><span>I confirm these clients have given permission to receive this message.</span></label>
        <p class="crm-mass-status" data-status role="status" aria-live="polite"></p>
        <button class="btn primary" type="submit" data-send>Send to selected clients</button>
        <small>Keep this window open until sending finishes.</small>
      </form>
    </div>
  </div>`;
  document.body.append(dialog);dialog.showModal();
  const form=dialog.querySelector('form'),select=dialog.querySelector('[data-agent]'),list=dialog.querySelector('[data-recipients]'),status=dialog.querySelector('[data-status]'),send=dialog.querySelector('[data-send]');
  const attachment=window.CrmTextAttachments.picker(dialog.querySelector('[data-file]'),{scope,headers:smsAuthHeaders});
  let rows=[],selected=new Set(),sending=false,loading=false,ticket=0,operations=new Map(),campaignKey='';
  const closing=e=>{if(sending){e.preventDefault();return;}ticket++;attachment.clear();dialog.close();dialog.remove();};
  dialog.querySelector('[data-close]').onclick=closing;dialog.addEventListener('cancel',closing);
  const unload=e=>{if(sending){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  dialog.addEventListener('close',()=>window.removeEventListener('beforeunload',unload),{once:true});
  const eligible=c=>String(c.status||'').toLowerCase()!=='deceased'&&!!normalize(c.phone)&&(!textingAgent||c.assigned_agent_id===textingAgent);
  function update(){
    dialog.querySelector('[data-count]').textContent=selected.size+' selected · '+rows.length+' clients';
    send.disabled=sending||loading||!selected.size;
    select.disabled=sending||loading||!!initial;
    dialog.querySelectorAll('[data-all],[data-none]').forEach(b=>b.disabled=sending||loading);
    form.querySelector('textarea').disabled=sending;form.elements.consent.disabled=sending;attachment.disable(sending);
    dialog.querySelector('[data-close]').disabled=sending;
  }
  function draw(){
    const term=dialog.querySelector('[data-find]').value.trim().toLowerCase();
    list.innerHTML=rows.filter(c=>!term||[c.first_name,c.last_name,c.phone].join(' ').toLowerCase().includes(term)).map(c=>'<label class="crm-mass-recipient"><input type="checkbox" data-id="'+esc(c.id)+'"'+(selected.has(c.id)?' checked':'')+(sending||!eligible(c)?' disabled':'')+'><span><strong>'+esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'Client')+'</strong><small>'+esc(c.phone||'No phone')+(!eligible(c)?' · Unavailable for texting':'')+'</small></span></label>').join('')||'<p>No matching clients.</p>';
    list.querySelectorAll('input').forEach(b=>b.onchange=()=>{if(b.checked)selected.add(b.dataset.id);else selected.delete(b.dataset.id);update();});
    update();
  }
  async function load(){
    const current=++ticket;selected.clear();rows=[];loading=true;status.textContent='Loading every client for this agent…';draw();
    try{
      const all=[];
      for(let offset=0;;offset+=1000){
        let query=supabase.from('clients').select('id,first_name,last_name,phone,status,assigned_agent_id').order('id').range(offset,offset+999);
        if(select.value)query=query.eq('assigned_agent_id',select.value);
        const {data,error}=await query;if(error)throw error;
        if(current!==ticket||!dialog.isConnected)return;
        all.push(...data);if(data.length<1000)break;
      }
      rows=all;status.textContent='';
    }catch(e){status.textContent=e.message;}finally{if(current===ticket){loading=false;draw();}}
  }
  dialog.querySelector('[data-find]').oninput=draw;
  dialog.querySelector('[data-all]').onclick=()=>{selected=new Set(rows.filter(eligible).map(c=>c.id));draw();};
  dialog.querySelector('[data-none]').onclick=()=>{selected.clear();draw();};
  select.onchange=load;
  form.onsubmit=async e=>{
    e.preventDefault();if(sending||!selected.size)return;
    if(!form.elements.consent.checked){status.textContent='Confirm recipient permission before sending.';return;}
    const body=form.elements.body.value.trim();
    if(!body&&!attachment.hasFile()){status.textContent='Enter a message or choose an attachment.';return;}
    sending=true;draw();let submitted=0,failed=0,duplicates=0;
    try{
      const attachmentId=await attachment.upload(),key=JSON.stringify([body,attachmentId]);
      if(key!==campaignKey){campaignKey=key;operations.clear();}
      const seen=new Set(),recipients=[];
      for(const c of rows.filter(c=>selected.has(c.id))){
        const phone=normalize(c.phone);
        if(seen.has(phone)){selected.delete(c.id);duplicates++;continue;}
        seen.add(phone);recipients.push(c);
      }
      let cursor=0;
      async function worker(){
        while(cursor<recipients.length){
          const c=recipients[cursor++];let operation=operations.get(c.id);
          if(!operation){operation=crypto.randomUUID();operations.set(c.id,operation);}
          try{
            const response=await fetch('/api/twilio-send',{method:'POST',headers:{...(await smsAuthHeaders()),'Content-Type':'application/json'},body:JSON.stringify({clientId:c.id,body,attachmentId,operationId:operation,bulk:true,consentConfirmed:form.elements.consent.checked})});
            const result=await response.json().catch(()=>({}));
            if(!response.ok||['failed','undelivered'].includes(result.status))throw Error(result.error||'The text failed.');
            selected.delete(c.id);submitted++;
          }catch{failed++;}
          status.textContent=submitted+' submitted · '+failed+' failed · '+duplicates+' duplicate numbers skipped · '+selected.size+' remaining. Keep this window open until sending finishes.';
          update();
        }
      }
      await Promise.all(Array.from({length:Math.min(4,recipients.length)},worker));
      status.textContent=submitted+' submitted · '+failed+' failed · '+duplicates+' duplicate numbers skipped. '+(failed?'Failed recipients remain selected. Delivery status is shown in each conversation.':'Delivery status is shown in each conversation.');
      window.dispatchEvent(new CustomEvent('mig:communications-changed',{detail:{section:'texts'}}));
    }catch(error){status.textContent=error.message;}finally{sending=false;draw();}
  };
  try{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)throw Error('Sign in again to send texts.');
    const {data:profile,error:profileError}=await supabase.from('profiles').select('id,role,active').eq('id',user.id).single();
    if(profileError||!profile.active)throw Error('Your texting account is unavailable.');
    let agents;
    if(['owner','admin'].includes(profile.role)){
      const result=await supabase.from('profiles').select('id,full_name').eq('active',true).order('full_name');
      if(result.error)throw result.error;agents=result.data;
    }else agents=[{id:user.id,full_name:'My clients'}];
    if(textingAgent)agents=agents.filter(a=>a.id===textingAgent);
    select.innerHTML=agents.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.full_name)+'</option>').join('');
    if(!agents.length)throw Error('This account has no clients available for texting.');
    select.value=agents.some(a=>a.id===agentId)?agentId:agents.some(a=>a.id===user.id)?user.id:agents[0].id;
    if(initial){dialog.querySelector('[data-agent-label]').hidden=true;rows=initial;selected=new Set(rows.filter(eligible).map(c=>c.id));draw();}
    else await load();
  }catch(error){status.textContent=error.message;send.disabled=true;}
}
