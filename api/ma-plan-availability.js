import { requireCrmUser } from '../server/communications.js';
import { getMississippi2027Landscape } from '../server/ma-cms-2027-ms-snapshot.js';

// Plan availability and basic prices come from the official CY2027 CMS
// Mississippi Landscape. A prevalidated local snapshot replaces the former
// 77 MB national CSV download + parser that used >1 GB RAM on cold starts.
// Benefits absent from the CMS Landscape must be verified using the 2027 SB/EOC.
const normalizedCounty = value => String(value || '').trim()
  .replace(/\s+county$/i, '').toLowerCase();

function planForSegment(segment, county) {
  const isDsnp = segment.is_dsnp === true;
  const isCsnp = segment.is_csnp === true;
  const isIsnp = segment.is_isnp === true;
  return {
    plan_number: segment.plan_number,
    display_plan_id: segment.display_plan_id,
    segment: segment.segment,
    plan_name: segment.plan_name,
    carrier: segment.carrier,
    plan_type: segment.plan_type,
    is_dsnp: isDsnp,
    is_csnp: isCsnp,
    is_isnp: isIsnp,
    snp_type: segment.snp_type,
    cms_category: segment.cms_category,
    medicaid_levels: isDsnp ? ['DUAL_VERIFY'] : ['NONE'],
    medicaid_label: isDsnp
      ? 'D-SNP: exact Medicaid levels must be verified against 2027 SB/EOC'
      : isCsnp ? 'C-SNP: qualifying chronic condition required'
      : isIsnp ? 'I-SNP: qualifying institutional status required'
      : 'No special Medicaid requirement',
    premium: segment.premium || 'Verify monthly premium with carrier',
    medical_moop: segment.medical_moop || 'Verify 2027 MOOP with carrier',
    drug_deductible: segment.drug_deductible || (segment.part_d ? 'Verify plan Part D deductible' : 'No Part D included'),
    rx_oop: segment.rx_oop || (segment.part_d ? 'Verify 2027 Part D maximum' : 'No Part D included'),
    part_d: segment.part_d === true,
    overall_star_rating: segment.overall_star_rating || '',
    zero_dollar_cost_sharing_dsnp: segment.zero_dollar_cost_sharing_dsnp || '',
    dsnp_integration: segment.dsnp_integration || '',
    service_area: county + ' County, Mississippi',
    _cms_verified_fields: ['premium','medical_moop','drug_deductible','rx_oop',
      'part_d','overall_star_rating'].filter(field => Boolean(segment[field])),
    source_note: 'Official CMS CY2027 Landscape (202609.1), segment-specific for this county. '
      + 'Final enrollment, provider network and extra benefits must be confirmed in official 2027 carrier SB/EOC.'
  };
}
export async function GET(request) {
  try {
    await requireCrmUser(request);
    const url = new URL(request.url);
    const rawCounty = String(url.searchParams.get('county') || '').trim();
    const normalized = normalizedCounty(rawCounty);
    if (!normalized || rawCounty.length > 80 || !/^[a-z .'-]+$/i.test(normalized))
      return Response.json({error:'A valid Mississippi county is required.'},{status:400});
    const data = getMississippi2027Landscape();
    const county = Object.keys(data.counties).find(name => normalizedCounty(name) === normalized);
    if (!county) return Response.json({
      error:'That county does not exist in the 2027 Mississippi plan data.'
    },{status:404});
    const segments = data.counties[county].map(key => data.segments[key]);
    if (segments.some(row => !row || !row.plan_number || !row.display_plan_id))
      throw new Error('CMS source record is incomplete; county plan list cannot be shown safely.');
    const entries = segments.map(plan => planForSegment(plan,county))
      .sort((a,b) => a.carrier.localeCompare(b.carrier)
        || a.plan_name.localeCompare(b.plan_name)
        || a.display_plan_id.localeCompare(b.display_plan_id));
    return Response.json({
      plan_year:data.source.year,
      county,
      plans:[...new Set(entries.map(plan=>plan.plan_number))].sort(),
      entries,
      count:entries.length,
      source:'CMS CY2027 Landscape ('+data.source.release+')',
      source_updated:data.source.updated,
      retrieved:data.source.retrieved
    },{
      headers:{'Cache-Control':'private, max-age=300'}
    });
  } catch(error) {
    const status=Number(error?.status) || 500;
    return Response.json({
      error:error instanceof Error ? error.message : 'Unable to retrieve 2027 Mississippi plan availability.'
    },{status});
  }
}
