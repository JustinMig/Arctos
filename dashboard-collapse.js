// Dashboard sections start collapsed and reset after more than three minutes away.
const selectors=[
  ['.daily-work-grid .daily-work-section:first-child','schedule'],
  ['.daily-work-grid .daily-work-section:nth-child(2)','attention'],
  ['[data-dashboard-todo]','todo']
];
const timeout=3*60*1000;
const key='arctos:dashboard:collapsed';
const defaultState=()=>({schedule:true,attention:true,todo:true});
let state=defaultState();
let awaySince=null;
let onDashboard=false;
function onDashboardNow(root){return root.querySelector('.page-heading h1')?.textContent.trim()==='Dashboard'}
function collapseAll(root){
 state=defaultState();
 for(const [selector] of selectors){
  const panel=root.querySelector(selector);
  if(!panel)continue;
  panel.dataset.dashCollapsed='true';
  const button=panel.querySelector('[data-collapse-id]');
  if(button){button.setAttribute('aria-expanded','false');button.textContent='Expand ↓'}
 }
 const calendar=root.querySelector('[data-daily-calendar]');
 if(calendar)calendar.open=false;
}

function installStyle(){
 if(document.querySelector('#arctos-dashboard-collapse-css'))return;
 const s=document.createElement('style');s.id='arctos-dashboard-collapse-css';
 s.textContent=`
 .daily-work-section .dash-collapse-toggle,[data-dashboard-todo] .dash-collapse-toggle{border:1px solid #c1d1da;background:#fff9;color:#24465a;border-radius:8px;padding:7px 11px;min-height:36px;font:inherit;font-size:12px;font-weight:750;cursor:pointer;white-space:nowrap}
 .daily-work-section .dash-collapse-toggle:hover,[data-dashboard-todo] .dash-collapse-toggle:hover{background:#fff}
 .dash-collapse-toggle:focus-visible{outline:3px solid #6ca5cd;outline-offset:2px}
 .daily-work-section[data-dash-collapsed="true"] .daily-work-list,
 .daily-work-section[data-dash-collapsed="true"] .daily-more-action,
 [data-dashboard-todo][data-dash-collapsed="true"] .dashboard-todo-form,
 [data-dashboard-todo][data-dash-collapsed="true"] .dashboard-todo-columns,
 [data-dashboard-todo][data-dash-collapsed="true"] .dashboard-todo-status{display:none!important}
 .daily-work-section[data-dash-collapsed="true"]>header,[data-dashboard-todo][data-dash-collapsed="true"] .dashboard-todo-head{border-bottom:0}
 [data-dashboard-todo] .dashboard-todo-head .dash-collapse-toggle{margin-left:auto}
 .daily-work-section>header .dash-collapse-toggle{margin-left:auto}
 @media(max-width:420px){.daily-work-section>header{flex-wrap:wrap}.daily-work-section>header .dash-collapse-toggle{margin-left:auto}}
 `;
 document.head.append(s);
}
export function installDashboardCollapse(root=document.getElementById('app')){
 if(!root)return;
 installStyle();
 // A fresh application load always starts with every dashboard panel closed.
 onDashboard=onDashboardNow(root);
 const decorate=()=>{
  const current=onDashboardNow(root);
  if(!current){if(onDashboard){onDashboard=false;awaySince=Date.now()}return}
  if(!onDashboard){
   if(awaySince!==null && Date.now()-awaySince>timeout)collapseAll(root);
   onDashboard=true;awaySince=null;
  }
  for(const [selector,id] of selectors){
   const section=root.querySelector(selector);
   if(!section||section.querySelector(':scope > header > [data-collapse-id], :scope > .dashboard-todo-head > [data-collapse-id]'))continue;
   const header=id==='todo'?section.querySelector('.dashboard-todo-head'):section.querySelector(':scope > header');
   if(!header)continue;
   const button=document.createElement('button');
   button.type='button';button.className='dash-collapse-toggle';button.dataset.collapseId=id;
   const collapsed=state[id]!==false;
   section.dataset.dashCollapsed=String(collapsed);
   button.setAttribute('aria-expanded',String(!collapsed));
   button.textContent=collapsed?'Expand ↓':'Collapse ↑';
   header.append(button);
  }
 };
 root.addEventListener('click',event=>{
  const btn=event.target.closest('[data-collapse-id]');
  if(!btn)return;
  const section=btn.closest('.daily-work-section,[data-dashboard-todo]');
  if(!section)return;
  const collapsed=section.dataset.dashCollapsed!=='true';
  section.dataset.dashCollapsed=String(collapsed);
  btn.setAttribute('aria-expanded',String(!collapsed));
  btn.textContent=collapsed?'Expand ↓':'Collapse ↑';
  state[btn.dataset.collapseId]=collapsed;
 });
 let scheduled=false;
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden){awaySince=Date.now();return}
  if(awaySince!==null && Date.now()-awaySince>timeout)collapseAll(root);
  if(onDashboardNow(root))awaySince=null;
 });
 window.addEventListener('focus',()=>{
  if(awaySince!==null && Date.now()-awaySince>timeout)collapseAll(root);
  if(onDashboardNow(root))awaySince=null;
 });
 // When the user stays off the dashboard, measure from the moment they left.
 window.addEventListener('hashchange',()=>queueMicrotask(decorate));
 new MutationObserver(()=>{
  if(scheduled)return;scheduled=true;
  queueMicrotask(()=>{scheduled=false;decorate()});
 }).observe(root,{childList:true,subtree:true});
 decorate();
}
