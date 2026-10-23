
/* Applies only explicitly edited Athena fields to the corresponding CRM record.
   No replacement of entire client, doctor, medication, pharmacy or policy collections. */
const CLIENT={first_name:'first_name',last_name:'last_name',dob:'date_of_birth',phone:'phone',email:'email',address:'address1',city:'city',state:'state',zip:'zip_code',county:'county',gender:'gender',veteran:'veteran'};
const MEDICARE={part_a:'part_a_date',part_b:'part_b_date',medicaid_level:'medicaid_level',sunfire_code:'sunfire_code'};
const OLD_PLAN={old_plan_carrier:'old_plan_carrier',old_plan_id:'old_plan_id',old_plan_member_id:'old_plan_member_id',old_plan_year:'old_plan_year'};
const PLAN={current_carrier:'carrier',current_plan:'plan_name',current_plan_id:'plan_id',current_member_id:'member_id',current_plan_type:'plan_type',current_premium:'premium'};
const trim = value=>String(value??'').trim();
const maybe = value=>trim(value)===''?null:value;
async function one(query,label){
  const {data,error}=await query.maybeSingle();
  if(error)throw new Error(label+': '+error.message);
  return data;
}
async function many(query,label){
  const {data,error}=await query;
  if(error)throw new Error(label+': '+error.message);
  return data||[];
}
export async function loadAthenaClientSections(db,id){
  const [client,med,plan,doctors,medications,pharmacy]=await Promise.all([
    one(db.from('clients').select('old_plan_carrier,old_plan_id,old_plan_member_id,old_plan_year').eq('id',id),'Old plan'),
    one(db.from('medicare_details').select('part_a_date,part_b_date,medicaid_level,sunfire_code').eq('client_id',id),'Medicare'),
    one(db.from('health_plans').select('id,carrier,plan_name,plan_id,member_id,plan_type,premium').eq('client_id',id).order('created_at',{ascending:false}).limit(1),'Current plan'),
    many(db.from('client_doctors').select('id,doctor_name,specialty,city,state,notes').eq('client_id',id).order('created_at',{ascending:true}),'Doctors'),
    many(db.from('client_medications').select('id,medication_name,strength,frequency,notes,status').eq('client_id',id).order('created_at',{ascending:true}),'Medications'),
    one(db.from('client_pharmacies').select('pharmacy_name,pharmacy_location,pharmacy_name_2,pharmacy_location_2').eq('client_id',id),'Pharmacies')
  ]);
  const fields={
    part_a:med?.part_a_date||'',part_b:med?.part_b_date||'',medicaid_level:med?.medicaid_level||'',sunfire_code:med?.sunfire_code||'',
    current_carrier:plan?.carrier||'',current_plan:plan?.plan_name||'',current_plan_id:plan?.plan_id||'',
    current_member_id:plan?.member_id||'',current_plan_type:plan?.plan_type||'',current_premium:plan?.premium??'',
    old_plan_carrier:client?.old_plan_carrier||'',old_plan_id:client?.old_plan_id||'',old_plan_member_id:client?.old_plan_member_id||'',old_plan_year:client?.old_plan_year||''
  };
  return {fields,
    doctors:doctors.map(x=>({crm_id:x.id,name:x.doctor_name||'',specialty:x.specialty||'',city:x.city||'',state:x.state||'',network:x.notes||''})),
    medications:medications.filter(x=>x.status!=='inactive').map(x=>({crm_id:x.id,name:x.medication_name||'',strength:x.strength||'',frequency:x.frequency||'',quantity:'',notes:x.notes||''})),
    pharmacies:[
      pharmacy?.pharmacy_name?{name:pharmacy.pharmacy_name,city:pharmacy.pharmacy_location||'',state:'',preferred:''}:null,
      pharmacy?.pharmacy_name_2?{name:pharmacy.pharmacy_name_2,city:pharmacy.pharmacy_location_2||'',state:'',preferred:''}:null
    ].filter(Boolean)
  };
}
export async function syncAthenaClient(db,{clientId,data,edited=[],editedLists=[],editedRows=[],skipped=[],createdClient=false}){
  if(!clientId)throw Error('Select a CRM client before saving.');
  const edits=new Set(edited),lists=new Set(editedLists),rowsEdited=new Set(editedRows),skip=new Set(skipped),updated=[];
  const fields=(map,section,convert=(_k,v)=>maybe(v))=>{
    const out={};
    if(!skip.has(section))for(const [key,col] of Object.entries(map))
      if(edits.has(key))out[col]=convert(key,data[key]);
    return out;
  };
  const oldPlanFields=fields(OLD_PLAN,3);
  const client=fields(CLIENT,1,(key,v)=>{
    const str=trim(v);
    if(['first_name','last_name'].includes(key)){
      if(!str)throw Error('First and last names cannot be blank in the CRM.');
      return str;
    }
    return key==='veteran' ? str==='yes'?true:str==='no'?false:null : maybe(str);
  });
  Object.assign(client,oldPlanFields);
  if(Object.keys(client).length){
    if(!await one(db.from('clients').update(client).eq('id',clientId).select('id'),'Update client'))
      throw Error('The CRM did not allow this client update.');
    updated.push('client information');
  }
  const medicare=fields(MEDICARE,2);
  if(!skip.has(2)&&edits.has('medicaid_status')&&data.medicaid_status==='no')medicare.medicaid_level=null;
  if(Object.keys(medicare).length){
    const prior=await one(db.from('medicare_details').select('client_id').eq('client_id',clientId),'Read Medicare details');
    if(prior){
      if(!await one(db.from('medicare_details').update(medicare).eq('client_id',clientId).select('client_id'),'Update Medicare details'))
        throw Error('The CRM did not allow Medicare updates.');
    }else{
      await one(db.from('medicare_details').insert({client_id:clientId,...medicare}).select('client_id'),'Create Medicare details');
    }
    updated.push('Medicare information');
  }
  // The RECOMMENDED plan is only a proposal: only the current coverage section
  // updates a client's current health plan, and only when deliberately edited.
  const plan=fields(PLAN,3,(key,v)=>key==='current_premium' ? (trim(v)===''?null:Number(v)) : maybe(trim(v)));
  if(Object.keys(plan).length){
    const current=await one(db.from('health_plans').select('id').eq('client_id',clientId).order('created_at',{ascending:false}).limit(1),'Read current plan');
    if(current){
      if(!await one(db.from('health_plans').update(plan).eq('client_id',clientId).eq('id',current.id).select('id'),'Update current plan'))
        throw Error('The CRM did not allow the current plan update.');
    }else if(plan.carrier||plan.plan_name||plan.plan_id){
      await one(db.from('health_plans').insert({client_id:clientId,...plan,status:'active'}).select('id'),'Create current plan');
    }
    updated.push('current coverage');
  }
  // Edit by the CRM row ID where available. New rows get a durable generated
  // ID saved in the Athena review, so resaving will not duplicate them.
  for(const [step,kind,table] of [[4,'doctors','client_doctors'],[5,'medications','client_medications']]){
    if(skip.has(step)||!lists.has(kind))continue;
    for(const item of data[kind]||[]){
      if(!trim(item.name)||!rowsEdited.has(item.crm_id))continue;
      const values=kind==='doctors' ? {
        doctor_name:trim(item.name),specialty:maybe(item.specialty),city:maybe(item.city),
        state:maybe(item.state),notes:maybe(item.network)
      } : {
        medication_name:trim(item.name),strength:maybe(item.strength),
        frequency:maybe(item.frequency),notes:maybe([trim(item.notes),trim(item.quantity)?'Quantity / refill: '+trim(item.quantity):''].filter(Boolean).join('\n')),status:'active'
      };
      if(item.crm_id){
        const existing=await one(db.from(table).select('id').eq('id',item.crm_id).eq('client_id',clientId),'Find linked '+kind);
        if(existing){
          if(!await one(db.from(table).update(values).eq('id',item.crm_id).eq('client_id',clientId).select('id'),'Update '+kind))
            throw Error('The CRM did not allow updating '+kind);
          continue;
        }
      }
      const id=item.crm_id||crypto.randomUUID();item.crm_id=id;
      await one(db.from(table).insert({id,client_id:clientId,...values}).select('id'),'Add '+kind);
    }
    updated.push(kind);
  }
  if(!skip.has(4)&&lists.has('pharmacies')){
    const rows=(data.pharmacies||[]).filter(x=>trim(x.name)).slice(0,2);
    if(rows.length){
      const old=await one(db.from('client_pharmacies').select('client_id').eq('client_id',clientId),'Read pharmacies');
      const payload={};
      if(rows[0]){payload.pharmacy_name=trim(rows[0].name);payload.pharmacy_location=[trim(rows[0].city),trim(rows[0].state)].filter(Boolean).join(', ')||null;}
      if(rows[1]){payload.pharmacy_name_2=trim(rows[1].name);payload.pharmacy_location_2=[trim(rows[1].city),trim(rows[1].state)].filter(Boolean).join(', ')||null;}
      if(old){
        if(!await one(db.from('client_pharmacies').update(payload).eq('client_id',clientId).select('client_id'),'Update pharmacies'))
          throw Error('The CRM did not allow pharmacy updates.');
      }else{
        await one(db.from('client_pharmacies').insert({client_id:clientId,...payload}).select('client_id'),'Add pharmacies');
      }
      updated.push('pharmacies');
    }
  }
  return updated;
}
