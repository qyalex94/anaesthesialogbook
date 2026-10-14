(() => {
  const categories = [
    {id:'anaesthesia',label:'Anaesthesia',file:'anaesthesia.html',legacy:'anaesthesia-case-logbook-v1'},
    {id:'critical-care',label:'ICU',file:'critical-care.html',legacy:'critical-care-case-logbook-v1'},
    {id:'aps-pain',label:'APS & Pain',file:'aps-pain.html',legacy:'aps-pain-logbook-v1'},
    {id:'cme',label:'CME',file:'cme.html',legacy:'cme-logbook-v1'},
    {id:'duties-rotation',label:'Duties & Rotation',file:'duties-rotation.html',legacy:'duties-rotation-logbook-v1'}
  ];
  const section=document.getElementById('view-entries');
  const oldPanel=section.firstElementChild;oldPanel.hidden=true;
  const panel=document.createElement('section');panel.className='panel unified-entries';
  panel.innerHTML='<h2>Entries</h2><label class="entries-search-label" for="entries-search">Search all entries</label><input id="entries-search" type="search" placeholder="Search operation, diagnosis, ID or notes…"><div class="entries-filters" role="group" aria-label="Entry category"></div><p class="entries-count" role="status" aria-live="polite"></p><div class="entries-list"></div>';
  section.prepend(panel);
  const search=panel.querySelector('input'),filters=panel.querySelector('.entries-filters'),list=panel.querySelector('.entries-list'),count=panel.querySelector('.entries-count');
  let category='all';
  const returnStateKey='logbook-entries-return';
  let returnState=null;
  if(new URLSearchParams(location.search).has('entry')){
    try{returnState=JSON.parse(sessionStorage.getItem(returnStateKey));}catch{}
    if(returnState){
      search.value=typeof returnState.search==='string'?returnState.search:'';
      category=['all',...categories.map(item=>item.id)].includes(returnState.category)?returnState.category:'all';
    }
  }
  const back=document.createElement('button');
  back.type='button';back.className='entry-back';back.hidden=true;
  back.setAttribute('aria-label','Back to Entries');back.title='Back to Entries';
  back.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg>';
  document.getElementById('view-log').prepend(back);
  back.onclick=()=>{
    window.logbookNavigation.show('entries');
    requestAnimationFrame(()=>window.scrollTo({top:Number(returnState?.scroll)||0,behavior:'instant'}));
    search.focus({preventScroll:true});
  };
  list.addEventListener('click',event=>{
    if(!event.target.closest('.entry-edit'))return;
    returnState={search:search.value,category,scroll:window.scrollY};
    try{sessionStorage.setItem(returnStateKey,JSON.stringify(returnState));}catch{}
  });
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  for(const item of [{id:'all',label:'All'},...categories.slice(0,4)]){
    const button=document.createElement('button');button.type='button';button.textContent=item.label;button.dataset.category=item.id;button.setAttribute('aria-pressed',String(item.id===category));
    button.onclick=()=>{category=item.id;refresh();};filters.append(button);
  }
  function readEntries(source){
    const raw=localStorage.getItem(source.id+'-logbook-sync-v2');
    if(!raw){const legacy=JSON.parse(localStorage.getItem(source.legacy)||'[]');if(!Array.isArray(legacy))throw Error('Invalid entries');return legacy;}
    const state=JSON.parse(raw);if(state.version!==2||!Array.isArray(state.events))throw Error('Invalid history');
    const superseded=new Set(state.events.flatMap(event=>event.parents));const groups=new Map();
    for(const event of state.events)if(!superseded.has(event.id)){if(!groups.has(event.caseId))groups.set(event.caseId,[]);groups.get(event.caseId).push(event);}
    return [...groups.values()].flatMap(heads=>{const live=heads.filter(event=>!event.deleted).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));return live.length?[{...live[0].record,_conflict:heads.length>1}]:[];});
  }
  window.readAllLogbookEntries=()=>{const rows=[],errors=[];for(const source of categories){try{rows.push(...readEntries(source).map(record=>({...record,kind:source.id})));}catch{errors.push(source.label);}}return {rows,errors};};
  function refresh(){
    const rows=[],failed=[];
    for(const source of categories){try{rows.push(...readEntries(source).map(record=>({source,record})));}catch{failed.push(source.label);}}
    const query=search.value.trim().toLowerCase();
    const visible=rows.filter(({source,record})=>(category==='all'||source.id===category)&&Object.entries(record).filter(([key])=>!key.startsWith('_')&&!['id','attachments','createdAt','updatedAt'].includes(key)).some(([,value])=>String(value??'').toLowerCase().includes(query))).sort((a,b)=>String(b.record.date||'').localeCompare(String(a.record.date||''))||String(b.record.updatedAt||'').localeCompare(String(a.record.updatedAt||'')));
    for(const button of filters.children)button.setAttribute('aria-pressed',String(button.dataset.category===category));
    count.textContent=visible.length+' '+(visible.length===1?'entry':'entries')+(failed.length?' · Unable to load '+failed.join(', ')+'. Please refresh.':'');
    list.innerHTML=visible.map(({source,record:r})=>{
      const title=r.procedure||r.diagnosis||r.title||r.duty||'Untitled entry';
      const secondary=[r.procedure&&r.diagnosis,r.rn&&'ID: '+r.rn,r.specialty||r.discipline||r.service||r.activity||r.rotation].filter(Boolean);
      const notes=[r.management,r.notes,r.learning,r.treatment,r.dutyOther].filter(value=>typeof value==='string'&&value.trim()).join(' · ');
      const target=source.file+'?entry='+encodeURIComponent(r.id);
      return '<article class="entry-card"><div class="entry-meta"><span class="entry-category" data-category="'+source.id+'">'+source.label+'</span><time>'+escape(String(r.date||'').split('-').reverse().join('/'))+'</time>'+(r._conflict?'<span class="tag">Sync conflict</span>':'')+'</div><h3>'+escape(title)+'</h3>'+(secondary.length?'<p>'+secondary.map(escape).join(' · ')+'</p>':'')+(notes?'<p class="entry-notes">'+escape(notes)+'</p>':'')+'<div class="actions"><a class="entry-edit" href="'+escape(target+'&entryAction=edit#log')+'">View / edit</a><a class="entry-delete" href="'+escape(target+'&entryAction=delete#entries')+'">Delete</a></div></article>';
    }).join('')||'<div class="empty">'+(query?'No entries match your search.':category==='all'?'No entries recorded yet.':'No entries in this category yet.')+'</div>';
  }
  const title=document.querySelector('header h1'),originalTitle=title.textContent;
  function updateView(){const active=location.hash==='#entries';document.body.classList.toggle('show-unified-entries',active);title.textContent=active?'Logbook Entries':originalTitle;back.hidden=editing===null;refresh();}
  function openRequestedEntry(){
    const params=new URLSearchParams(location.search),id=params.get('entry');if(!id)return;
    const action=params.get('entryAction')==='delete'?'delete':'edit';
    const button=[...document.querySelectorAll('#cases [data-'+action+']')].find(node=>node.dataset[action]===id);
    if(!button)return;
    params.delete('entry');params.delete('entryAction');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);button.click();updateView();
    if(action==='edit')requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));
  }
  const originalRender=render;render=function(){originalRender();refresh();openRequestedEntry();};
  const originalReset=reset;reset=function(...args){originalReset(...args);back.hidden=true;};
  search.addEventListener('input',refresh);window.addEventListener('storage',refresh);window.addEventListener('focus',refresh);window.addEventListener('hashchange',updateView);
  const originalShow=window.logbookNavigation.show;window.logbookNavigation.show=function(...args){originalShow(...args);updateView();};
  updateView();openRequestedEntry();
})();
