const fields = config.fields;
const SYNC_KEY = config.slug + '-logbook-sync-v2';
const LEGACY_KEY = config.slug + '-logbook-v1';
const APP_MARKER = config.slug + '-logbook-v2';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records = [], editing = null, attachmentDB;

function localDate(date = new Date()) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function normalise(record) {
  record = {...record};
  if(config.quickGroups)record.duty=({'Elective OT in-charge — SMO':'Elective OT in-charge — Registrar','On-call — SMO':'On-call — Registrar'})[record.duty]||record.duty;
  const result = {...record, attachments: record.attachments || []};
  for (const [key,,type] of fields) result[key] = type === 'multi' ? (Array.isArray(record[key]) ? record[key] : []) : String(record[key] ?? '');
  return result;
}

function readForm() {
  const data = Object.fromEntries(new FormData($('form')));
  for (const [key,,type] of fields) if (type === 'multi') {
    data[key] = [...document.querySelectorAll(`input[name="${key}"]:checked`)].map(input => input.value);
  }
  return normalise(data);
}

function isDraft(record) {
  return (config.draftKeys || []).some(key => !String(record[key] || '').trim());
}

function updateDutyOther() {
  if (!config.quickGroups || !$('dutyOther')) return;
  const show = $('duty').value === 'On-call — Others';
  $('dutyOtherField').hidden = !show; $('dutyOther').disabled = !show; $('dutyOther').required = show;
}

function updateDraftHint() {
  updateDutyOther();
  $('draft-hint').textContent = config.draftKeys
    ? (isDraft(readForm()) ? 'You can save a draft now and complete the patient ID, service, diagnosis and learning notes later.' : 'Ready to save.')
    : '';
}

function buildForm() {
  for (const [key,label,type,section,required,options = [],defaultValue] of fields) {
    const wrapper = document.createElement('div');
    wrapper.id = key + 'Field';
    if (type === 'radio' || type === 'multi') {
      wrapper.className = 'wide';
      const group = document.createElement('fieldset');
      group.className = 'option-group';
      group.innerHTML = '<legend>' + esc(label) + '</legend><div class="option-chips">' + options.map((option,index) =>
        '<label class="option-chip"><input type="' + (type === 'radio' ? 'radio' : 'checkbox') + '" id="' + key + index + '" name="' + key + '" value="' + esc(option) + '"' + (required && type === 'radio' ? ' required' : '') + (option === defaultValue ? ' checked' : '') + '><span>' + esc(option) + '</span></label>'
      ).join('') + '</div>';
      wrapper.appendChild(group);
    } else {
      wrapper.innerHTML = '<label for="' + key + '">' + esc(label) + '</label>';
      const input = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
      input.name = key; input.id = key; input.required = required;
      if (type === 'select') {
        input.innerHTML = '<option value="">Select…</option>' + options.map(option => '<option>' + esc(option) + '</option>').join('');
      } else if (type !== 'textarea') input.type = type;
      if (type === 'text' || type === 'textarea') input.maxLength = type === 'textarea' ? 3000 : 300;
      if (key === 'date') input.value = localDate();
      if (config.slug === 'cme' && key === 'title') { wrapper.classList.add('wide','primary-entry'); input.placeholder='Enter the session title and place'; }
      if (config.slug === 'aps-pain' && key === 'place') input.placeholder='e.g. Labour room, ward, emergency department';
      if (config.slug === 'aps-pain' && key === 'learning') wrapper.classList.add('wide');
      if (key === 'rotation') input.placeholder = 'e.g. General anaesthesia, ICU, obstetrics';
      if (key === 'learning') input.placeholder = 'Optional now — add your reflection later';
      wrapper.appendChild(input);
      if (key === 'date') {
        const shortcuts = document.createElement('div');
        shortcuts.className = 'date-shortcuts';
        for (const [label,offset] of [['Today',0],['Yesterday',-1]]) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'secondary'; button.textContent = label;
          button.onclick = () => { const date = new Date(); date.setDate(date.getDate() + offset); input.value = localDate(date); renderDutyCounts(); };
          shortcuts.appendChild(button);
        }
        wrapper.appendChild(shortcuts);
      }
    }
    $(section).appendChild(wrapper);
  }
  if (config.quickGroups) {
    $('quick-duties').innerHTML = '<p class="muted">One tap logs one duty for the selected date and rotation. <span id="duty-month-label"></span></p>' + config.quickGroups.map(([group,items]) =>
      '<div class="duty-group"><h4>' + esc(group) + '</h4><div class="duty-buttons">' + items.map(([label,duty]) => '<button type="button" class="secondary duty-button" data-duty="' + esc(duty) + '"><span>' + esc(label) + '</span><span class="duty-count">0</span></button>').join('') + '</div></div>'
    ).join('');
    $('dutyField').hidden = true;
    $('save').hidden = true;
    $('duty').required = false;
    $('quick-duties').onclick = async event => {
      const button = event.target.closest('[data-duty]');
      if (!button || button.disabled) return;
      $('duty').value = button.dataset.duty;
      updateDutyOther();
      if ($('duty').value === 'On-call — Others') { $('save').hidden=false; $('dutyOther').focus(); return; }
      $('save').hidden=true;
      await saveEntry({quick: true});
    };
    $('date').addEventListener('input', renderDutyCounts);
  }
  updateDraftHint();
  $('form').addEventListener('input', updateDraftHint);
}

