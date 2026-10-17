import { supabase } from './supabase-repository.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const styles = `
.dashboard-todo{margin:16px 0;border:1.5px solid #b9cbd5;border-radius:14px;background:#fff;overflow:hidden;color:#223746}
.dashboard-todo-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:15px 17px;background:#e3edf1;border-bottom:1px solid #bdcdd5}
.dashboard-todo-head strong{font-size:17px}.dashboard-todo-head small{font-size:12px;color:#526a77}
.dashboard-todo-form{display:flex;gap:9px;padding:13px 15px;flex-wrap:wrap}
.dashboard-todo-form input{flex:1 1 200px;min-width:0;min-height:43px;padding:10px 12px;font-size:16px;border:1px solid #a8b8c3;border-radius:8px;color:#223746;background:#fff}
.dashboard-todo-form button{min-height:43px;padding:8px 15px;border:1px solid #30586c;border-radius:8px;background:#345e72;color:white;font-weight:700;cursor:pointer}
.dashboard-todo-columns{display:grid;grid-template-columns:1fr 1fr;gap:13px;padding:0 15px 15px}
.dashboard-todo-column{min-width:0;border:1px solid #d3dfe4;border-radius:10px;overflow:hidden;background:#f9fbfc}
.dashboard-todo-column h3{margin:0;padding:11px 13px;background:#e8f0f4;font-size:14px;color:#243c4a}
.dashboard-todo-column.done h3{background:#e2ede4}
.dashboard-todo-list{display:grid;align-content:start;min-height:64px}
.dashboard-todo-row{display:flex;align-items:center;gap:10px;padding:11px 10px;border-top:1px solid #e4eaed;background:#fff}
.dashboard-todo-row:first-child{border-top:0}
.dashboard-todo-row label{display:flex;align-items:center;gap:9px;min-width:0;flex:1;font-size:13px;line-height:1.5}
.dashboard-todo-row label span{min-width:0;overflow-wrap:anywhere}
.dashboard-todo-row input{width:18px;height:18px;flex:0 0 18px;accent-color:#427a68;cursor:pointer}
.dashboard-todo-column.done .dashboard-todo-row label span{text-decoration:line-through;color:#637b75}
.dashboard-todo-delete{border:1px solid #dec9ca;color:#8c3c45;background:#fbf3f3;border-radius:7px;padding:6px 9px;font-size:12px;cursor:pointer;min-height:35px}
.dashboard-todo-empty{padding:14px;color:#697d88;font-size:13px;margin:0}
.dashboard-todo-status{padding:0 15px 11px;font-size:12px;color:#526c79}
@media(max-width:600px){.dashboard-todo-columns{grid-template-columns:1fr}.dashboard-todo-head{padding:12px}.dashboard-todo-form{padding:10px}.dashboard-todo-columns{padding:0 10px 10px}}
`;
let insertedStyle=false;
function installStyles(){
 if(insertedStyle || document.querySelector('[data-dashboard-todo-style]')) return;
 const style=document.createElement('style');style.dataset.dashboardTodoStyle='';style.textContent=styles;document.head.append(style);insertedStyle=true;
}
function markup(){
 return '<section class="dashboard-todo" data-dashboard-todo><div class="dashboard-todo-head"><strong>To-Do List</strong><small>Personal dashboard tasks</small></div>'+
 '<form class="dashboard-todo-form" data-todo-form><input name="description" maxlength="500" placeholder="Add something you need to do…" aria-label="New to-do item" required><button type="submit">+ Add</button></form>'+
 '<div class="dashboard-todo-columns"><section class="dashboard-todo-column"><h3>Need to Do <span data-todo-count="need">0</span></h3><div class="dashboard-todo-list" data-todo-list="need"></div></section>'+
 '<section class="dashboard-todo-column done"><h3>Done <span data-todo-count="done">0</span></h3><div class="dashboard-todo-list" data-todo-list="done"></div></section></div><div class="dashboard-todo-status" data-todo-status role="status"></div></section>';
}
const rowMarkup=item=>'<div class="dashboard-todo-row"><label><input type="checkbox" data-todo-toggle="'+escapeHtml(item.id)+'"'+(item.is_done?' checked':'')+' aria-label="Mark '+(item.is_done?'not done':'done')+'"><span>'+escapeHtml(item.description)+'</span></label><button type="button" class="dashboard-todo-delete" data-todo-delete="'+escapeHtml(item.id)+'" aria-label="Delete task">Delete</button></div>';
async function init(widget){
 const {data:{user},error:userError}=await supabase.auth.getUser();
 if(userError || !user){widget.querySelector('[data-todo-status]').textContent='Sign in to manage your tasks.';return;}
 let items=[];
 const status=message=>widget.querySelector('[data-todo-status]').textContent=message||'';
 const draw=()=>{
  for(const kind of ['need','done']){
   const rows=items.filter(item=>item.is_done===(kind==='done'));
   widget.querySelector('[data-todo-count="'+kind+'"]').textContent=rows.length;
   widget.querySelector('[data-todo-list="'+kind+'"]').innerHTML=rows.length?rows.map(rowMarkup).join(''):'<p class="dashboard-todo-empty">'+(kind==='done'?'No completed tasks yet.':'Nothing pending.')+'</p>';
  }
 };
 const load=async()=>{
  const {data,error}=await supabase.from('dashboard_todos').select('id,description,is_done,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(300);
  if(error){status('Unable to load tasks: '+error.message);return;} items=data||[];draw();status('');
 };
 let busy=false;
 widget.querySelector('[data-todo-form]').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const input=event.currentTarget.elements.namedItem('description');const description=input.value.trim();if(!description)return;
  busy=true;status('Saving…');
  const {error}=await supabase.from('dashboard_todos').insert({user_id:user.id,description});
  busy=false;if(error){status('Could not add task: '+error.message);return;}input.value='';await load();input.focus();
 });
 widget.addEventListener('click',async event=>{
  const button=event.target.closest('[data-todo-delete]');
  if(!button||busy)return;
  const id=button.dataset.todoDelete;busy=true;status('Deleting…');
  const {error}=await supabase.from('dashboard_todos').delete().eq('id',id).eq('user_id',user.id);
  busy=false;if(error){status('Could not delete task: '+error.message);return;}await load();
 });
 widget.addEventListener('change',async event=>{
  const checkbox=event.target.closest('[data-todo-toggle]');
  if(!checkbox||busy)return;
  const id=checkbox.dataset.todoToggle;const checked=checkbox.checked;busy=true;status('Updating…');
  const {error}=await supabase.from('dashboard_todos').update({is_done:checked,completed_at:checked?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id);
  busy=false;if(error){status('Could not update task: '+error.message);checkbox.checked=!checked;return;}await load();
 });
 await load();
}
function mount(){
 const app=document.getElementById('app');if(!app)return;
 const heading=app.querySelector('.page-heading h1');if(heading?.textContent.trim()!=='Dashboard')return;
 const content=app.querySelector('.content');if(!content||content.querySelector('[data-dashboard-todo]'))return;
 installStyles();
 const node=document.createElement('div');node.innerHTML=markup();const widget=node.firstElementChild;
 // Keep the To-Do List as the last section on the Dashboard.
 content.append(widget);
 void init(widget);
}
export function installDashboardTodo(root=document.getElementById('app')){
 if(!root)return;
 mount();
 new MutationObserver(changes=>{
  if(changes.some(change=>[...change.addedNodes].some(node=>node instanceof Element&&(node.matches?.('.page-heading,#calendar-host')||node.querySelector?.('.page-heading,#calendar-host')))))queueMicrotask(mount);
 }).observe(root,{childList:true,subtree:true});
 window.addEventListener('hashchange',()=>queueMicrotask(mount));
}
