// Source ledger for published, PLAN-YEAR 2027 documents only.
// Confirmed Devoted PDFs were opened from Devoted's individual Mississippi
// 2027 plan pages on 2026-10-13; 3 direct EOC PDFs were reachable.
// For other plans we link the carrier's official *lookup* rather than make
// up an unverified PDF or suggest a 2026 document is for 2027.
export const DEVOTED_2027_DOCS = Object.freeze({
  "H7355-001": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-CHOICE-001-MS-(PPO)-SB-H7355-001-ENG.pdf",
    "eoc": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-CHOICE-001-MS-(PPO)-EOC-H7355-001-ENG.pdf",
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-001-000-2027/"
  },
  "H7355-002": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-CHOICE-GIVEBACK-002-MS-(PPO)-SB-H7355-002-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-002-000-2027/"
  },
  "H7355-003": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-DUAL-CHOICE-PLUS-003-MS-(PPO-D-SNP)-SB-H7355-003-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-003-000-2027/"
  },
  "H7355-004": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-DUAL-CHOICE-004-MS-(PPO-D-SNP)-SB-H7355-004-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-004-000-2027/"
  },
  "H7355-006": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-C-SNP-CHOICE-006-MS-(PPO-C-SNP)-SB-H7355-006-ENG.pdf",
    "eoc": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-C-SNP-CHOICE-006-MS-(PPO-C-SNP)-EOC-H7355-006-ENG.pdf",
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-006-000-2027/"
  },
  "H7355-007": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-C-SNP-CHOICE-ENHANCED-007-MS-(PPO-C-SNP)-SB-H7355-007-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-007-000-2027/"
  },
  "H7355-009": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-DUAL-CHOICE-FULL-009-MS-(PPO-D-SNP)-SB-H7355-009-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-009-000-2027/"
  },
  "H7355-010": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-C-SNP-CHOICE-PLUS-010-MS-(PPO-C-SNP)-SB-H7355-010-ENG.pdf",
    "eoc": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-C-SNP-CHOICE-PLUS-010-MS-(PPO-C-SNP)-EOC-H7355-010-ENG.pdf",
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-010-000-2027/"
  },
  "H7355-011": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-C-SNP-CHOICE-GIVEBACK-EXTRAS-011-MS-(PPO-C-SNP)-SB-H7355-011-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-011-000-2027/"
  },
  "H7355-012": {
    "sb": "https://assets.devoted.com/plan-documents/2027/2027-DEVOTED-CHOICE-GIVEBACK-EXTRAS-012-MS-(PPO)-SB-H7355-012-ENG.pdf",
    "eoc": null,
    "page": "https://www.devoted.com/plan-documents/benefit-and-coverage-details/H7355-012-000-2027/"
  }
});
export const VERIFIED_2027_BENEFITS = Object.freeze({
  "H7355-001": {
    "ambulance": "Ground ambulance: $360 one-way; air ambulance: 20% coinsurance",
    "urgent_care": "Urgent care/walk-in: $50 copay IN/OON",
    "emergency_room": "$130 per visit",
    "transportation": "Not covered"
  },
  "H7355-002": {
    "ambulance": "Ground ambulance: $350 one-way; air ambulance: 20% coinsurance",
    "urgent_care": "Urgent care/walk-in: $40 copay IN/OON",
    "emergency_room": "$115 per visit",
    "transportation": "Not covered"
  },
  "H7355-003": {
    "ambulance": "Ground/air ambulance: $0 IN; OON $0 or 50% coinsurance depending on Medicaid",
    "urgent_care": "Urgent care/walk-in: $0 IN; OON $0 or 30% coinsurance",
    "emergency_room": "$0 IN; OON $0 or $115",
    "transportation": "Not covered",
    "inpatient": "$0 copay/stay IN; $0 or $2,241/stay OON depending on Medicaid assistance",
    "pcp": "$0 IN; $0 or 30% coinsurance OON (Medicaid-dependent)",
    "specialist": "$0 IN; $0 or 30% coinsurance OON (Medicaid-dependent)",
    "medicaid_levels": [
      "QMB",
      "QMB+",
      "SLMB+",
      "FBDE"
    ],
    "medicaid_label": "QMB, QMB+, SLMB+, FBDE"
  },
  "H7355-004": {
    "ambulance": "With Medicaid cost-share assistance: $0 ground/air; without: $360 ground, 20% air",
    "urgent_care": "Urgent care/walk-in: $0 IN with Medicaid assistance; $45 without; OON varies",
    "emergency_room": "$0 with Medicaid cost-share assistance; $130 without",
    "transportation": "Not covered",
    "inpatient": "With Medicaid cost-share assistance: $0/stay IN; without: $305/day days 1–9, $0 after",
    "pcp": "$0 IN; $0 or $5 OON with Medicaid cost-share assistance; $5 OON without",
    "specialist": "With Medicaid cost-share assistance: $0 IN; $0 or $45 OON; without: $45 IN/OON",
    "medical_deductible": "No medical deductible",
    "medicaid_levels": [
      "QMB",
      "QMB+",
      "SLMB",
      "SLMB+",
      "QI",
      "QDWI",
      "FBDE"
    ],
    "medicaid_label": "QMB, QMB+, SLMB, SLMB+, QI, QDWI, FBDE"
  },
  "H7355-006": {
    "ambulance": "Ground ambulance: $360 one-way; air ambulance: 20% coinsurance",
    "urgent_care": "Urgent care/walk-in: $45 copay IN/OON",
    "emergency_room": "$130 per visit",
    "transportation": "Not covered"
  },
  "H7355-007": {
    "ambulance": "Ground ambulance: $360 one-way; air ambulance: 20% coinsurance",
    "urgent_care": "Urgent care/walk-in: $50 copay IN/OON",
    "transportation": "Not covered"
  },
  "H7355-009": {
    "ambulance": "Ground/air ambulance: $0 IN; OON $0 or 50% coinsurance depending on Medicaid",
    "urgent_care": "Urgent care/walk-in: $0 IN; OON $0 or 30% coinsurance",
    "emergency_room": "$0 IN; OON $0 or $115",
    "transportation": "Not covered",
    "medicaid_levels": [
      "QMB+",
      "SLMB+",
      "FBDE"
    ],
    "medicaid_label": "QMB+, SLMB+, FBDE",
    "medical_deductible": "$0–$990 (depends on Medicaid cost-share assistance and network)",
    "drug_deductible": "$700, tiers 3–5 (Extra Help: $0)",
    "medical_moop": "$9,850 IN / $14,800 IN+OON; QMB+/SLMB+/FBDE in-network Medicare cost sharing $0",
    "otc_food_utilities": "$50/quarter OTC; $301/month Food & Home ONLY if chronic-condition/other eligibility requirements are met",
    "dental": "$4,000/year dental allowance; see 2027 SB/EOC for services/cost sharing",
    "vision": "$400/year eyewear allowance",
    "hearing": "Hearing aids: $399 or $699 per aid; check fitting/service terms",
    "inpatient": "$0 copay/stay IN; OON $0 or $2,241/stay (Medicaid-dependent)",
    "pcp": "$0 IN; $0 or 30% coinsurance OON",
    "specialist": "$0 IN; $0 or 30% coinsurance OON"
  },
  "H7355-010": {
    "ambulance": "Ground and air ambulance: 50% coinsurance per one-way trip",
    "urgent_care": "Urgent care/walk-in: 20% coinsurance IN/OON",
    "emergency_room": "$115 per visit",
    "transportation": "Not covered"
  },
  "H7355-011": {
    "ambulance": "Ground ambulance: $355 one-way; air ambulance: 20% coinsurance",
    "urgent_care": "Urgent care/walk-in: $40 copay IN/OON",
    "transportation": "Not covered"
  },
  "H7355-012": {
    "ambulance": "Ground ambulance: $355 one-way; air ambulance: 20% coinsurance",
    "urgent_care": "Urgent care/walk-in: $40 copay IN/OON",
    "emergency_room": "$115 per visit",
    "transportation": "Not covered"
  },
  "H3239-028": {
    "premium": "$0/month",
    "medical_deductible": "$0",
    "medical_moop": "$9,850 IN; beneficiaries with Medicaid paying Medicare medical cost sharing generally owe $0 IN",
    "pcp": "$0 copay (in-network)",
    "specialist": "$0 copay (in-network)",
    "inpatient": "$0 copay per stay IN (90 days per benefit period, plus 60 lifetime reserve days)",
    "ambulance": "$0 copay (ground or air; one-way)",
    "emergency_room": "$0 copay in U.S.",
    "urgent_care": "$0 copay in U.S.",
    "drug_deductible": "$0 with Extra Help/LIS; otherwise $700 for tiers 3–5",
    "rx_oop": "$2,400 annual Part D out-of-pocket threshold",
    "dental": "$3,500/year for covered dental services; $0 copay IN Aetna Dental PPO; no coverage OON dental",
    "vision": "$275/year for eyewear through EyeMed network; $0 annual routine eye exam IN",
    "hearing": "$1,250/ear annual hearing aid allowance at NationsHearing providers; $0 yearly routine hearing exam IN",
    "otc_food_utilities": "$215/month OTC Wallet for approved OTC items; eligible SSBCI chronic-condition members may use SAME $215/month as Extra Supports for approved food/utilities/personal care (not an extra $215). Qualifying High Value PCP participants may receive additional $30/month HVP wallet.",
    "transportation": "36 one-way routine trips/year, up to 60 miles each; $0 copay to plan-approved destinations with authorization",
    "fitness": "Basic SilverSneakers membership included at $0",
    "eligibility": "Aetna Medicare Full Dual Care H3239-028 D-SNP: QMB+, SLMB+, or FBDE Medicaid eligibility plus Medicare A/B and residence in service area.",
    "medicaid_levels": [
      "QMB+",
      "SLMB+",
      "FBDE"
    ],
    "medicaid_label": "QMB+, SLMB+, FBDE"
  }
});

