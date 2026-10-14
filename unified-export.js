(() => {
  if (new URLSearchParams(location.search).has('syncWorker')) return;
  const categories = [
    ['anaesthesia','Anaesthesia','anaesthesia.html'], ['critical-care','ICU','critical-care.html'],
    ['aps-pain','APS & Pain','aps-pain.html'], ['cme','CME','cme.html'],
    ['duties-rotation','Duties & Rotation','duties-rotation.html'],
  ].map(([id,label,file]) => ({id,label,file}));
  const section = document.getElementById('view-export');
  for (const child of section.children) child.hidden = true;
  const panel = document.createElement('div'); panel.className = 'unified-export';
  panel.innerHTML = `<section class="panel"><h2>Export</h2><p class="muted">Choose the logbooks to include in your download.</p>
    <fieldset class="export-categories"><legend>Logbooks to export</legend>${categories.map(item => `<label class="export-choice"><input type="checkbox" value="${item.id}" checked><span>${item.label}</span></label>`).join('')}</fieldset>
    <div class="actions"><button type="button" class="secondary" data-select="all">Select all</button><button type="button" class="secondary" data-select="none">Clear selection</button></div>
    <div class="export-dates"><label>From date (optional)<input type="date" id="unified-export-from"></label><label>To date (optional)<input type="date" id="unified-export-to"></label></div>
    <button type="button" id="unified-export-csv">Export selected logbooks (Excel CSV)</button>
    <p class="muted">One spreadsheet with a Logbook column. Dates apply to the spreadsheet only. Images are included in full backups below.</p><p id="unified-export-status" role="status" aria-live="polite"></p></section>
    <section class="panel"><h3>Google Drive sync</h3><p class="muted">One Google connection syncs all five logbooks, including images and entry history.</p>
    <p id="unified-drive-account" class="muted"></p><div class="actions"><button type="button" id="unified-drive-connect">Connect Google Drive</button><button type="button" id="unified-drive-sync" class="secondary">Sync everything now</button><button type="button" id="unified-drive-disconnect" class="secondary" hidden>Disconnect</button></div>
    <label class="export-choice export-auto"><input type="checkbox" id="unified-drive-auto" checked><span>Automatically sync when I open or return to the logbook</span></label>
    <p class="muted">Auto-sync also runs after saving and when your internet connection returns. Google may ask you to reconnect after access expires or the browser closes.</p>
    <p id="unified-drive-status" role="status" aria-live="polite">Connect Google Drive once to sync all five logbooks.</p><ul class="unified-sync-results"></ul><div class="unified-conflicts"></div></section>
    <section class="panel"><h3>Backup & restore</h3><p class="muted">Full backups include the selected logbooks, all dates, previous versions and images.</p><div class="actions"><button type="button" id="unified-backup" class="secondary">Download selected full backup</button><button type="button" id="unified-restore" class="secondary">Import full backup</button></div><input type="file" id="unified-restore-file" accept="application/json,.json" hidden><p id="unified-backup-status" role="status" aria-live="polite"></p></section>`;
  section.prepend(panel);
  const el = id => document.getElementById(id);
  const status = text => { el('unified-drive-status').textContent = text; };
  const selected = () => categories.filter(item => panel.querySelector(`.export-categories input[value="${item.id}"]`).checked);
  const loaders = new Map();
  function adapter(item) {
    if (window.logbookSyncAdapter.slug === item.id) return Promise.resolve(window.logbookSyncAdapter);
    if (!loaders.has(item.id)) loaders.set(item.id, new Promise((resolve,reject) => {
      const frame = document.createElement('iframe'); frame.hidden = true; frame.title = item.label + ' sync';
      const timeout = setTimeout(() => { frame.remove(); loaders.delete(item.id); reject(Error(item.label + ' could not load. Please try again.')); },20000);
      frame.onload = () => {
        const api = frame.contentWindow.logbookSyncAdapter;
        if (!api) { clearTimeout(timeout); frame.remove(); loaders.delete(item.id); reject(Error(item.label + ' could not load. Refresh and try again.')); return; }
        // Delegation is same-origin only; no token is sent to a different website.
        frame.contentWindow.logbookUnifiedSync = window.logbookUnifiedSync;
        clearTimeout(timeout); resolve(api);
      };
      frame.src = item.file + '?syncWorker=1#log'; document.body.append(frame);
    }));
    return loaders.get(item.id);
  }
  function download(blob,name) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href=url; link.download=name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const date = () => new Date().toLocaleDateString('en-CA');
  const csvCell = value => {
    let text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  panel.querySelectorAll('[data-select]').forEach(button => button.onclick = () => {
    panel.querySelectorAll('.export-categories input').forEach(input => { input.checked = button.dataset.select === 'all'; });
  });
  el('unified-export-csv').onclick = async () => {
    const button = el('unified-export-csv'); button.disabled=true;
    try {
      const choices=selected(); if (!choices.length) throw Error('Choose at least one logbook to export.');
      const from=el('unified-export-from').value,to=el('unified-export-to').value;
      if (from && to && from>to) throw Error('The From date must be before the To date.');
      const snapshots=await Promise.all(choices.map(async item => ({item,snapshot:(await adapter(item)).snapshot()})));
      const columns=[...new Set(snapshots.flatMap(({snapshot}) => snapshot.fields.map(([,label]) => label)))];
      const rows=[];
      for (const {item,snapshot} of snapshots) for (const record of snapshot.rows) {
        if ((from && record.date<from) || (to && record.date>to)) continue;
        const values=new Map(snapshot.fields.map(([key,label]) => [label,record[key]]));
        rows.push([item.label,...columns.map(label => values.get(label)),(record.attachments||[]).map(image => image.name).join('; ')]);
      }
      const csv='\uFEFF'+[['Logbook',...columns,'Attachments'],...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
      download(new Blob([csv],{type:'text/csv;charset=utf-8'}),'logbook-export-'+date()+'.csv');
      el('unified-export-status').textContent=rows.length+(rows.length===1?' entry':' entries')+' exported from '+choices.length+(choices.length===1?' logbook.':' logbooks.');
    } catch(error) { el('unified-export-status').textContent=error.message; }
    finally { button.disabled=false; }
  };
  el('unified-backup').onclick=async () => {
    const button=el('unified-backup'); button.disabled=true;
    try {
      if (busy) throw Error('Wait for syncing to finish before making a backup.');
      const choices=selected(); if (!choices.length) throw Error('Choose at least one logbook to back up.');
      const backups={};
      for (const item of choices) backups[item.id]=await (await adapter(item)).backup();
      download(new Blob([JSON.stringify({format:'combined-logbook-backup',version:1,logbooks:backups})],{type:'application/json'}),'logbook-full-backup-'+date()+'.json');
      el('unified-backup-status').textContent='Full backup downloaded for '+choices.length+' logbook(s), including history and images.';
    } catch(error) { el('unified-backup-status').textContent=error.message; }
    finally { button.disabled=false; }
  };
  el('unified-restore').onclick=() => el('unified-restore-file').click();
  el('unified-restore-file').onchange=async event => {
    const file=event.target.files[0]; if (!file) return;
    try {
      if (busy) throw Error('Wait for syncing to finish before importing a backup.');
      const backup=JSON.parse(await file.text());
      const backups=backup.format==='combined-logbook-backup' && backup.version===1 ? backup.logbooks : {[String(backup.format).replace(/-logbook-backup$/,'')]:backup};
      if (!backups || !Object.keys(backups).length || Object.keys(backups).some(id => !categories.some(item => item.id===id))) throw Error('Choose a full logbook JSON backup.');
      const prepared=[];
      for (const [id,value] of Object.entries(backups)) {
        const api=await adapter(categories.find(item => item.id===id)); prepared.push({api,data:await api.prepareRestore(value)});
      }
      if (!confirm('Merge this backup into '+prepared.length+' logbook(s)? Existing entries and previous versions will be kept.')) return;
      for (const {api,data} of prepared) await api.restore(data);
      window.logbookSyncAdapter.refresh(); await showConflicts();
      el('unified-backup-status').textContent='Backup imported into '+prepared.length+' logbook(s).'; queue();
    } catch(error) { el('unified-backup-status').textContent=error.message+' Existing entries have been kept.'; }
    finally { event.target.value=''; }
  };

  let session=null,busy=false,queued=false,timer,port,requestId=0,sessionVersion=0;
  const owner=crypto.randomUUID(),requests=new Map();
  function broker(action,extra={}) {
    if (!port) return Promise.resolve(action==='get'?session: true);
    return new Promise((resolve,reject) => {
      const id=++requestId;
      const timeout=setTimeout(() => { requests.delete(id); reject(Error('The shared Google connection did not respond. Refresh and reconnect.')); },4000);
      requests.set(id,value => { clearTimeout(timeout); resolve(value); }); port.postMessage({id,action,owner,...extra});
    });
  }
  try {
    if (window.SharedWorker) {
      const worker=new SharedWorker('drive-session-worker.js?v=20261014-unified'); port=worker.port;
      port.onmessage=event => { if(event.data.changed) refreshConnection(); else { requests.get(event.data.id)?.(event.data.result); requests.delete(event.data.id); } };
      worker.onerror=() => { port=null; for(const finish of requests.values()) finish(null); requests.clear(); };
      port.start();
    }
  } catch { port=null; }
  const auto=el('unified-drive-auto');
  try { auto.checked=localStorage.getItem('logbook-auto-sync')!=='false'; } catch {}
  auto.onchange=() => { try { localStorage.setItem('logbook-auto-sync',String(auto.checked)); } catch {} if(auto.checked && !busy) queue(); };
  const validSession = () => session?.token && session.expiry>Date.now();
  function connectionUI() {
    const connected=validSession();
    el('unified-drive-connect').textContent=connected?'Change Google account':'Connect Google Drive';
    el('unified-drive-disconnect').hidden=!connected;
    el('unified-drive-account').textContent=connected?session.account.email:'';
  }
  async function refreshConnection() {
    try {
      const version=sessionVersion,shared=await broker('get');
      if(version!==sessionVersion) return;
      session=shared; connectionUI();
      if (validSession() && auto.checked && !busy) queue();
      else if(!validSession()) status('Connect Google Drive once to sync all five logbooks. Reconnect when Google access expires.');
    } catch(error) { status(error.message); }
  }
  function queue() {
    if (!auto.checked || !validSession()) return;
    if (busy) { queued=true; return; }
    clearTimeout(timer); timer=setTimeout(() => syncAll(),800);
  }
  async function showConflicts() {
    const area=panel.querySelector('.unified-conflicts'); area.replaceChildren();
    for (const item of categories) {
      const api=await adapter(item), snapshot=api.snapshot();
      for (const [caseId,heads] of snapshot.conflicts) {
        const card=document.createElement('section'); card.className='notice';
        const heading=document.createElement('strong'); heading.textContent=item.label+': versions need your choice'; card.append(heading);
        for (const head of heads) {
          const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('pre'),choose=document.createElement('button');
          summary.textContent=(head.deleted?'Deleted entry':'Saved entry')+' · '+new Date(head.at).toLocaleString();
          content.textContent=head.deleted?'This version deletes the entry.':snapshot.fields.map(([key,label]) => label+': '+(Array.isArray(head.record[key])?head.record[key].join('; '):head.record[key]||'')).join('\n');
          choose.type='button'; choose.className='secondary'; choose.textContent='Use this version';
          choose.onclick=async () => { try { api.resolve(caseId,head.id); await showConflicts(); queue(); } catch(error) { status(error.message); } };
          details.append(summary,content,choose); card.append(details);
        }
        area.append(card);
      }
    }
  }
  async function syncAll() {
    if(busy) { queued=true; return; }
    if(!validSession()) { status('Connect Google Drive to sync all five logbooks.'); connectionUI(); return; }
    if(!navigator.onLine) { status('Offline. Entries stay on this device and will sync when the connection returns.'); return; }
    clearTimeout(timer);
    const activeSession=session;
    busy=true; queued=false; let locked=false,renewal;
    const buttons=['unified-drive-connect','unified-drive-sync','unified-drive-disconnect']; buttons.forEach(id => el(id).disabled=true);
    const results=panel.querySelector('.unified-sync-results'); results.replaceChildren();
    try {
      locked=await broker('lock');
      if(!locked) { status('Another logbook page is syncing. Your entries will sync shortly.'); queued=true; return; }
      renewal=setInterval(() => broker('renew').catch(() => {}),30000);
      const apis=await Promise.all(categories.map(adapter));
      apis.forEach(api => api.checkAccount(activeSession.account)); // Validate all accounts before any upload.
      let failures=0;
      for(let i=0;i<categories.length;i++) {
        const item=categories[i],row=document.createElement('li'); results.append(row);
        status('Syncing '+item.label+'…'); row.textContent=item.label+': syncing…';
        try {
          if(!validSession()) throw Error('Google access expired or disconnected. Reconnect Google Drive.');
          const result=await apis[i].sync(activeSession); row.textContent=item.label+': '+result.status;
        } catch(error) {
          failures++; row.textContent=item.label+': '+error.message;
          if(/Google access expired|Reconnect Google Drive/.test(error.message)) { sessionVersion++; session=null; await broker('clear'); }
        }
      }
      window.logbookSyncAdapter.refresh(); await showConflicts();
      const conflicts=apis.reduce((total,api) => total+api.snapshot().conflicts.length,0);
      status(failures?failures+' logbook(s) could not finish syncing. See the details below. Local entries are kept.':
        'All five logbooks synced at '+new Date().toLocaleTimeString()+'.'+(conflicts?' '+conflicts+' entries need your choice below.':''));
    } catch(error) { status(error.message+' Local entries remain on this device.'); }
    finally {
      clearInterval(renewal); if(locked) await broker('unlock').catch(() => {});
      busy=false; buttons.forEach(id => el(id).disabled=false); connectionUI();
      if(queued && auto.checked) { clearTimeout(timer); timer=setTimeout(() => syncAll(),5000); }
    }
  }
  function connect() {
    if(busy) return;
    if(!window.google?.accounts?.oauth2) { status('Google connection is still loading. Check your internet connection and try again.'); return; }
    const client=google.accounts.oauth2.initTokenClient({
      client_id:window.logbookSyncAdapter.clientId(),scope:'https://www.googleapis.com/auth/drive.file',
      error_callback:() => status('Google connection was cancelled or the popup was blocked. Your local entries are kept.'),
      callback:async response => {
        try {
          if(response.error || !response.access_token) throw Error('Google did not grant access. Try connecting again.');
          const reply=await fetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)',{headers:{Authorization:'Bearer '+response.access_token},signal:AbortSignal.timeout(30000)});
          if(!reply.ok) throw Error('Could not verify your Google account. Try again.');
          const account=(await reply.json()).user;
          const next={token:response.access_token,expiry:Date.now()+Number(response.expires_in||3600)*1000-60000,account:{id:account?.permissionId,email:account?.emailAddress}};
          const apis=await Promise.all(categories.map(adapter)); apis.forEach(api => api.checkAccount(next.account));
          if(apis.some(api => !api.snapshot().account && api.snapshot().eventCount) && !confirm('Sync all five logbooks and their images with the private Google Drive folders in '+account.emailAddress+'?')) { status('Connection cancelled. Entries remain on this device.'); return; }
          sessionVersion++; session=next; await broker('set',{session}); connectionUI(); await syncAll();
        } catch(error) { status(error.message); }
      },
    });
    client.requestAccessToken({prompt:'select_account'});
  }
  el('unified-drive-connect').onclick=connect;
  el('unified-drive-sync').onclick=() => { validSession()?syncAll():connect(); };
  el('unified-drive-disconnect').onclick=async () => {
    if(busy) return; clearTimeout(timer); sessionVersion++; session=null; await broker('clear'); connectionUI(); status('Disconnected. Entries stay on this device and in Drive.');
  };
  window.logbookUnifiedSync={queue,syncAll};
  const originalShow=window.logbookNavigation.show;
  function updateView() {
    const active=location.hash==='#export'; document.body.classList.toggle('show-unified-export',active);
    if(active) { document.querySelector('header h1').textContent='Logbook Export'; showConflicts().catch(error => status(error.message)); if(auto.checked && !busy) queue(); }
  }
  window.logbookNavigation.show=function(...args) { originalShow(...args); updateView(); };
  window.addEventListener('hashchange',updateView);
  window.addEventListener('online',() => { if(auto.checked) refreshConnection(); });
  window.addEventListener('focus',() => { if(auto.checked) refreshConnection(); });
  document.addEventListener('visibilitychange',() => { if(document.visibilityState==='visible' && auto.checked) refreshConnection(); });
  window.addEventListener('storage',event => {
    if(!event.key?.endsWith('-logbook-sync-v2') || !event.newValue) return;
    try {
      const next=JSON.parse(event.newValue), previous=new Set(JSON.parse(event.oldValue||'{"events":[]}').events.map(item => item.id));
      if(next.events.some(item => !previous.has(item.id) && !next.uploaded.includes(item.id))) queue();
    } catch {}
  });
  setInterval(() => { if(auto.checked && document.visibilityState==='visible') refreshConnection(); },60000);
  updateView(); refreshConnection();
})();
