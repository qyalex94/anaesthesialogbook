// Each row counts matching entries once, even when multiple matching choices are selected.
const censusArray=value=>Array.isArray(value)?value:value?[value]:[];
const censusHas=(record,key,...values)=>censusArray(record[key]).some(value=>values.includes(value));
const censusPerformed=r=>r.kind!=='anaesthesia'||['Performed','Performed under direct supervision','Performed under indirect supervision','Independent'].includes(r.role);
const censusClinical=r=>['anaesthesia','critical-care','aps-pain'].includes(r.kind)&&censusPerformed(r);
function censusProcedure(r,name){
 if(!censusClinical(r))return false;
 const aliases={'Fibreoptic Intubation':['Fibreoptic intubation'],'Bronchoscopy':['Flexible Bronchoscopy'],'Arterial Line':['Arterial Line insertion','Arterial Line Insertion'],'CVL':['CVL insertion','Central Venous Cannulation']};
 return censusHas(r,'skills',name,...(aliases[name]||[]));
}
function censusRegional(r,name){
 if(!censusClinical(r))return false;
 const skills=censusArray(r.skills),interventions=r.kind==='aps-pain'?censusArray(r.interventions):[];
 const choices=skills.concat(interventions);
 if(name==='Spinal')return choices.some(v=>['SAB','Spinal'].includes(v))||r.technique==='Spinal';
 if(name==='Epidural')return choices.some(v=>['Lumbar Epidural','Thoracic Epidural','Lumbar epidural','Thoracic epidural'].includes(v))||r.technique==='Epidural';
 if(name==='CSE')return choices.includes('CSE')||r.technique==='Combined spinal–epidural';
 if(name==='Caudal')return choices.includes('Caudal');
 return censusHas(r,'peripheralBlocks',name)||interventions.includes(name);
}
function censusSections(rows){
 const ana=r=>r.kind==='anaesthesia',icu=r=>r.kind==='critical-care',pain=r=>r.kind==='aps-pain';
 const make=(label,test)=>({label,test});
 const disciplines=[...new Set(censusOptions.disciplines.concat(rows.filter(ana).map(r=>r.specialty).filter(Boolean)))];
 return [
 {title:'Overview',rows:[make('Anaesthesia cases',ana),make('ICU cases',icu),make('APS & Pain cases',pain),make('CME entries',r=>r.kind==='cme'),make('Duties & Rotation',r=>r.kind==='duties-rotation')]},
 {title:'Anaesthesia',rows:disciplines.map(name=>make(name,r=>ana(r)&&r.specialty===name)).concat(make('All anaesthesia cases',ana))},
 {title:'Regional Anaesthesia',note:'Performed anaesthesia entries, plus regional procedures recorded in ICU and APS & Pain. A case counts once per matching row.',rows:['Spinal','Epidural','CSE','Caudal',...censusOptions.blocks].map(name=>make(name,r=>censusRegional(r,name)))},
 {title:'Procedures',note:'Uses the Anaesthesia Procedures Performed options, including matching ICU procedures. Observed and assisted anaesthesia cases are excluded.',rows:censusOptions.procedures.map(name=>make(name,r=>censusProcedure(r,name)))},
 {title:'ICU',note:'An ICU case can appear in more than one category. The total cases row counts each case once.',rows:censusOptions.icu.map(name=>make(name,r=>icu(r)&&censusHas(r,'census',name))).concat([make('Uncategorised ICU cases',r=>icu(r)&&!censusArray(r.census).length),make('All ICU cases',icu)])},
 {title:'Pain & APS',rows:[make('Labour Epidural',r=>pain(r)&&r.service==='Labour analgesia'&&censusHas(r,'interventions','Lumbar epidural','Thoracic epidural','CSE')),make('Interventional pain procedures',r=>pain(r)&&r.service==='Interventional pain'),make('APS',r=>pain(r)&&r.service==='Acute pain service'),make('Chronic pain clinic',r=>pain(r)&&r.service==='Chronic pain clinic')]}
 ];
}
function censusMonthly(rows,test,year){const months=Array(12).fill(0);for(const row of rows){if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date||''))continue;const y=Number(row.date.slice(0,4)),m=Number(row.date.slice(5,7));if((m===12?y:y-1)!==year||row._conflict)continue;if(test(row))months[m===12?0:m]++;}return months;}
(() => {
 const section=document.getElementById('view-census');const legacy=document.createElement('div');legacy.hidden=true;while(section.firstChild)legacy.append(section.firstChild);section.append(legacy);
 const panel=document.createElement('div');panel.className='monthly-census';panel.innerHTML='<h2>Census</h2><div class="census-toolbar"><label for="census-year">Year</label><select id="census-year"></select></div><p class="census-status" role="status"></p><div class="census-tables"></div>';section.prepend(panel);
 const select=panel.querySelector('select'),tables=panel.querySelector('.census-tables'),status=panel.querySelector('.census-status');const now=new Date(),current=now.getMonth()===11?now.getFullYear():now.getFullYear()-1;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const months=['Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov'];
 function refresh(){
  const data=window.readAllLogbookEntries();const rows=data.rows;const years=[...new Set([current,...rows.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')).map(r=>Number(r.date.slice(0,4))-(r.date.slice(5,7)==='12'?0:1))])].sort((a,b)=>b-a);const chosen=select.value?Number(select.value):current;select.innerHTML=years.map(year=>'<option value="'+year+'">Dec '+year+' – Nov '+(year+1)+'</option>').join('');select.value=years.includes(chosen)?chosen:current;const year=Number(select.value);
  const conflicts=rows.filter(r=>r._conflict).length;status.textContent=(conflicts?' '+conflicts+' conflicting entries excluded until resolved.':'')+(data.errors.length?' Unable to load: '+data.errors.join(', ')+'.':'');
  status.hidden=!status.textContent;
  const overview=[['Anaesthesia','anaesthesia'],['ICU','critical-care'],['APS & Pain','aps-pain'],['CME','cme']];
  const cards='<section class="census-overview"><h3>Overview</h3><div class="census-total-cards">'+overview.map(([label,kind])=>'<div class="census-total-card"><span>'+label+'</span><strong>'+rows.filter(r=>r.kind===kind&&!r._conflict).length+'</strong></div>').join('')+'</div></section>';
  tables.innerHTML=cards+censusSections(rows).slice(1).map((group,index)=>'<section class="census-section tone-'+index+'"><h3>'+escape(group.title)+'</h3>'+(group.note?'<p>'+escape(group.note)+'</p>':'')+'<div class="census-scroll" tabindex="0" role="region" aria-label="'+escape(group.title)+' monthly counts"><table><thead><tr><th scope="col">'+escape(group.title)+'</th>'+months.map(m=>'<th scope="col">'+m+'</th>').join('')+'<th scope="col">Total</th></tr></thead><tbody>'+group.rows.map(row=>{const counts=censusMonthly(rows,row.test,year);return '<tr><th scope="row">'+escape(row.label)+'</th>'+counts.map(v=>'<td>'+v+'</td>').join('')+'<td>'+counts.reduce((a,b)=>a+b,0)+'</td></tr>';}).join('')+'</tbody></table></div></section>').join('');

 }
 const originalTitle=document.title;
 function view(){const active=location.hash==='#census';document.body.classList.toggle('show-monthly-census',active);if(active){document.querySelector('header h1').textContent='Logbook Census';refresh();}else if(location.hash!=='#entries')document.querySelector('header h1').textContent=originalTitle;}
 const priorRender=render;render=function(){priorRender();refresh();};const priorShow=window.logbookNavigation.show;window.logbookNavigation.show=function(...args){priorShow(...args);view();};
 select.onchange=refresh;window.addEventListener('hashchange',view);window.addEventListener('storage',refresh);window.addEventListener('focus',refresh);view();refresh();
})();