const LOOKUPS = Object.freeze({
  Humana: {
    sb:'https://plandocs.humana.com/medicare-plan-documents',
    eoc:'https://plandocs.humana.com/medicare-plan-documents',
    page:'https://plandocs.humana.com/medicare-plan-documents'
  },
  Aetna: {
    sb:'https://www.aetna.com/medicare/for-members/view-coverage-benefits.html',
    eoc:'https://www.aetna.com/medicare/for-members/view-coverage-benefits.html',
    page:'https://www.aetna.com/medicare/for-members/view-coverage-benefits.html'
  },
  UnitedHealthcare: {
    sb:'https://www.uhc.com/medicare',
    eoc:'https://www.uhc.com/medicare',
    page:'https://www.uhc.com/medicare'
  },
  'Cigna/HealthSpring': {
    sb:'https://www.healthspring.com/medicare/member-resources/plan-documents',
    eoc:'https://www.healthspring.com/medicare/member-resources/eoc',
    page:'https://www.healthspring.com/medicare/member-resources/plan-documents'
  }
});
export const MA_BENEFIT_FIELDS = Object.freeze([
  'premium','part_b_giveback','medical_deductible','medical_moop','pcp','specialist',
  'inpatient','ambulance','emergency_room','urgent_care','drug_deductible','rx_oop',
  'dental','vision','hearing','otc_food_utilities','transportation','fitness'
]);
export function get2027PlanDocuments(plan) {
  const id = String(plan?.plan_number || '').replace(/^(\w\d{4}-\d{3})-\d{3}$/, '$1');
  const devoted = DEVOTED_2027_DOCS[id];
  if (devoted) return {
    sb:devoted.sb, eoc:devoted.eoc || devoted.page,
    page:devoted.page, directSB:true, directEOC:Boolean(devoted.eoc),
    label:'Official 2027 Devoted plan-specific documents'
  };
  // H3239-028 official 2027 SB/EOC were also available in the user's
  // internal source Library, dated 2026-09-18, and checked directly. The
  // public Aetna link remains a landing page, NOT a verified PDF URL.
  // Exact 2027 Aetna member plan pages display both the SB and EOC
  // through Aetna's own dynamic document links; these URLs are not PDFs.
  // Only add IDs whose 2027 document landing page was checked.
  const aetnaPages = new Set(['H3239-028','H5521-553','H5521-218']);
  if (plan?.carrier === 'Aetna' && aetnaPages.has(id)) {
    const [contract, pbp] = id.split('-');
    const page = 'https://www.aetna.com/medicare/plan.' + contract + '.' + pbp + '.html';
    return { sb:page, eoc:page, page, directSB:false, directEOC:false,
      label:'Official Aetna plan-specific 2027 SB and EOC document landing page' };
  }
  const lookup=LOOKUPS[plan?.carrier];
  return lookup ? {
    ...lookup,directSB:false,directEOC:false,
    label:'Carrier document search — select 2027 and plan '+id
  } : {sb:'',eoc:'',page:'',directSB:false,directEOC:false,label:'2027 plan documents not located'};
}
export function applyVerified2027Benefits(plan) {
  const verified=VERIFIED_2027_BENEFITS[plan.plan_number];
  if (!verified) return plan;
  return {...plan,...verified,medicaid_levels:verified.medicaid_levels || plan.medicaid_levels,
    _sb_verified_fields:Object.keys(verified)};
}
export function audit2027Plan(plan) {
  const confirmedSB=VERIFIED_2027_BENEFITS[plan?.plan_number] || {};
  const cms=new Set(plan?._cms_verified_fields || []);
  const missing=MA_BENEFIT_FIELDS.filter(key => {
    const raw=String(plan?.[key] ?? '').trim();
    return !raw || /^(?:N\/A|Not listed|Not available)$/i.test(raw)
      || /verify (?:in|with|2027)|not listed (?:on|in)|not confirmed/i.test(raw);
  });
  return {
    verifiedSBFields:Object.keys(confirmedSB).filter(key=>MA_BENEFIT_FIELDS.includes(key)).length,
    cmsVerifiedFields:cms.size,
    fieldsNeedingReview:missing,
    total:MA_BENEFIT_FIELDS.length
  };
}
