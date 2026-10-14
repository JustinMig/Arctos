import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FILE_GROUPS,fileGroup,fileCategoryLabel,fileIndex,fileGroupCounts} from '../client-files-hub-model.js';

const code=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
test('all original medical, Medicare, life, hospital and general document categories remain visible',()=>{
 const examples=[
  ['medicare_card','medicare'],['medicaid_card','medicare'],['health_plan_card','medicare'],['soa','medicare'],['scope_of_appointment','medicare'],
  ['medicare_document','medicare'],['medicare_photo','medicare'],['health_plan','medicare'],['card_information','medicare'],
  ['life_policy_document','life'],['life_insurance','life'],
  ['medication_document','medical'],['pharmacy_document','medical'],
  ['hospital_indemnity','hospital'],['hospital_indemnity_document','hospital'],
  ['extra_document','general'],['id','general'],['application','general'],['insurance_policy','general'],['lead_photo','general'],
  ['some_future_carrier_category','general']
 ];
 for(const [category,expected]of examples)assert.equal(fileGroup(category),expected,category);
 assert.deepEqual(FILE_GROUPS.map(x=>x.key),['all','medicare','life','medical','hospital','general']);
 assert.equal(fileCategoryLabel('life_policy_document'),'Life Policy Document');
});
test('one file ID is shown once with searchable categories and retained metadata',()=>{
 const docs=[
  {id:'one',category:'soa',file_name:'Scope for Mary.pdf',notes:'Medicare appointment'},
  {id:'two',category:'life_policy_document',file_name:'Policy for Mary.pdf'},
  {id:'three',category:'medication_document',file_name:'Mary medication list.jpg'},
  {id:'four',category:'hospital_indemnity',file_name:'Hospital.pdf'},
  {id:'five',category:'extra_document',file_name:'Application.jpg'}
 ];
 const counts=fileGroupCounts(docs);
 assert.deepEqual(counts,{all:5,medicare:1,life:1,medical:1,hospital:1,general:1});
 assert.deepEqual(fileIndex(docs,'all','mary').map(x=>x.id),['one','two','three']);
 assert.deepEqual(fileIndex(docs,'life','').map(x=>x.id),['two']);
 assert.deepEqual(fileIndex(docs,'medicare','appointment').map(x=>x.id),['one']);
 assert.equal(fileIndex(docs,'general','missing').length,0);
 assert.equal(docs[0].category,'soa','Original database category is never changed');
});
test('unified file hub uses the secured existing documents and client_notes tables without copying records',async()=>{
 const source=await code('client-files-hub.js');
 assert.match(source,/\.from\('documents'\)/);
 assert.match(source,/\.eq\('client_id',id\)/);
 assert.match(source,/\.from\('client_notes'\)/);
 assert.match(source,/\.eq\('client_id',clientId\)/);
 assert.match(source,/createSignedUrl\(record.storage_path,120\)/);
 assert.match(source,/\.from\(BUCKET\)/);
 assert.doesNotMatch(source,/\.from\('documents'\)\.insert|\.from\('documents'\)\.delete|storage\.from\(BUCKET\)\.upload/);
 assert.match(source,/MAX_ROWS=4000/);
 assert.match(source,/data-cfh-jump="medicare"/);
 assert.match(source,/data-cfh-jump="life"/);
 assert.match(source,/data-cfh-note-save/);
 assert.match(source,/data-cfh-delete-note/);
 const ext=await code('workspace-extensions.js');
 assert.match(ext,/import '\.\/client-files-hub.js\?v=arctos-files-1'/);
 assert.match(ext,/import '\.\/client-notes-extras.js\?v=arctos-files-1'/);
 const legacy=await code('client-notes-extras.js');
 assert.match(legacy,/cfh-general-uploader/);
 assert.match(legacy,/data-extras-files/);
 assert.match(legacy,/arctos:client-file-change/);
});
