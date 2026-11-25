import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('mass text keeps names readable and places the file picker in the message panel',async()=>{
  const dom=new JSDOM('<head><style>body{color:#fff}input,textarea,select{background:#07131c;color:#fff}</style></head><body></body>',{url:'https://crm.test',runScripts:'outside-only'});
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  const agent='8099c3d2-dff1-4a34-8c90-06931f64177e';
  w.supabase={
    auth:{getUser:async()=>({data:{user:{id:agent}}})},
    from(){
      const query={
        select:()=>query,eq:()=>query,order:()=>query,
        single:async()=>({data:{id:agent,active:true,role:'admin'}}),
        then(resolve){resolve({data:[{id:agent,full_name:'Sample Agent'}]});}
      };
      return query;
    }
  };
  w.smsAuthHeaders=async()=>({});
  try{
    for(const filename of ['mass-text-styles.js','text-attachments.js','mass-text.js']){
      let source=await readFile(new URL('../'+filename,import.meta.url),'utf8');
      source=source.replace(/^import .*;\n/gm,'').replace(/export (async )?function/g,'$1function');
      w.eval(source);
    }
    await w.openMassText({clients:[{id:'sample-client',first_name:'Mary',last_name:'Smith',phone:'6625550100',status:'active',assigned_agent_id:agent}]});
    const dialog=w.document.querySelector('dialog');
    const name=dialog.querySelector('.crm-mass-recipient strong');
    assert.equal(name.textContent,'Mary Smith');
    assert.equal(w.getComputedStyle(name).color,'rgb(23, 47, 63)');
    assert.equal(w.getComputedStyle(dialog.querySelector('textarea')).color,'rgb(23, 47, 63)');
    assert.equal(w.getComputedStyle(dialog.querySelector('textarea')).backgroundColor,'rgb(255, 255, 255)');
    const compose=dialog.querySelector('.crm-mass-compose');
    assert(compose.querySelector('input[type=file]'),'attachment input is in the message panel');
    assert.equal(w.getComputedStyle(compose.querySelector('input[type=file]')).display,'block');
    assert.equal(w.getComputedStyle(dialog.querySelector('[data-recipients]')).overflow,'auto');
    assert.equal(w.getComputedStyle(dialog.querySelector('.crm-mass-layout')).display,'grid');
    assert(compose.querySelector('[data-send]'));
  }finally{w.close();}
});
