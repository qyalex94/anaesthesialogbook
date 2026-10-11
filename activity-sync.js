// Shared revision journal and Drive sync for the additional logbooks.
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(id); }
function validateEvent(event) {
  if (!event || event.schema !== 1 || !validId(event.id) || !validId(event.caseId) ||
      !Array.isArray(event.parents) || !event.parents.every(validId) || event.parents.includes(event.id) ||
      typeof event.deleted !== 'boolean' || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) {
    throw Error('A saved revision has an invalid format. Sync stopped without removing local entries.');
  }
  if (!event.deleted && (!event.record || event.record.id !== event.caseId ||
      typeof event.record.date !== 'string' || typeof event.record[config.titleKey] !== 'string' ||
      fields.some(([key,,type]) => type === 'multi' ? !Array.isArray(event.record[key]) || !event.record[key].every(v => typeof v === 'string') : typeof event.record[key] !== 'string') || !Array.isArray(event.record.attachments) ||
      !event.record.attachments.every(a => validId(a.id) && typeof a.name === 'string' &&
        typeof a.type === 'string' && a.type.startsWith('image/')))) {
    throw Error('A saved entry has an invalid format. Sync stopped without removing local entries.');
  }
  return event;
}
function readSyncState() {
  const raw = localStorage.getItem(SYNC_KEY);
  if (raw) {
    const state = JSON.parse(raw);
    if (state.version !== 2 || !Array.isArray(state.events) || !Array.isArray(state.uploaded)) throw Error('Sync data could not be read. Keep this browser data and your backup.');
    state.events.forEach(validateEvent);
    return state;
  }
  const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
  if (!Array.isArray(legacy)) throw Error('Existing cases could not be read.');
  const state = {version:2, events:legacy.map(r => makeRevision(normalise(r), [], false)), uploaded:[], account:null};
  writeSyncState(state); // Preserve the original v1 data as a migration backup.
  return state;
}
function writeSyncState(state) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(state)); }
  catch { throw Error('Browser storage is full or unavailable. Your change has not been saved.'); }
}
function makeRevision(record, parents, deleted) {
  const clean = {...record}; delete clean._syncHeads; delete clean._conflict;
  return validateEvent({schema:1,id:crypto.randomUUID(),caseId:record.id,parents:[...parents],deleted,
    at:new Date().toISOString(),record:deleted ? null : clean});
}
function mergeEvents(first, second) {
  const map = new Map();
  for (const e of [...first,...second]) {
    validateEvent(e);
    if (map.has(e.id) && JSON.stringify(map.get(e.id)) !== JSON.stringify(e)) throw Error('A revision was changed outside the app. Sync stopped to protect your cases.');
    map.set(e.id,e);
  }
  return [...map.values()];
}
function caseHeads(events) {
  const byId = new Map(events.map(e => [e.id,e]));
  const superseded = new Set();
  for (const e of events) for (const parent of e.parents) {
    if (byId.has(parent) && byId.get(parent).caseId !== e.caseId) throw Error('Invalid case revision history.');
    superseded.add(parent);
  }
  const groups = new Map();
  for (const e of events) if (!superseded.has(e.id)) {
    if (!groups.has(e.caseId)) groups.set(e.caseId,[]);
    groups.get(e.caseId).push(e);
  }
  return groups;
}
function projectCases(events) {
  const rows=[];
  for (const heads of caseHeads(events).values()) {
    // Keep a live version visible when a deletion conflicts with an edit.
    const visible=heads.filter(e=>!e.deleted).sort((a,b)=>b.at.localeCompare(a.at)||b.id.localeCompare(a.id));
    if (visible.length) rows.push({...normalise(visible[0].record),_syncHeads:heads.map(e=>e.id),_conflict:heads.length>1});
  }
  return rows.sort((a,b)=>b.date.localeCompare(a.date)||(b.updatedAt||'').localeCompare(a.updatedAt||''));
}
async function api(path, opts={}) {
  const state=readSyncState();
  if (opts.method==='POST') {
    let data=JSON.parse(opts.body);
    const old=projectCases(state.events).find(r=>r.id===data.id);
    if (old?._conflict) throw Error('Resolve the two versions of this case in the Drive panel before editing it.');
    const now=new Date().toISOString();
    data={...normalise(old||{}),...data,id:data.id||crypto.randomUUID(),createdAt:old?.createdAt||now,updatedAt:now};
    // The parents captured when the form opened protect against a remote edit during typing.
    const parents=editing===data.id ? editingParents : (old?._syncHeads||[]);
    state.events.push(makeRevision(data,parents,false));
    writeSyncState(state); queueSync(); return data;
  }
  if (opts.method==='DELETE') {
    const id=new URL(path,'https://local.test').searchParams.get('id');
    const old=projectCases(state.events).find(r=>r.id===id);
    if (!old) return {ok:true};
    if (old._conflict) throw Error('Resolve this case’s versions in the Drive panel before deleting it.');
    state.events.push(makeRevision(old,old._syncHeads,true));
    writeSyncState(state); queueSync(); return {ok:true};
  }
  return projectCases(state.events);
}

