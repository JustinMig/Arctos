// Collapsible dashboard sections; preserves state during dashboard refreshes.
const selectors=[
  ['.daily-work-grid .daily-work-section:first-child','schedule'],
  ['.daily-work-grid .daily-work-section:nth-child(2)','attention'],
  ['[data-dashboard-todo]','todo']
];
const key='arctos:dashboard:collapsed';
function read(){try{return JSON.parse(sessionStorage.getItem(key)||'{}')||{}}catch{return {}}}
function save(state){try{sessionStorage.setItem(key,JSON.stringify(state))}catch{}}
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
 const decorate=()=>{
  if(root.querySelector('.page-heading h1')?.textContent.trim()!=='Dashboard')return;
  const state=read();
  for(const [selector,id] of selectors){
   const section=root.querySelector(selector);
   if(!section||section.querySelector(':scope > header > [data-collapse-id], :scope > .dashboard-todo-head > [data-collapse-id]'))continue;
   const header=id==='todo'?section.querySelector('.dashboard-todo-head'):section.querySelector(':scope > header');
   if(!header)continue;
   const button=document.createElement('button');
   button.type='button';button.className='dash-collapse-toggle';button.dataset.collapseId=id;
   const collapsed=state[id]===true;
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
  const state=read();state[btn.dataset.collapseId]=collapsed;save(state);
 });
 let scheduled=false;
 new MutationObserver(()=>{
  if(scheduled)return;scheduled=true;
  queueMicrotask(()=>{scheduled=false;decorate()});
 }).observe(root,{childList:true,subtree:true});
 decorate();
}
