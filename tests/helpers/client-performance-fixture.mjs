// Real repository + editor modules with synthetic, latency-controlled data.
// No credentials, production rows, or external requests are used.
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundles=new Map();
const entry=`import {mhRepository} from './supabase-repository.js';
import {Dialogs} from './dialogs.js';import {clientForm} from './views.js';
import {hydrate,serializable,wireDates} from './core.js';
import './client-product-status.js';import './medicare-gov-credentials.js';
import './banking-information.js';import './life-multiple-policies.js';
import './client-pharmacy.js';import './client-health-tabs.js';
import './client-personal-underwriting.js';import './client-intake-sections.js';
import './client-medicare-cleanup.js';import './client-audit-fixes.js';
import './secure-license-dirty.js';
window.testClient={mhRepository,Dialogs,clientForm,hydrate,serializable,wireDates};`;
async function bundle(ref){
 if(bundles.has(ref))return bundles.get(ref);
 const result=await build({stdin:{contents:entry,resolveDir:root},bundle:true,format:'iife',write:false,plugins:[{name:'synthetic-only',setup(b){
  b.onResolve({filter:/supabase-client\.js$/},()=>({path:'test-db',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const supabase=window.testDatabase;'}));
  b.onResolve({filter:/^\.\.?\//},args=>({path:path.resolve(args.resolveDir,args.path.split('?')[0])}));
  if(ref)b.onLoad({filter:/\.js$/},args=>({contents:execFileSync('git',['show',ref+':'+path.relative(root,args.path)],{cwd:root,encoding:'utf8'}),loader:'js',resolveDir:path.dirname(args.path)}));
 }}]});
 const output=result.outputFiles[0].text;bundles.set(ref,output);return output;
}
export async function clientFixture({ref='',latency=0}={}){
 const dom=new JSDOM('<body></body>',{url:'https://synthetic.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const id='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222';
 const db={clients:[{id,assigned_agent_id:owner,first_name:'Synthetic',last_name:'Client',date_of_birth:'1960-04-12',status:'active',products:['medicare','life'],gender:'Male',phone:'555-0100',address1:'123 Test Street',zip_code:'00000',height_feet:6,height_inches:2,weight_lbs:200,smoker:false,veteran:false,doctors_section_notes:'Original doctor note',updated_at:'v0'}],
  medicare_details:[{client_id:id,part_a_date:'2025-01-01',part_b_date:'2025-02-01',sunfire_code:'SYNTHETIC-SUNFIRE',medicaid_level:'QMB',medicaid_number:'SYNTHETIC-MEDICAID'}],
  health_plans:[{id:'health-1',client_id:id,carrier:'Humana',plan_id:'H0000-000',member_id:'MEMBER-1',plan_type:'Medicare Advantage',premium:0,status:'active'}],
  life_policies:[{id:'life-1',client_id:id,carrier:'Gerber',product:'Whole Life',policy_type:'Whole Life',policy_number:'SYNTHETIC-POLICY',premium:10,premium_mode:'Monthly',face_amount:10000,status:'active'}],
  client_doctors:[{id:'doctor-1',client_id:id,doctor_name:'Doctor One',phone:'555-0101'},{id:'doctor-2',client_id:id,doctor_name:'Doctor Two',phone:'555-0102'}],
  client_medications:[{id:'medication-1',client_id:id,medication_name:'Synthetic Medication',strength:'10mg',status:'active'}],
  client_pharmacies:[{client_id:id,pharmacy_name:'Synthetic Pharmacy',pharmacy_location:'Synthetic City'}],hospital_indemnity_plans:[],retirement_accounts:[],documents:[]};
 const vault={sensitive:{ssn:'SYNTHETIC-SSN',medicare_number:'SYNTHETIC-MEDICARE',medicaid_number:'SYNTHETIC-MEDICAID',drivers_license_number:'SYNTHETIC-LICENSE'},banking:{payment_method:'bank',bank_name:'Synthetic Bank',routing_number:'000000000',account_number:'000000000'},credentials:{username:'synthetic-user',password:'synthetic-password'}};
 const requests=[],errors=[];let sequence=0,failTable='',failSensitiveRead=false;
 const delay=()=>latency?new Promise(resolve=>setTimeout(resolve,latency)):Promise.resolve();
 const from=table=>{
  let action='select',payload,one=false,filters=[],take=1000;
  const q={select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},in(k,v){filters.push(row=>v.includes(row[k]));return q;},order(){return q;},limit(n){take=n;return q;},or(){return q;},maybeSingle(){one=true;return q;},single(){one=true;return q;},update(v){action='update';payload=v;return q;},insert(v){action='insert';payload=v;return q;},upsert(v){action='upsert';payload=v;return q;},delete(){action='delete';return q;},async then(resolve,reject){
   try{
    const request={table,action,payload:structuredClone(payload),started:Date.now()};requests.push(request);await delay();
    if(failTable===table&&action!=='select'){failTable='';return resolve({data:null,error:new w.Error('Synthetic interrupted save')});}
    let rows=(db[table]||[]).filter(row=>filters.every(f=>f(row))).slice(0,take);
    if(action==='update'){rows.forEach(row=>Object.assign(row,payload,{updated_at:'v'+(++sequence)}));}
    if(action==='upsert'){
     let row=(db[table]||[]).find(row=>payload.id?row.id===payload.id:row.client_id===payload.client_id);
     if(row)Object.assign(row,payload);else{row={...payload};(db[table]??=[]).push(row);}rows=[row];
    }
    if(action==='insert'){const row={id:'synthetic-created-'+(++sequence),...payload,updated_at:'v'+sequence};(db[table]??=[]).push(row);rows=[row];}
    if(action==='delete')db[table]=(db[table]||[]).filter(row=>!rows.includes(row));
    request.finished=Date.now();resolve({data:structuredClone(one?rows[0]||null:rows),error:null});
   }catch(error){reject(error);}
  }};return q;
 };
 w.fetch=async()=>{throw Error('External network disabled in client tests');};w.open=()=>null;w.scrollTo=()=>{};w.confirm=()=>true;w.CSS={escape:v=>String(v)};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.addEventListener('error',e=>errors.push(e.error?.message||e.message));
 const observers=[],Observer=w.MutationObserver;w.MutationObserver=class extends Observer{constructor(cb){super(cb);observers.push(this);}};
 w.testDatabase={from,auth:{async getUser(){return {data:{user:{id:owner}}};},async getSession(){return {data:{session:{user:{id:owner},access_token:'SYNTHETIC-INVALID'}}};}},functions:{async invoke(name,{body}){
  requests.push({table:name,action:body.action,started:Date.now()});await delay();const key=name==='client-sensitive'?'sensitive':name==='client-banking'?'banking':'credentials';
  if(failSensitiveRead&&name==='client-sensitive'&&body.action==='get'){failSensitiveRead=false;return {data:null,error:new w.Error('Synthetic protected read failed')};}
  if(body.action==='save')Object.assign(vault[key],body[key]||{});
  return {data:{[key]:structuredClone(vault[key]),success:true},error:null};
 }}};
 w.eval(await bundle(ref));
 const api=w.testClient,repo=api.mhRepository;repo.user={id:owner};repo.profile={id:owner,active:true,role:'owner'};
 const record=await repo.getClient(id);const dialogs=new api.Dialogs();const controller=dialogs.open({kind:'client-dialog',clientId:id,body:api.clientForm(true)}),form=controller.node.querySelector('form');
 api.hydrate(form,record);controller.attachForm(form);
 await settle();await settle();
 while(form.dataset.clientBackgroundLoads){await new Promise(resolve=>setTimeout(resolve,1));}
 await settle();requests.length=0;
 const fill=(name,value)=>{const el=form.elements.namedItem(name);if(!el)throw Error('Field missing: '+name);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 let saved=record;
 const save=async()=>{saved=await repo.saveClient({...saved,...api.serializable(form)},{expectedVersion:saved.updated_at,skipUnchangedLicense:form.dataset.auditExistingClient==='true'&&form.dataset.auditSensitiveDirty!=='true'});return saved;};
 return {w,dom,api,repo,db,vault,requests,errors,form,fill,save,fail:table=>failTable=table,failProtectedRead:()=>failSensitiveRead=true,close(){observers.forEach(o=>o.disconnect());dialogs.destroy();w.close();}};
}
async function settle(){await new Promise(resolve=>setTimeout(resolve,0));}