function filtered() {
  const query = $('search').value.toLowerCase();
  return records.filter(record => (!$('from').value || record.date >= $('from').value) && (!$('to').value || record.date <= $('to').value) && fields.some(([key]) => String(record[key] || '').toLowerCase().includes(query)));
}

function renderDutyCounts() {
  if (!config.quickGroups) return;
  const month = ($('date').value || localDate()).slice(0,7);
  $('duty-month-label').textContent = 'Counts are for ' + new Date(month + '-01T12:00:00').toLocaleDateString(undefined, {month:'long',year:'numeric'}) + '.';
  for (const button of document.querySelectorAll('[data-duty]')) {
    button.querySelector('.duty-count').textContent = records.filter(record => record.date.startsWith(month) && record.duty === button.dataset.duty).length;
  }
}

function render() {
  const list = filtered();
  $('total').textContent = records.length;
  $('month').textContent = records.filter(record => record.date.startsWith(localDate().slice(0,7))).length;
  $('count').textContent = list.length + ' of ' + records.length + ' entries';
  $('cases').innerHTML = list.map(record => '<article class="case"><span class="muted">' + esc(record.date.split('-').reverse().join('-')) + '</span><strong>' + esc(record[config.titleKey] || 'Untitled draft') + '</strong>' + (config.groupKey !== config.titleKey ? '<span class="tag">' + esc(record[config.groupKey] || 'Not specified') + '</span>' : '') + (isDraft(record) ? '<span class="tag">Draft</span>' : '') + (record.rotation ? '<span class="tag">' + esc(record.rotation) + '</span>' : '') + '<div class="actions"><button class="secondary" data-edit="' + esc(record.id) + '">View / edit</button><button class="secondary" data-delete="' + esc(record.id) + '">Delete</button></div></article>').join('') || '<div class="empty">' + (records.length ? 'No entries match your filters.' : 'No entries recorded yet.') + '</div>';
  const counts = new Map();
  for (const record of records) { const group = record[config.groupKey] || 'Not specified'; counts.set(group,(counts.get(group) || 0) + 1); }
  $('summary').innerHTML = [...counts].sort((a,b) => b[1]-a[1]).map(([label,count]) => '<tr><td>' + esc(label) + '</td><td>' + count + '</td></tr>').join('') || '<tr><td colspan="2">No entries yet.</td></tr>';
  renderDutyCounts();
}

function reset() {
  editing = null; editingParents = [];
  HTMLFormElement.prototype.reset.call($('form')); $('date').value = localDate();
  $('formtitle').textContent = config.formTitle; $('save').textContent = 'Save entry';
  if (config.quickGroups) { $('quick-duties').hidden = false; $('dutyField').hidden = true; $('save').hidden = true; $('duty').required = false; }
  updateDraftHint(); renderDutyCounts();
}

