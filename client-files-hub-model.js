// One read-only index over each client's existing document categories.
// Never move, rename, or silently change the category or policy association.
export const FILE_GROUPS=Object.freeze([
  {key:'all',name:'All Files'},
  {key:'medicare',name:'Medicare & SOA'},
  {key:'life',name:'Life Insurance'},
  {key:'medical',name:'Medical & Pharmacy'},
  {key:'hospital',name:'Hospital Indemnity'},
  {key:'general',name:'General & Other'}
]);
const medicare=new Set(['medicare_card','medicaid_card','health_plan_card','health_plan','health_plan_document','medicare_document','medicare_photo','card_information','soa','scope_of_appointment','medicare','medicaid']);
const life=new Set(['life_policy_document','life_insurance','life_policy']);
const medical=new Set(['medication_document','pharmacy_document','medication_list','medical_document','doctor_document','provider_document']);
const hospital=new Set(['hospital_indemnity','hospital_indemnity_document','hospital_indemnity_plan_document']);
export function fileGroup(category){
 const key=String(category||'').toLowerCase().trim();
 if(medicare.has(key))return'medicare';
 if(life.has(key))return'life';
 if(medical.has(key))return'medical';
 if(hospital.has(key))return'hospital';
 return'general';
}
export const fileCategoryLabel=category=>String(category||'Other').trim().replace(/[_-]+/g,' ').replace(/\b[a-z]/g,c=>c.toUpperCase());
export function fileIndex(records=[],filter='all',search=''){
 const needle=String(search||'').trim().toLowerCase();
 return (Array.isArray(records)?records:[]).filter(record=>
   (filter==='all'||fileGroup(record.category)===filter) &&
   (!needle || [record.file_name,record.category,record.notes].some(value=>String(value||'').toLowerCase().includes(needle)))
 );
}
export function fileGroupCounts(records=[]){
 const counts={all:0,medicare:0,life:0,medical:0,hospital:0,general:0};
 for(const row of (Array.isArray(records)?records:[])){
  counts.all++;
  counts[fileGroup(row.category)]++;
 }
 return counts;
}
