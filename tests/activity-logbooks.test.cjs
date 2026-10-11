const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '..');
const slugs = ['aps-pain', 'cme', 'duties-rotation'];
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

function setup(slug, storage = new Map()) {
  const config = JSON.parse(source(slug + '.html').match(/const config = (.*);<\/script>/)[1]);
  const nodes = new Map();
  const context = vm.createContext({
    config, crypto: webcrypto, Blob, URL, URLSearchParams, console,
    localStorage: {getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    document: {getElementById:id=>{if (!nodes.has(id)) nodes.set(id,{value:'',textContent:'',replaceChildren(){}}); return nodes.get(id);},addEventListener(){}},
    window:{addEventListener(){}},navigator:{onLine:true},
    setTimeout(){},clearTimeout(){},setInterval(){},confirm:()=>true,
  });
  vm.runInContext(source('activity-logbook.js'),context);
  vm.runInContext(source('activity-sync.js'),context);
  vm.runInContext('render = () => {}; renderConflicts = () => {}; saveDownload = (blob,name) => { globalThis.downloaded = {blob,name}; };',context);
  return {context, config, storage, nodes, run: code => vm.runInContext(code,context)};
}

// A deterministic Drive substitute checks category routing and revision transfer
// without accessing an account or uploading test records.
function fakeDrive() {
  const folders = new Map(), files = new Map(); let next = 0;
  return {
    async list(query) {
      if (query.includes('appProperties')) {
        const marker = query.match(/value='([^']+)'/)[1];
        return folders.has(marker) ? [folders.get(marker)] : [];
      }
      const folderId = query.match(/'([^']+)' in parents/)[1];
      return [...files.values()].filter(file=>file.parents.includes(folderId));
    },
    async json(url,options) {
      if (options?.method === 'POST') {
        const metadata = JSON.parse(options.body);
        const folder = {...metadata,id:'folder-'+(++next),createdTime:'2026-10-12T00:00:00Z'};
        folders.set(metadata.appProperties.logbook,folder);return folder;
      }
      return JSON.parse(files.get(url.match(/files\/([^?]+)/)[1]).content);
    },
    async upload(metadata,blob) {
      const file = {...metadata,id:'file-'+(++next),content:await blob.text()}; files.set(file.id,file);return file;
    },
  };
}
function connect(client,drive) {
  client.context.fakeDrive = drive;
  client.run('driveList=fakeDrive.list; driveJSON=fakeDrive.json; uploadDriveFile=fakeDrive.upload;');
}

(async()=>{
  const sharedStorage = new Map(); const drive = fakeDrive();
  for (const slug of slugs) {
    const first = setup(slug,sharedStorage); const second = setup(slug);
    const titleKey = first.config.titleKey;
    first.context.sample = {date:'2026-10-12',[titleKey]:'Fictional test',service:'Acute pain service',activity:'Presented',role:'Speaker'};
    await first.run("api('/api/cases',{method:'POST',body:JSON.stringify(normalise(sample))})");
    assert.equal(first.run('projectCases(readSyncState().events).length'),1);
    connect(first,drive);connect(second,drive);
    await first.run('syncDrive()'); await second.run('syncDrive()');
    assert.equal(second.run('projectCases(readSyncState().events).length'),1,'new device receives entry');
    assert.equal(second.run(`projectCases(readSyncState().events)[0][config.titleKey]`),'Fictional test');
    // Independent edits on two devices must retain both revisions as a conflict.
    for (const client of [first,second]) client.run('editing=projectCases(readSyncState().events)[0].id; editingParents=[...projectCases(readSyncState().events)[0]._syncHeads];');
    await first.run("api('/api/cases',{method:'POST',body:JSON.stringify({...projectCases(readSyncState().events)[0],[config.titleKey]:'Edit A'})})");
    await second.run("api('/api/cases',{method:'POST',body:JSON.stringify({...projectCases(readSyncState().events)[0],[config.titleKey]:'Edit B'})})");
    await first.run('syncDrive()');await second.run('syncDrive()');await first.run('syncDrive()');
    assert.equal(first.run('projectCases(readSyncState().events)[0]._conflict'),true);
    assert.equal(first.run('projectCases(readSyncState().events)[0]._syncHeads.length'),2);
    // Backups preserve the category and full conflict history.
    await first.run('backupLogbook()');
    const backup = JSON.parse(await first.context.downloaded.blob.text());
    assert.equal(backup.format,slug+'-logbook-backup');assert.equal(backup.state.events.length,3);
    const restored = setup(slug);restored.context.backupInput = {files:[{text:async()=>JSON.stringify(backup)}],value:'test'};
    await restored.run('restoreLogbook(backupInput)');
    assert.equal(restored.run('readSyncState().events.length'),3);
    const other = setup(slugs.find(value=>value!==slug));other.context.backupInput=restored.context.backupInput;
    await other.run('restoreLogbook(backupInput)');assert.equal(other.run('readSyncState().events.length'),0,'reject another category backup');
    assert.throws(()=>first.run('validateEvent({...readSyncState().events[0],record:{...readSyncState().events[0].record,date:123}})'));
    console.log(slug+': save, separate device sync, concurrent edit, backup round-trip, category isolation passed');
  }
  assert.deepEqual([...sharedStorage.keys()].sort(),slugs.map(slug=>slug+'-logbook-sync-v2').sort());
  for (const slug of ['anaesthesia','critical-care']) {
    const current = source(slug+'.html');
    assert.equal((current.match(/data-logbook="/g)||[]).length,5);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
