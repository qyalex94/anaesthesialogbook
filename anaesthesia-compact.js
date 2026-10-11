(() => {
  function choiceControl(key, values, { required = false, hideLabel = false } = {}) {
    const select = $(key), wrapper = $(key + 'Field');
    select.hidden = true; select.required = false;
    if (hideLabel) wrapper.querySelector('label').remove();
    const group = document.createElement('div');
    group.className = 'compact-options'; group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', key === 'urgency' ? 'Urgency' : 'Gender');
    for (const value of values) {
      const label = document.createElement('label');
      label.className = 'compact-choice';
      label.innerHTML = '<input type="radio" name="' + key + 'Choice" value="' + esc(value) + '"' + (required ? ' required' : '') + '><span>' + esc(value) + '</span>';
      label.querySelector('input').addEventListener('change', () => { select.value = value; });
      group.appendChild(label);
    }
    wrapper.appendChild(group);
    return group;
  }

  const urgency = choiceControl('urgency', ['Elective','Emergency','Semi-elective','Daycare','Semi-emergency'], { required:true, hideLabel:true });
  const legacyUrgency = urgency.lastElementChild;
  legacyUrgency.querySelector('span').textContent = 'Semi-emergency (saved)';
  legacyUrgency.hidden = true;
  urgency.addEventListener('change', () => { legacyUrgency.hidden = $('urgency').value !== 'Semi-emergency'; });
  choiceControl('gender', ['Male','Female']);

  const date = $('date'), dateRow = document.createElement('div');
  dateRow.className = 'compact-date';
  const today = document.createElement('button');
  today.type = 'button'; today.className = 'secondary today-button'; today.textContent = 'Today';
  date.before(dateRow); dateRow.append(today, date);
  function updateToday() { today.setAttribute('aria-pressed', String(date.value === localDate())); }
  today.onclick = () => { date.value = localDate(); updateToday(); };
  date.addEventListener('input', updateToday);

  const age = $('age'); age.hidden = true;
  const ageRow = document.createElement('div'); ageRow.className = 'age-picker';
  const amount = document.createElement('select'); amount.id = 'ageAmount'; amount.setAttribute('aria-label','Age number');
  amount.innerHTML = '<option value="">Age…</option>' + Array.from({length:121},(_,value) => '<option value="' + value + '">' + value + '</option>').join('');
  $('ageField').querySelector('label').htmlFor = 'ageAmount';
  const units = document.createElement('div'); units.className = 'age-units'; units.setAttribute('role','group'); units.setAttribute('aria-label','Age unit');
  let selectedUnit = 'years';
  function updateAge() {
    age.value = amount.value === '' ? '' : /^\d+(\.\d+)?$/.test(amount.value) ? amount.value + ' ' + selectedUnit : amount.value;
  }
  function showUnit(unit) {
    selectedUnit = unit;
    for (const button of units.children) button.setAttribute('aria-pressed', String(button.dataset.unit === unit));
  }
  for (const unit of ['years','months','weeks','days']) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.unit = unit;
    button.textContent = unit[0].toUpperCase() + unit.slice(1);
    button.onclick = () => { showUnit(unit); updateAge(); };
    units.appendChild(button);
  }
  amount.onchange = updateAge;
  ageRow.append(amount,units); age.after(ageRow);
  function loadAge() {
    for (const option of amount.querySelectorAll('[data-saved-age]')) option.remove();
    const text = age.value.trim();
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(years?|months?|weeks?|days?)?$/i);
    let value = text, unit = 'years';
    if (match) { value = match[1]; if (match[2]) unit = match[2].toLowerCase().replace(/s?$/, 's'); }
    if (value && !Array.from(amount.options).some(option => option.value === value)) {
      const option = document.createElement('option'); option.value = value; option.textContent = match ? value : 'Saved: ' + text; option.dataset.savedAge = ''; amount.appendChild(option);
    }
    amount.value = value; showUnit(unit);
  }

  $('procedure').placeholder = 'Type an operation or tap a suggestion';
  const suggestions = document.createElement('div'); suggestions.className = 'operation-suggestions'; suggestions.id = 'operation-suggestions';
  suggestions.setAttribute('role','group'); suggestions.setAttribute('aria-label','Suggested operations');
  $('procedure').after(suggestions);
  function renderSuggestions() {
    const discipline = $('specialty').value, query = $('procedure').value.trim().toLowerCase();
    const counts = new Map();
    for (const record of records) {
      if (record.specialty !== discipline || !record.procedure?.trim()) continue;
      const operation = record.procedure.trim(); counts.set(operation,(counts.get(operation) || 0) + 1);
    }
    const choices = [...new Set([...counts.keys()].sort((a,b) => counts.get(b)-counts.get(a)).concat(operationStarters[discipline] || []))]
      .filter(value => !query || (value.toLowerCase().includes(query) && value.toLowerCase() !== query)).slice(0,6);
    suggestions.replaceChildren();
    for (const value of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = value;
      button.onclick = () => { $('procedure').value = value; renderSuggestions(); };
      suggestions.appendChild(button);
    }
    suggestions.hidden = !choices.length;
  }
  $('specialty').addEventListener('change', renderSuggestions);
  $('procedure').addEventListener('input', renderSuggestions);
  $('procedure').addEventListener('focus', renderSuggestions);

  window.compactFormSync = () => {
    for (const key of ['urgency','gender']) for (const input of document.querySelectorAll('input[name="' + key + 'Choice"]')) input.checked = input.value === $(key).value;
    legacyUrgency.hidden = $('urgency').value !== 'Semi-emergency';
    loadAge(); updateToday(); renderSuggestions();window.refreshProcedureQuickChoices?.();
  };
  window.compactFormSync();
  $('management').placeholder = 'Special management for this case';
  $('notes').placeholder = 'one line learning outcome';
})();