async function saveEntry({quick = false} = {}) {
  if (!$('form').reportValidity()) return;
  const data = readForm();
  if (config.quickGroups && !data.duty) return;
  if (editing) data.id = editing;
  const wasDraft = isDraft(data);
  const wasEditing = !!editing;
  window.logbookFeedback?.hide();
  const buttons = [$('save'), ...document.querySelectorAll('[data-duty]')];
  buttons.forEach(button => button.disabled = true);
  $('status').textContent = 'Saving…';
  try {
    await api('/api/cases', {method:'POST',body:JSON.stringify(data)});
    records = await api('/api/cases');
    if (!quick) reset();
    render();
    $('status').textContent = (quick ? data.duty : wasDraft ? 'Draft' : 'Entry') + ' saved on this device. Open Export for Google Drive sync status.';
    window.logbookFeedback?.showSaved({draft: wasDraft, updated: wasEditing});
  } catch (error) { $('status').textContent = error.message + ' Your form has been kept; try again.'; }
  finally { buttons.forEach(button => button.disabled = false); }
}

function download(rows) {
  const cell = value => { let text = Array.isArray(value) ? value.join('; ') : String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g,'""') + '"'; };
  const csv = '\uFEFF' + [fields.map(([,label]) => cell(label)).join(','), ...rows.map(record => fields.map(([key]) => cell(record[key])).join(','))].join('\r\n');
  saveDownload(new Blob([csv],{type:'text/csv;charset=utf-8'}), config.slug + '-logbook-' + localDate() + '.csv');
}

document.addEventListener('DOMContentLoaded', async () => {
  buildForm();
  $('form').onsubmit = event => { event.preventDefault(); saveEntry(); };
  $('reset').onclick = () => { reset(); $('status').textContent = ''; };
  for (const id of ['search','from','to']) $(id).oninput = render;
  $('clearfilters').onclick = () => { for (const id of ['search','from','to']) $(id).value = ''; render(); };
  $('export').onclick = () => download(records);
  $('filteredexport').onclick = () => download(filtered());
  $('cases').onclick = async event => {
    const button = event.target.closest('button');
    if (!button) return;
    const id = button.dataset.edit || button.dataset.delete;
    const record = records.find(record => record.id === id);
    if (!record) return;
    if (record._conflict) { window.logbookNavigation.show('export'); driveStatus('Resolve this entry’s versions below before changing it.'); return; }
    if (button.dataset.edit) {
      editing = id; editingParents = [...record._syncHeads];
      for (const [key,,type] of fields) {
        if (type === 'multi' || type === 'radio') {
          for (const input of document.querySelectorAll(`input[name="${key}"]`)) input.checked = type === 'multi' ? record[key].includes(input.value) : record[key] === input.value;
        } else { if(type==='select' && record[key] && ![...$(key).options].some(option=>option.value===record[key]))$(key).append(new Option(record[key]+' (saved)',record[key])); $(key).value = record[key]; }
      }
      if (config.quickGroups) { $('quick-duties').hidden = true; $('dutyField').hidden = false; $('save').hidden = false; $('duty').required = true; }
      $('formtitle').textContent = config.formTitle + ' — Edit'; $('save').textContent = 'Update entry'; $('status').textContent = '';
      updateDraftHint(); window.logbookNavigation.show('log');
    } else if (confirm('Delete this entry? Its previous versions remain in backup and Drive history.')) {
      try { await api('/api/cases?id=' + id,{method:'DELETE'}); records = await api('/api/cases'); if (editing === id) reset(); render(); $('entries-status').textContent = 'Entry deleted.'; }
      catch (error) { $('entries-status').textContent = error.message; }
    }
  };
  try { records = await api('/api/cases'); render(); }
  catch (error) { $('status').textContent = error.message; $('cases').textContent = 'Unable to load entries. Please refresh to try again.'; for (const button of [$('save'),$('export'),$('filteredexport'),...document.querySelectorAll('[data-duty]')]) button.disabled = true; }
});
