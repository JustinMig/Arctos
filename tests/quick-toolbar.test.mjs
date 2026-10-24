import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shell,quickToolbarMarkup,navigationMarkup} from '../views.js';

const contents=file=>readFile(new URL('../'+file,import.meta.url),'utf8');
test('five permanent shortcuts appear in top chrome and not in the More submenu',()=>{
 const toolbar=quickToolbarMarkup();
 const expected=['New Client','Appointments','Notes','Contacts','Height & Weight'];
 assert.deepEqual([...toolbar.matchAll(/aria-label="(New Client|Appointments|Notes|Contacts|Height &amp; Weight)"/g)].map(m=>m[1].replace(/&amp;/g,'&')),expected);
 assert.equal((toolbar.match(/class="quick-tool"/g)||[]).length,5);
 assert.match(toolbar,/data-add-client/);
 for(const key of ['appointments','notes','contacts','build']){
  assert.match(toolbar,new RegExp('data-tool="'+key+'"'));
  const more = navigationMarkup('dashboard').split('id="nav-children-more"')[1];
  assert.doesNotMatch(more,new RegExp('data-tool="'+key+'"'));
 }
 assert.doesNotMatch(toolbar,/data-tool="commissions"/);
 assert.match(navigationMarkup('dashboard'),/data-tool="commissions"/);
 assert.match(shell('dashboard',true,'<p>Home</p>'),/class="quick-tools toolbar-quick-tools"/);
});
test('mobile toolbar is anchored at bottom with sufficient space below CRM content',async()=>{
 const css=await contents('arctos-quick-toolbar.css');
 const imports=await contents('workspace-styles.css');
 assert.match(css,/@media\(max-width:700px\)/);
 assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/\.main\{padding-bottom:calc\(94px/);
 assert.match(imports,/arctos-quick-toolbar\.css/);
});
