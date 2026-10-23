// Synthetic in-browser Supabase fixture. No production or external requests.
const OWNER='00000000-0000-4000-8000-000000000001';
const clients=[{
  id:'00000000-0000-4000-8000-000000000014',first_name:'Jane',last_name:'Example',
  phone:'6625550100',date_of_birth:'1960-04-12',email:'jane@example.invalid',
  address1:'Synthetic Street',city:'Corinth',state:'MS',zip_code:'38834',county:'Alcorn',
  gender:'female',veteran:false
}];
const reviews=[],documents=[],vault={}; let count=0;
const medicare_details=[{client_id:'00000000-0000-4000-8000-000000000014',part_a_date:'2025-01-01',part_b_date:'2025-02-01',medicaid_level:'QMB',sunfire_code:'SF-JANE-001'}];
const health_plans=[{id:'00000000-0000-4000-8000-000000000041',client_id:'00000000-0000-4000-8000-000000000014',carrier:'Old Carrier',plan_name:'Original Coverage',plan_id:'H0000-000',member_id:'M000',plan_type:'HMO',premium:12,status:'active'}];
const client_doctors=[{id:'00000000-0000-4000-8000-000000000042',client_id:'00000000-0000-4000-8000-000000000014',doctor_name:'Dr Smith',specialty:'Primary Care',city:'Corinth',state:'MS',notes:'In network'}];
const client_medications=[{id:'00000000-0000-4000-8000-000000000043',client_id:'00000000-0000-4000-8000-000000000014',medication_name:'Metformin',strength:'500mg',frequency:'Daily',notes:'Old note',status:'active'}];
const client_pharmacies=[{client_id:'00000000-0000-4000-8000-000000000014',pharmacy_name:'Town Pharmacy',pharmacy_location:'Corinth, MS',pharmacy_name_2:null,pharmacy_location_2:null}];
window.__athenaFixture={clients,reviews,documents,vault,medicare_details,health_plans,client_doctors,client_medications,client_pharmacies};

function query(table){
  let op='read',values=null,single=false,conditions=[],limit=999;
  const q={
    select(){return q;},
    eq(k,v){conditions.push([k,'eq',v]);return q;},
    ilike(k,v){conditions.push([k,'ilike',v]);return q;},
    or(){return q;},
    order(){return q;},
    limit(n){limit=n;return q;},
    insert(body){op='insert';values=body;return q;},
    update(body){op='update';values=body;return q;},
    delete(){op='delete';return q;},
    single(){single=true;return run();},
    maybeSingle(){single=true;return run();},
    then(onOk,onErr){return run().then(onOk,onErr);}
  };
  function matches(x){
    return conditions.every(([key,mode,val])=>{
      if(mode==='eq')return String(x[key]||'')===String(val||'');
      return String(x[key]||'').toLowerCase()===String(val||'').toLowerCase();
    });
  }
  async function run(){
    const rows=({clients,athena_medicare_reviews:reviews,documents,medicare_details,health_plans,client_doctors,client_medications,client_pharmacies})[table]||[];
    let found=rows.filter(matches).slice(0,limit);
    if(op==='insert'){
      const newRecord={id:crypto.randomUUID(),created_at:new Date().toISOString(),...values};
      rows.push(newRecord);found=[newRecord];
    }
    if(op==='update'){
      for(const x of found)Object.assign(x,values);
    }
    if(op==='delete'){
      const ids=new Set(found.map(x=>x.id));
      for(let i=rows.length-1;i>=0;i--)if(ids.has(rows[i].id))rows.splice(i,1);
    }
    const data=single?(found[0] ? structuredClone(found[0]):null):structuredClone(found);
    return {data,error:null};
  }
  return q;
}
export const supabase={
  auth:{async getUser(){return {data:{user:{id:OWNER}},error:null}}},
  functions:{async invoke(name,{body}){
    if(name!=='client-sensitive')return {data:{},error:null};
    const current=vault[body.client_id]||{ssn:'',drivers_license_number:'',medicare_number:'',medicaid_number:''};
    if(body.action==='save')vault[body.client_id]={...body.sensitive};
    return {data:{sensitive:body.action==='save'?vault[body.client_id]:current},error:null};
  }},
  storage:{from(){return {
    async upload(path,file){return {data:{path},error:null}},
    async createSignedUrl(path){return {data:{signedUrl:'https://example.invalid/private-file'},error:null}},
    async remove(paths){return {data:paths,error:null}}
  }}},
  from:query
};
export const initialAuthUrl=location.href;