(() => {
  const makeChoice = (key,value) => {
    const label=document.createElement('label');label.className='choice';
    const input=document.createElement('input');input.type='checkbox';input.name=key;input.value=value;
    label.append(input,document.createTextNode(value));return label;
  };
  window.clearCompactLegacy=()=>document.querySelectorAll('[data-legacy-choice]').forEach(node=>node.remove());
  window.prepareCompactRecord=record=>{
    window.clearCompactLegacy();
    for(const [key,,type] of fields){
      if(type==='multi'){
        for(const value of record[key]||[])if(!Array.from(document.querySelectorAll('input[name="'+key+'"]')).some(input=>input.value===value)){
          const label=makeChoice(key,value);label.dataset.legacyChoice='';$(key).append(label);
        }
      }else if($(key).tagName==='SELECT'&&record[key]&&!Array.from($(key).options).some(option=>option.value===record[key])){
        const option=new Option(record[key]+' (saved)',record[key]);option.dataset.legacyChoice='';$(key).append(option);
      }
    }
  };
  const rows=[['Hypertension','Diabetes mellitus','Dyslipidemia','CKD','Stroke','Other'],['Ischaemic heart disease','Heart failure','Valvular heart disease','Arrhythmia','Liver disease','Epilepsy'],['Asthma','COPD','OSA','Obesity','Thyroid disease','Bleeding disorder']];
  const labels=Array.from($('comorbidities').children);
  for(const values of rows){const row=document.createElement('div');row.className='comorbidity-row';for(const value of values)row.append(labels.find(label=>label.querySelector('input').value===value));$('comorbidities').append(row);}
  const skills=$('skills'),masterLabels=Array.from(skills.children);
  const quick=document.createElement('div');quick.className='procedure-quick choices';quick.setAttribute('aria-label','Frequently used procedures');
  const caption=document.createElement('div');caption.className='quick-caption';caption.textContent='Frequently used';
  skills.before(caption,quick);
  const all=document.createElement('details'),summary=document.createElement('summary');summary.textContent='All procedures';all.append(summary);skills.append(all);
  for(const [title,options] of procedureGroups){
    const group=document.createElement('div');group.className='procedure-group';const heading=document.createElement('div');heading.className='quick-caption';heading.textContent=title;
    const choices=document.createElement('div');choices.className='choices';
    for(const value of options)choices.append(masterLabels.find(label=>label.querySelector('input').value===value));group.append(heading,choices);all.append(group);
  }
  window.refreshProcedureSelection=()=>{
    const selected=selectedSkills();for(const button of quick.children)button.setAttribute('aria-checked',String(selected.includes(button.dataset.value)));
    summary.textContent='All procedures'+(selected.length?' · '+selected.length+' selected':'');
  };
  window.refreshProcedureQuickChoices=()=>{
    quick.replaceChildren();for(const value of frequentProcedures(records)){
      const button=document.createElement('button');button.type='button';button.className='procedure-shortcut';button.dataset.value=value;button.textContent=value;button.setAttribute('role','checkbox');
      button.onclick=()=>{const input=masterLabels.find(label=>label.querySelector('input').value===value).querySelector('input');input.checked=!input.checked;input.dispatchEvent(new Event('change',{bubbles:true}));};quick.append(button);
    }window.refreshProcedureSelection();
  };
  window.refreshProcedureQuickChoices();conditional();
})();