function openAttachmentDB(){if(!attachmentDB)attachmentDB=new Promise((resolve,reject)=>{if(!window.indexedDB){reject(Error('Image storage is unavailable in this browser.'));return}const req=indexedDB.open(config.slug+'-logbook-attachments',1);req.onupgradeneeded=()=>req.result.createObjectStore('images',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>{attachmentDB=null;reject(Error('Could not open image storage.'))}});return attachmentDB}
async function attachmentOp(action,value){const db=await openAttachmentDB();return new Promise((resolve,reject)=>{const tx=db.transaction('images',action==='get'?'readonly':'readwrite');const store=tx.objectStore('images');const req=store[action](value);let result;req.onsuccess=()=>{result=req.result};tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('Image storage failed or is full. Your form has been kept.'))})}
// OAuth tokens stay in memory. A public OAuth Client ID is the only configuration.
const DEFAULT_GOOGLE_CLIENT_ID = '203815227406-taoetn1lchl994u9c0hcuklb83c0oc7r.apps.googleusercontent.com';
let driveToken=null, driveExpiry=0, syncBusy=false, syncTimer, driveFolder=null;
let editingParents=[];
function saveDownload(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function backupLogbook() {
  $('backupfull').disabled=true;
  try {
    if(syncBusy)throw Error('Wait for syncing to finish before making a backup.');
    const state=readSyncState(),images=new Map();
    for(const event of state.events)for(const a of event.record?.attachments||[])images.set(a.id,a);
    const encoded=[];
    for(const image of images.values()) {
      const item=await attachmentOp('get',image.id);
      if(!item?.blob)throw Error('The image “'+image.name+'” is not cached on this device. Make the backup on the device where it was added.');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(item.blob)});
      encoded.push({...image,data});
    }
    saveDownload(new Blob([JSON.stringify({format:config.slug+'-logbook-backup',version:2,state,images:encoded})],{type:'application/json'}),config.slug+'-logbook-backup-'+localDate()+'.json');
    driveStatus('Backup downloaded with entry history. Keep it private.');
  }catch(e){driveStatus(e.message)}finally{$('backupfull').disabled=false}
}
async function restoreLogbook(input) {
  try {
    if(syncBusy)throw Error('Wait for syncing to finish before importing a backup.');
    const file=input.files[0];if(!file)return;
    const backup=JSON.parse(await file.text());
    if(backup.format!==config.slug+'-logbook-backup'||backup.version!==2||!Array.isArray(backup.state?.events)||!Array.isArray(backup.images))throw Error('Choose a full logbook JSON backup. CSV files cannot restore images.');
    const state=readSyncState();
    if(state.account&&backup.state.account&&state.account.id!==backup.state.account.id)throw Error('This backup belongs to another Google account. Use a separate browser profile.');
    const merged=mergeEvents(state.events,backup.state.events);
    const blobs=[];
    for(const image of backup.images) {
      if(!validId(image.id)||typeof image.type!=='string'||!image.type.startsWith('image/')||typeof image.data!=='string'||!image.data.startsWith('data:image/'))throw Error('Invalid backup image.');
      const parts=image.data.split(',');if(parts.length!==2||!parts[0].endsWith(';base64'))throw Error('Invalid image encoding.');
      const bytes=Uint8Array.from(atob(parts[1]),c=>c.charCodeAt(0));
      blobs.push({...image,blob:new Blob([bytes],{type:image.type})});
    }
    const available=new Set(blobs.map(a=>a.id));
    for(const e of merged)for(const a of e.record?.attachments||[])if(!available.has(a.id)&&!(await attachmentOp('get',a.id))?.blob)throw Error('Backup is missing an image: '+a.name);
    if(!confirm('Import this backup and merge its cases with this device? Existing versions will be preserved.'))return;
    for(const {data,...image} of blobs)await attachmentOp('put',image);
    const latest=readSyncState();latest.events=mergeEvents(latest.events,backup.state.events);
    latest.account=latest.account||backup.state.account||null;writeSyncState(latest);
    records=projectCases(latest.events);render();renderConflicts();queueSync();
    driveStatus('Backup imported, including images. Connect Google Drive or click Sync now.');
  }catch(e){driveStatus(e.message)}finally{input.value=''}
}
const driveStatus=message=>{$('drivestatus').textContent=message};
const clientId=()=>DEFAULT_GOOGLE_CLIENT_ID||localStorage.getItem('logbook-google-client-id')||'';
function queueSync() {
  clearTimeout(syncTimer);
  if (driveToken) syncTimer=setTimeout(()=>syncDrive(),800);
  else driveStatus('Saved on this device. Connect Google Drive to sync.');
}
async function driveRequest(path,options={}) {
  if (!driveToken || Date.now()>=driveExpiry) {
    driveToken=null; $('connectdrive').textContent='Reconnect Google Drive';
    throw Error('Reconnect Google Drive to continue syncing. Local entries are safe on this device.');
  }
  const response=await fetch('https://www.googleapis.com/'+path,{...options,
    headers:{...options.headers,Authorization:'Bearer '+driveToken},signal:AbortSignal.timeout(90000)});
  if (!response.ok) {
    if(response.status===401) {driveToken=null;throw Error('Google access expired. Reconnect Google Drive.');}
    let message=''; try {message=(await response.json()).error?.message||''} catch {}
    throw Error('Google Drive could not complete the request ('+response.status+'). '+message);
  }
  return response;
}
async function driveJSON(path,options) {return (await driveRequest(path,options)).json()}
async function driveList(query) {
  const files=[];let pageToken='';
  do {
    const params=new URLSearchParams({q:query,spaces:'drive',pageSize:'1000',fields:'nextPageToken,files(id,name,mimeType,appProperties,createdTime)',...(pageToken?{pageToken}:{})});
    const page=await driveJSON('drive/v3/files?'+params);
    files.push(...page.files);pageToken=page.nextPageToken||'';
  } while(pageToken);
  return files;
}
async function uploadDriveFile(metadata,blob) {
  // Multipart handles binary images without converting them to base64.
  const boundary='logbook_'+crypto.randomUUID();
  const body=new Blob(['--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',JSON.stringify(metadata),
    '\r\n--'+boundary+'\r\nContent-Type: '+(blob.type||'application/octet-stream')+'\r\n\r\n',blob,'\r\n--'+boundary+'--\r\n']);
  return driveJSON('upload/drive/v3/files?uploadType=multipart&fields=id,name,appProperties',{
    method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
}
async function findDriveFolders() {
  let folders=await driveList("trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='logbook' and value='"+APP_MARKER+"' }");
  if (!folders.length) {
    const created=await driveJSON('drive/v3/files?fields=id,name,createdTime',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:config.name+' Logbook',mimeType:'application/vnd.google-apps.folder',appProperties:{logbook:APP_MARKER}})});
    folders=[created];
  }
  // If two devices create the folder at once, read both so neither set of cases disappears.
  folders.sort((a,b)=>(a.createdTime||'').localeCompare(b.createdTime||'')||a.id.localeCompare(b.id));
  driveFolder=folders[0].id;
  $('drivefolder').href='https://drive.google.com/drive/folders/'+driveFolder;$('drivefolder').hidden=false;
  return folders;
}
function renderConflicts() {
  const state=readSyncState(); const area=$('driveconflicts');area.replaceChildren();
  for (const [caseId,heads] of caseHeads(state.events)) if(heads.length>1) {
    const card=document.createElement('section');card.className='notice';
    const heading=document.createElement('strong');heading.textContent='Two versions need your choice: '+(heads.find(h=>h.record)?.record[config.titleKey]||'Deleted case');card.appendChild(heading);
    const help=document.createElement('p');help.textContent='Both versions are kept in Drive history. Compare the details and choose the version to use.';card.appendChild(help);
    for(const head of heads) {
      const details=document.createElement('details');
      const summary=document.createElement('summary');summary.textContent=(head.deleted?'Deleted case':'Saved case')+' · '+new Date(head.at).toLocaleString();details.appendChild(summary);
      const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';
      pre.textContent=head.deleted?'This version deletes the case.':fields.map(([key,label])=>label+': '+(Array.isArray(head.record[key])?head.record[key].join(', '):head.record[key]||'')).join('\n')+'\nImages: '+head.record.attachments.map(a=>a.name).join(', ');details.appendChild(pre);
      const choose=document.createElement('button');choose.textContent='Use this version';choose.className='secondary';
      choose.onclick=()=>{
        try {
          const current=readSyncState(),nowHeads=caseHeads(current.events).get(caseId)||[];
          if(!nowHeads.some(h=>h.id===head.id))throw Error('The case changed. Review the current versions.');
          current.events.push(makeRevision(head.record||{id:caseId},nowHeads.map(h=>h.id),head.deleted));
          writeSyncState(current);records=projectCases(current.events);render();renderConflicts();queueSync();
          if(editing===caseId)reset();
        }catch(e){driveStatus(e.message)}
      };details.appendChild(choose);card.appendChild(details);
    }
    area.appendChild(card);
  }
}
async function syncDrive() {
  if(syncBusy)return;
  syncBusy=true;$('syncdrive').disabled=true;
  try {
    if(!navigator.onLine)throw Error('Offline. Changes are saved on this device; sync when you reconnect.');
    driveStatus('Syncing entries…');
    const folders=await findDriveFolders(),allFiles=[];
    for(const folder of folders)allFiles.push(...await driveList("trashed=false and '"+folder.id+"' in parents"));
    const imageFiles=new Map(),eventFiles=new Map();
    for(const file of allFiles) {
      const props=file.appProperties||{};
      if(props.kind==='image'&&validId(props.key))imageFiles.set(props.key,file);
      if(props.kind==='revision'&&validId(props.key))eventFiles.set(props.key,file);
    }
    let state=readSyncState(); const known=new Set(state.events.map(e=>e.id)),remote=[];
    for(const [id,file] of eventFiles)if(!known.has(id)) {
      const event=validateEvent(await driveJSON('drive/v3/files/'+file.id+'?alt=media'));
      if(event.id!==id)throw Error('Drive revision does not match its filename.');
      remote.push(event);
    }
    // Re-read after network waits: edits made during syncing must remain in the journal.
    state=readSyncState();state.events=mergeEvents(state.events,remote);
    state.uploaded=[...new Set([...state.uploaded,...eventFiles.keys()])];writeSyncState(state);
    records=projectCases(state.events);render();renderConflicts();
    const pending=state.events.filter(e=>!eventFiles.has(e.id));
    for(const event of pending) {
      for(const image of event.record?.attachments||[])if(!imageFiles.has(image.id)) {
        const local=await attachmentOp('get',image.id);
        if(!local?.blob)throw Error('Image “'+image.name+'” is missing on this device. Sync from the device where it was added.');
        const file=await uploadDriveFile({name:image.id+'--'+image.name,parents:[driveFolder],appProperties:{kind:'image',key:image.id}},local.blob);
        imageFiles.set(image.id,file);
      }
      const file=await uploadDriveFile({name:'case-revision-'+event.id+'.json',parents:[driveFolder],appProperties:{kind:'revision',key:event.id}},
        new Blob([JSON.stringify(event)],{type:'application/json'}));
      eventFiles.set(event.id,file);
      const latest=readSyncState();latest.uploaded=[...new Set([...latest.uploaded,event.id])];writeSyncState(latest);
    }
    // Cache history images too, so a full backup can be made from any synced device.
    const images=new Map();
    for(const e of readSyncState().events)for(const a of e.record?.attachments||[])images.set(a.id,a);
    for(const image of images.values())if(!(await attachmentOp('get',image.id))?.blob) {
      const file=imageFiles.get(image.id);
      if(!file)throw Error('A saved image is missing from Drive: '+image.name+'. Restore it from its original device.');
      const blob=await (await driveRequest('drive/v3/files/'+file.id+'?alt=media')).blob();
      await attachmentOp('put',{...image,blob});
    }
    state=readSyncState();const remaining=state.events.filter(e=>!state.uploaded.includes(e.id)).length;
    const conflicts=[...caseHeads(state.events).values()].filter(h=>h.length>1).length;
    driveStatus((remaining?'More changes waiting to sync.':'Synced at '+new Date().toLocaleTimeString()+'.')+
      (conflicts?' '+conflicts+' case(s) need your choice below.':' Entries are saved in Google Drive.'));
    if(remaining)queueSync();
  } catch(e) {driveStatus(e.message+' Local changes remain on this device.');}
  finally {syncBusy=false;$('syncdrive').disabled=false;}
}
function connectDrive() {
  try {
    if(location.protocol==='file:')throw Error('Open the published website to connect Google Drive.');
    if(!clientId()){$('drivesetup').open=true;throw Error('Add your Google Client ID in Connection setup first.');}
    if(!window.google?.accounts?.oauth2)throw Error('Google connection is still loading. Check your internet connection and try again.');
    if(syncBusy)throw Error('Wait for the current sync to finish before reconnecting.');
    google.accounts.oauth2.initTokenClient({client_id:clientId(),scope:'https://www.googleapis.com/auth/drive.file',
      error_callback:()=>driveStatus('Google connection was cancelled or the popup was blocked. Your local entries are unchanged.'),
      callback:async response=>{
        try {
          if(response.error||!response.access_token)throw Error('Google did not grant access. Try connecting again.');
          driveToken=response.access_token;driveExpiry=Date.now()+Number(response.expires_in||3600)*1000-60000;
          const about=await driveJSON('drive/v3/about?fields=user(permissionId,emailAddress)');
          const state=readSyncState(),account=about.user;
          if(!account?.permissionId)throw Error('Could not verify the selected Google account.');
          if(state.account&&state.account.id!==account.permissionId)throw Error('These local entries belong to '+state.account.email+'. Reconnect that account, or use a separate browser profile for another account.');
          if(!state.account&&state.events.length&&!confirm('Connect to '+account.emailAddress+' and upload the entries saved in this browser to its private '+config.name+' Logbook folder?')) {
            driveToken=null;driveStatus('Connection cancelled. Your entries remain on this device.');return;
          }
          state.account={id:account.permissionId,email:account.emailAddress};writeSyncState(state);
          $('driveaccount').textContent=account.emailAddress;$('connectdrive').textContent='Reconnect Google Drive';
          $('disconnectdrive').hidden=false;await syncDrive();
        }catch(e){driveToken=null;driveStatus(e.message)}
      }}).requestAccessToken({prompt:'select_account'});
  }catch(e){driveStatus(e.message)}
}
$('connectdrive').onclick=connectDrive;
$('backupfull').onclick=backupLogbook;
$('restorefull').onclick=()=>$('restorefile').click();
$('restorefile').onchange=()=>restoreLogbook($('restorefile'));
$('syncdrive').onclick=()=>driveToken?syncDrive():connectDrive();
$('disconnectdrive').onclick=()=>{
  if(syncBusy){driveStatus('Wait for syncing to finish before disconnecting.');return;}
  driveToken=null;driveExpiry=0;clearTimeout(syncTimer);
  $('disconnectdrive').hidden=true;$('drivefolder').hidden=true;$('connectdrive').textContent='Connect Google Drive';
  driveStatus('Disconnected. Entries stay on this device and in Drive.');
};
$('saveclientid').onclick=()=>{
  const value=$('googleclientid').value.trim();
  if(!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)){driveStatus('Paste the Client ID ending in .apps.googleusercontent.com.');return;}
  localStorage.setItem('logbook-google-client-id',value);$('drivesetup').open=false;driveStatus('Setup saved. Click Connect Google Drive.');
};
$('googleclientid').value=clientId();
try {
  const state=readSyncState();if(state.account)$('driveaccount').textContent=state.account.email;
  renderConflicts();
}catch(e){driveStatus(e.message);$('connectdrive').disabled=true;$('syncdrive').disabled=true;}
setInterval(()=>{if(driveToken&&navigator.onLine&&document.visibilityState==='visible')syncDrive()},60000);
window.addEventListener('online',()=>{if(driveToken)syncDrive()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&driveToken)syncDrive()});
window.addEventListener('storage',e=>{
  if(e.key===SYNC_KEY){try{records=projectCases(readSyncState().events);render();renderConflicts()}catch(error){driveStatus(error.message)}}
});

