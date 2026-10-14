import { inflateRawSync } from 'node:zlib';
import { requireCrmUser } from '../server/communications.js';

const LANDSCAPE_URL = 'https://www.cms.gov/files/zip/cy2027-landscape-202609-1.zip';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let landscapeCache = null;
let landscapeLoadedAt = 0;

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }

function unzipCsv(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('CMS Landscape ZIP could not be read.');
  const entries = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  const decoder = new TextDecoder();

  for (let index = 0; index < entries; index++) {
    if (u32(view, offset) !== 0x02014b50) throw new Error('CMS Landscape ZIP directory is invalid.');
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const fileNameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const fileName = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    if (/\.csv$/i.test(fileName) && /landscape/i.test(fileName)) {
      if (u32(view, localOffset) !== 0x04034b50) throw new Error('CMS Landscape ZIP entry is invalid.');
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      const raw = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (!raw) throw new Error('CMS Landscape ZIP compression is not supported.');
      return decoder.decode(raw);
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error('CMS Landscape CSV was not found.');
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function columnIndex(headers, candidates) {
  const normalized = headers.map(norm);
  for (const candidate of candidates) {
    const index = normalized.indexOf(norm(candidate));
    if (index >= 0) return index;
  }
  return -1;
}


const amount = value => {
  const raw = String(value ?? '').trim();
  if (!raw || /^(?:n\/a|not applicable|--)$/i.test(raw)) return '';
  const n = Number(raw.replace(/[$,\s]/g,''));
  return Number.isFinite(n) ? n.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:n%1?2:0,maximumFractionDigits:2}) : raw;
};
const val = (row,i) => i < 0 ? '' : String(row[i] ?? '').trim();
const countyKey = value => String(value||'').replace(/\s+county$/i,'').trim().toLowerCase();
function carrierFor(name,organization) {
  const brand = (name+' '+organization).toLowerCase();
  if (/healthspring|cigna/.test(brand)) return 'Cigna/HealthSpring';
  if (/devoted/.test(brand)) return 'Devoted';
  if (/united\s*healthcare|unitedhealth|uhc dual/.test(brand)) return 'UnitedHealthcare';
  if (/humana/.test(brand)) return 'Humana';
  if (/aetna/.test(brand)) return 'Aetna';
  return '';
}
async function loadLandscape() {
  if (landscapeCache && Date.now()-landscapeLoadedAt < CACHE_TTL_MS) return landscapeCache;
  const response = await fetch(LANDSCAPE_URL,{headers:{Accept:'application/zip'},signal:AbortSignal.timeout(25000)});
  if (!response.ok) throw new Error('CMS 2027 Landscape is temporarily unavailable.');
  const rows = parseCsv(unzipCsv(await response.arrayBuffer()));
  const headers = rows.shift() || [];
  if (headers.length) headers[0] = headers[0].replace(/^\uFEFF/,'');
  const get = (...names) => columnIndex(headers,names);
  const c = {
    state:get('State Territory Abbreviation','State Abbreviation','State'),
    county:get('County Name','County'), contract:get('Contract ID','Contract Number'),
    plan:get('Plan ID','Plan Benefit Package ID'), segment:get('Segment ID'),
    name:get('Plan Name','Plan Marketing Name','Marketing Plan Name'),
    org:get('Organization Marketing Name','Organization Name','MA Organization Name'),
    type:get('Plan Type','Health Plan Type','MA Plan Type'),
    category:get('Contract Category Type','Contract Category'),
    snp:get('Special Needs Plan Type','SNP Type'),
    premium:get('Monthly Consolidated Premium (Part C + D)','Monthly Consolidated Premium'),
    partCPremium:get('Part C Premium','Monthly Part C Premium'),
    moop:get('In-Network Maximum Out-of-Pocket (MOOP) Amount','In-Network MOOP Amount','In-Network MOOP'),
    rx:get('Annual Drug Deductible','Annual Prescription Drug Deductible','Drug Deductible','Part D Deductible'),
    giveback:get('Part B Premium Reduction','Monthly Part B Premium Reduction','Part B Giveback')
  };
  if ([c.state,c.county,c.contract,c.plan].some(i=>i<0))
    throw new Error('CMS 2027 Landscape format changed. County availability cannot be verified.');
  const result=[];
  for(const row of rows) {
    const state=val(row,c.state);
    if(state.toUpperCase()!=='MS' && state.toLowerCase()!=='mississippi')continue;
    const contract=val(row,c.contract).toUpperCase();
    if(!/^[HR]\d{4}$/.test(contract))continue;
    const id=val(row,c.plan).padStart(3,'0');
    if(!/^\d{3}$/.test(id))continue;
    const category=val(row,c.category);
    if(/PDP|Prescription Drug Plan/i.test(category) && !/MA-PD/i.test(category))continue;
    const name=val(row,c.name),org=val(row,c.org),type=val(row,c.type),snp=val(row,c.snp);
    const flags=name+' '+type+' '+snp;
    result.push({
      county:val(row,c.county),plan_number:contract+'-'+id,plan_name:name,carrier:carrierFor(name,org),
      plan_type:type,
      is_dsnp:/\bD-?SNP\b|dual.eligible|dual eligible/i.test(flags),
      is_csnp:/\bC-?SNP\b|chronic.condition/i.test(flags),
      premium:amount(val(row,c.premium)) || amount(val(row,c.partCPremium)),
      medical_moop:amount(val(row,c.moop)),drug_deductible:amount(val(row,c.rx)),
      part_b_giveback:amount(val(row,c.giveback)),segment:val(row,c.segment)
    });
  }
  if(!result.length)throw new Error('CMS 2027 Landscape returned no Mississippi Medicare Advantage rows.');
  landscapeCache=result;landscapeLoadedAt=Date.now();return result;
}
export async function GET(request) {
  try {
    await requireCrmUser(request);
    const url=new URL(request.url),county=String(url.searchParams.get('county')||'').trim().replace(/\s+county$/i,'');
    if(!county || county.length>80 || !/^[a-zA-Z .'-]+$/.test(county))
      return Response.json({error:'A valid Mississippi county is required.'},{status:400});
    const rows=await loadLandscape();
    const matches=rows.filter(r=>countyKey(r.county)===countyKey(county));
    if(!matches.length)
      return Response.json({error:'County not found in 2027 CMS Mississippi Landscape.'},{status:404});
    const plans=[...new Set(matches.map(row=>row.plan_number))].sort();
    const entries=new Map();
    for(const r of matches){
      if(!r.carrier)continue;
      const prior=entries.get(r.plan_number);
      if(prior){
        for(const key of ['premium','medical_moop','drug_deductible','part_b_giveback']){
          if(r[key] && prior[key] && prior[key]!==r[key])prior[key]='Varies by segment — verify 2027 SB/EOC';
          else if(!prior[key])prior[key]=r[key];
        }
        continue;
      }
      entries.set(r.plan_number,{
        plan_number:r.plan_number,plan_name:r.plan_name || r.carrier+' ('+r.plan_number+')',
        carrier:r.carrier,plan_type:r.plan_type,is_dsnp:r.is_dsnp,is_csnp:r.is_csnp,
        medicaid_levels:r.is_dsnp?['DUAL_VERIFY']:['NONE'],
        medicaid_label:r.is_dsnp?'Dual eligible — verify exact Medicaid level':r.is_csnp?'Chronic condition eligibility required':'No Medicaid required',
        premium:r.premium,medical_moop:r.medical_moop,drug_deductible:r.drug_deductible,
        part_b_giveback:r.part_b_giveback,service_area:county+' County, Mississippi (CMS 2027)',
        source_note:'CMS CY2027 Landscape (202609.1), county-specific; consult official 2027 SB/EOC for full benefits.'
      });
    }
    return Response.json({
      plan_year:2027,county,plans,entries:[...entries.values()].sort((a,b)=>a.carrier.localeCompare(b.carrier)||a.plan_name.localeCompare(b.plan_name)),
      count:entries.size,source:'CMS CY2027 Landscape (202609.1)',last_verified:'2026-09-30'
    },{headers:{'Cache-Control':'private, max-age=300, stale-while-revalidate=3600'}});
  }catch(error){
    const status=Number(error?.status)||500;
    return Response.json({error:error instanceof Error?error.message:'Unable to load 2027 MA availability.'},{status});
  }
}
