(() => {
  $('learning').rows=1;
  $('diagnosis').placeholder='e.g. Septic shock, ARDS';
  const date=$('date'),row=document.createElement('div'),today=document.createElement('button');
  row.className='icu-date';today.type='button';today.className='secondary';today.textContent='Today';
  date.before(row);row.append(today,date);
  window.icuDateSync=()=>today.setAttribute('aria-pressed',String(date.value===localDate()));
  today.onclick=()=>{date.value=localDate();window.icuDateSync();};date.addEventListener('input',window.icuDateSync);window.icuDateSync();
  window.clearICULegacy=()=>document.querySelectorAll('[data-icu-legacy]').forEach(node=>node.remove());
  window.prepareICURecord=record=>{
    window.clearICULegacy();
    for(const [key,,type] of fields)if(type==='multi')for(const value of record[key]||[]){
      if([...document.querySelectorAll('input[name="'+key+'"]')].some(input=>input.value===value))continue;
      const label=document.createElement('label');label.className='choice';label.dataset.icuLegacy='';
      const input=document.createElement('input');input.type='checkbox';input.name=key;input.value=value;label.append(input,document.createTextNode(value+' (saved)'));$(key).append(label);
    }
  };
})();
