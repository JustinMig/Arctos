/**
 * American Amicable Group height/weight underwriting build reference.
 *
 * Transcribed from the six agent guides supplied on 2026-10-22:
 * - Family Choice, PDF p.11 (adult and juvenile)
 * - Intelligent Choice, PDF p.18
 * - Platinum Solution Family/Legacy (same combined guide in two uploads):
 *   Legacy p.17; Family adult p.40 and juvenile p.41
 * - SafeCare Term, PDF pp.15–16
 * - Security Solution, PDF pp.21 and 23
 *
 * All rows contain height in TOTAL INCHES followed by pound limits in
 * the order specified by labels. Values are literal source values;
 * missing heights are not interpolated. Unisex throughout.
 */

const parseRows = str => str.trim().split(/\n/).map(line => line.trim().split(/\s+/).map(value => /^\d+$/.test(value) ? Number(value) : value));
const american = (source, labels, rows, warnings = []) => ({source,labels,rows,warnings});

const expenseAdult = parseRows(`
58 211 212-230 92 87-91
59 218 219-238 94 89-93
60 225 226-246 96 91-95
61 233 234-254 99 94-98
62 241 242-262 101 96-100
63 248 249-271 105 100-104
64 256 257-280 107 102-106
65 264 265-288 110 105-109
66 273 274-297 112 107-111
67 281 282-306 116 111-115
68 289 290-316 119 114-118
69 298 299-325 123 118-122
70 307 308-335 126 121-125
71 315 316-344 131 126-130
72 324 325-354 135 130-134
73 334 335-364 139 134-138
74 343 344-374 142 137-141
75 352 353-384 146 141-145
76 361 362-394 149 144-148
`);

const juvenile = {
  '0-2': american('Juvenile Build Chart, PDF p.11 (Family Choice) or p.41 (Platinum Solution Family).',
     ['Minimum weight','Maximum weight'],parseRows(`
24 8 23
26 10 26
28 13 31
30 15 36
32 18 40
34 21 42
36 23 45
38 26 48
`),['Juvenile chart is an underwriting guide; the carrier reserves discretion by age/build.']),
  '3-9': american('Juvenile Build Chart, PDF p.11 (Family Choice) or p.41 (Platinum Solution Family).',
     ['Minimum weight','Maximum weight'],parseRows(`
30 18 40
34 22 44
38 26 54
42 32 64
46 38 78
50 46 94
54 56 111
58 66 128
`),['Juvenile chart is an underwriting guide; the carrier reserves discretion by age/build.']),
  '10-14': american('Juvenile Build Chart, PDF p.11 (Family Choice) or p.41 (Platinum Solution Family).',
     ['Minimum weight','Maximum weight'],parseRows(`
48 44 92
52 54 108
56 63 126
60 74 144
64 87 166
68 100 186
72 113 206
76 126 228
`),['Juvenile chart is an underwriting guide; the carrier reserves discretion by age/build.']),
  '15-17': american('Juvenile Build Chart, PDF p.11 (Family Choice) or p.41 (Platinum Solution Family).',
     ['Minimum weight','Maximum weight'],parseRows(`
56 74 169
57 76 176
58 79 182
59 82 188
60 84 195
61 87 201
62 90 208
63 93 215
64 96 221
65 99 228
66 102 235
67 105 243
68 109 250
69 112 257
70 115 265
71 118 272
72 122 280
73 125 288
74 129 296
75 132 304
76 136 312
`),['Juvenile chart is an underwriting guide; the carrier reserves discretion by age/build.'])
};
const expenseLabels = [
  'Immediate — maximum weight',
  'Return of Premium — upper-weight band',
  'Immediate — minimum weight',
  'Return of Premium — lower-weight band'
];
const expenseNotes = [
  'The maximum and minimum are separate underwriting bands; do not infer coverage solely from build. Weight above the upper ROP band or below the lower ROP band is a decline per guide.',
  'For Family Choice and Platinum Solution Family, Return of Premium is available only at ages 18–49.'
];
const standard = parseRows(`
58 86 182 199
59 88 188 205
60 90 195 212
61 93 201 220
62 95 208 227
63 99 215 234
64 101 221 242
65 104 228 249
66 106 235 257
67 110 243 265
68 113 250 273
69 117 257 281
70 120 265 289
71 125 272 298
72 129 280 306
73 133 288 315
74 136 296 323
75 140 304 332
76 143 312 341
77 146 320 350
78 149 329 359
`);
const safeStandard = [...standard, ...parseRows(`
79 153 337 368
80 157 346 378
81 160 355 387
`)];
const preferred = parseRows(`
58 92 154
59 94 160
60 96 165
61 99 171
62 101 177
63 105 182
64 107 188
65 110 194
66 112 200
67 116 206
68 119 212
69 123 219
70 126 225
71 131 231
72 135 238
73 139 245
74 142 251
75 146 258
76 149 265
77 152 272
78 155 279
79 158 287
`);
const safePreferred = [...parseRows(`
56 88 144
57 90 149
`),...preferred];
const tableLabels = ['Minimum weight', 'Maximum weight — through Table 2', 'Maximum weight — through Table 4'];
const preferredLabels = ['Preferred — minimum weight','Preferred — maximum weight'];
const tableWarnings = [
  'Build exceeding Table 2 together with a medical condition is not eligible, per source guide.',
  'Below the minimum or above the Table 4 maximum is outside the guide limits.',
  'Table limits are underwriting references, not an approval or an automatic rate decision.'
];
const mkFamily = (source, adult, note) => ({
  adultLabel:'Ages 18–49',
  groups: {
    '0-2': {...juvenile['0-2'],source:source+' — juvenile build chart, '+(source.includes('Platinum')?'PDF p.41':'PDF p.11')},
    '3-9': {...juvenile['3-9'],source:source+' — juvenile build chart, '+(source.includes('Platinum')?'PDF p.41':'PDF p.11')},
    '10-14': {...juvenile['10-14'],source:source+' — juvenile build chart, '+(source.includes('Platinum')?'PDF p.41':'PDF p.11')},
    '15-17': {...juvenile['15-17'],source:source+' — juvenile build chart, '+(source.includes('Platinum')?'PDF p.41':'PDF p.11')},
    '18-49': american(source,expenseLabels,adult,[...expenseNotes,...(note?[note]:[])])
  }
});
const platinumFamilyAdult = expenseAdult.map(row => row[0]===58
  ? [58,211,'221-230',92,'87-91'] : row);
/** Only printed value 221–230 used. Family Choice and Legacy print 212–230
 * at 4′10″: this is a source discrepancy, NOT automatically 'corrected'. */
export const americanAmicablePlans = [
  {key:'family-choice',name:'Family Choice',ages:'0–49',...mkFamily('Family Choice — adult/juvenile Build Charts, PDF p.11',expenseAdult)},
  {key:'intelligent-choice',name:'Intelligent Choice (IUL)',ages:'18–75',
    groups:{'adult':american('Intelligent Choice — Build Chart, PDF p.18',tableLabels,standard,
      [...tableWarnings,'For heights below 4′10″ or above 6′6″ contact the Home Office.'])}},
  {key:'platinum-family',name:'Platinum Solution Family',ages:'0–49',
    ...mkFamily('Platinum Solution Family — Build Charts, PDF pp.40–41',platinumFamilyAdult,
       'SOURCE DISCREPANCY: At 4′10″ the Family table prints upper ROP band 221–230, whereas Family Choice and Platinum Legacy show 212–230. The gap is not inferred; verify with underwriting.')},
  {key:'platinum-legacy',name:'Platinum Solution Legacy',ages:'50–85',
    groups:{'adult':american('Platinum Solution Legacy — Build Chart, PDF p.17',
      ['Preferred / Immediate — maximum weight','Return of Premium — upper-weight band','Preferred / Immediate — minimum weight','Return of Premium — lower-weight band'],
      expenseAdult,['Source labels the standard-weight column Preferred; medical questions also determine Immediate, Graded, or ROP benefit tier.', ...expenseNotes.slice(0,1)])}},
  {key:'safecare-term',name:'SafeCare Term',ages:'18–75 (term-dependent)',
    groups:{
      'standard':american('SafeCare Term — Standard Build Chart, PDF p.15',tableLabels,safeStandard,tableWarnings),
      'preferred':american('SafeCare Term — Preferred Rates Build Chart, PDF p.16',preferredLabels,safePreferred,
        ['Preferred build is necessary but not sufficient for Preferred rates; separate health, tobacco, history and other criteria apply.'])
    }},
  {key:'security-solution',name:'Security Solution (Whole Life)',ages:'18–72',
    groups:{
      'standard':american('Security Solution — Standard Build Chart, PDF p.21',tableLabels,standard,[...tableWarnings,'For heights below 4′10″ or above 6′6″ contact the Home Office.']),
      'preferred':american('Security Solution — Preferred Rates Build Chart, PDF p.23',preferredLabels,preferred,
        ['Preferred build is necessary but not sufficient for Preferred rates; other underwriting criteria apply.','For heights below 4′10″ or above 6′7″ contact the Home Office.'])
    }}
];
const ageBandName = {
  '0-2':'Ages 0–2 (juvenile)', '3-9':'Ages 3–9 (juvenile)', '10-14':'Ages 10–14 (juvenile)',
  '15-17':'Ages 15–17 (juvenile)', '18-49':'Ages 18–49',
  'standard':'Standard / Non-Tobacco & Tobacco',
  'preferred':'Preferred rates'
};
export function listAmericanAmicablePlans() {
  return americanAmicablePlans.map(plan => ({
    key:plan.key,name:plan.name,ages:plan.ages,
    ageGroups:Object.entries(plan.groups).map(([key,group])=>({
      key,label:ageBandName[key]||plan.adultLabel||('Ages '+plan.ages),
      heights:group.rows.map(row=>row[0])
    }))
  }));
}
export function getAmericanAmicableBuild({plan,ageGroup,heightInches}) {
  const found=americanAmicablePlans.find(item=>item.key===plan);
  if(!found)return null;
  const key=ageGroup || (Object.keys(found.groups).length===1 ? Object.keys(found.groups)[0] : null);
  const group=found.groups[key];
  if(!group)return null;
  const row=group.rows.find(row=>row[0]===heightInches);
  if(!row)return null;
  return {plan:found.name,ageGroup:ageBandName[key]||found.adultLabel||('Ages '+found.ages),
    values:group.labels.map((label,i)=>({label,value:row[i+1]+' lb'})),
    source:group.source,warnings:(group.warnings||[]).filter(note=>!note.startsWith('SOURCE DISCREPANCY:') || heightInches===58)};
}
