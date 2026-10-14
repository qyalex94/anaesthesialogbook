const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.join(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,name),'utf8');
const slugs=['anaesthesia','critical-care','aps-pain','cme','duties-rotation'];
function setup(slug) {
  const storage=new Map(),images=new Map(),nodes=new Map();
  const context=vm.createContext({crypto:webcrypto,Blob,URL,URLSearchParams,console,atob,
    FileReader:class { async readAsDataURL(blob) {this.result='data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload();} },
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
    document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',replaceChildren(){}});return nodes.get(id);},addEventListener(){}},
    window:{addEventListener(){}},navigator:{onLine:true},setTimeout(){},clearTimeout(){},setInterval(){},confirm:()=>true,
  });
  const run=code=>vm.runInContext(code,context);
  if(slug==='anaesthesia'||slug==='critical-care') {
    const html=source(slug+'.html');
    const fields=JSON.parse(html.match(/const fields=(\[.*?\]);/)[1]);context.fields=fields;
    if(slug==='anaesthesia')run(source('anaesthesia-options.js'));
    run(html.match(/^function normalise\(r\).*$/m)[0]);
    run('let records=[],editing=null; const $=id=>document.getElementById(id); function render(){}; async function renderAttachments(){}; function localDate(){return "2026-10-14";}');
    run(html.slice(html.indexOf('// Immutable case revisions:'),html.indexOf('function filtered()')));
    run(html.slice(html.indexOf('// OAuth tokens stay in memory.'),html.indexOf('</script>',html.indexOf('// OAuth tokens stay in memory.'))));
  } else {
    context.config=JSON.parse(source(slug+'.html').match(/const config = (.*);<\/script>/)[1]);
    run(source('activity-logbook.js')); run(source('activity-sync.js'));
  }
  context.images=images;
  run('render=()=>{};renderConflicts=()=>{};attachmentOp=async(action,value)=>action==="get"?images.get(value):images.set(value.id,value);');
  run(source('sync-adapter.js'));
  return {context,run,storage,images,api:context.window.logbookSyncAdapter};
}
function fakeDrive() {
  const folders=new Map(),files=new Map();let serial=0;
  return {
    async list(query) {
      if(query.includes('appProperties')){const marker=query.match(/value='([^']+)'/)[1];return folders.has(marker)?[folders.get(marker)]:[];}
      const folder=query.match(/'([^']+)' in parents/)[1];return [...files.values()].filter(file=>file.parents.includes(folder));
    },
    async json(url,options) {
      if(options?.method==='POST'){const data=JSON.parse(options.body),folder={...data,id:'folder-'+(++serial),createdTime:'2026-10-14'};folders.set(data.appProperties.logbook,folder);return folder;}
      return JSON.parse(await files.get(url.match(/files\/([^?]+)/)[1]).blob.text());
    },
    async upload(data,blob){const file={...data,id:'file-'+(++serial),blob};files.set(file.id,file);return file;},
    async request(url){return {blob:async()=>files.get(url.match(/files\/([^?]+)/)[1]).blob};},
    folderCount:()=>folders.size,
  };
}
function wire(client,drive){client.context.fakeDrive=drive;client.run('driveList=fakeDrive.list;driveJSON=fakeDrive.json;driveRequest=fakeDrive.request;uploadDriveFile=fakeDrive.upload;');}
(async()=>{
  const drive=fakeDrive(),session={token:'fictional-test-token',expiry:Date.now()+3600000,account:{id:'account-a',email:'fictional@example.test'}};
  const backups={};
  for(const slug of slugs){
    const first=setup(slug),second=setup(slug);wire(first,drive);wire(second,drive);
    first.context.sample={date:'2026-10-14',procedure:'Fictional operation',technique:'General anaesthesia',diagnosis:'Fictional diagnosis',title:'Fictional CME',duty:'On-call — OT',service:'Acute pain service',interventions:[],skills:[],attachments:[]};
    await first.run("api('/api/cases',{method:'POST',body:JSON.stringify(normalise(sample))})");
    const before=first.storage.get(slug+'-logbook-sync-v2');
    assert.throws(()=>first.api.checkAccount({id:null}),/verify/);
    await first.api.sync(session);await second.api.sync(session);
    assert.equal(second.api.snapshot().rows.length,1,slug+' downloads remote entry');
    assert.equal(first.run('driveToken'),null,'token is cleared after each category sync');
    assert.equal(first.api.snapshot().account.id,'account-a');
    await assert.rejects(()=>first.api.sync({...session,account:{id:'account-b',email:'other@example.test'}}),/belong/);
    // Concurrent edits retain both revisions and can be resolved from the common page.
    for(const client of [first,second])client.run('editing=projectCases(readSyncState().events)[0].id;editingParents=[...projectCases(readSyncState().events)[0]._syncHeads];');
    await first.run("api('/api/cases',{method:'POST',body:JSON.stringify({...projectCases(readSyncState().events)[0],notes:'First edit'})})");
    await second.run("api('/api/cases',{method:'POST',body:JSON.stringify({...projectCases(readSyncState().events)[0],notes:'Second edit'})})");
    await first.api.sync(session);await second.api.sync(session);await first.api.sync(session);
    const [caseId,heads]=first.api.snapshot().conflicts[0];assert.equal(heads.length,2);
    first.api.resolve(caseId,heads[0].id);assert.equal(first.api.snapshot().conflicts.length,0);
    await first.api.sync(session);
    backups[slug]=await first.api.backup();
    const restored=setup(slug);await restored.api.restore(await restored.api.prepareRestore(backups[slug]));
    assert.equal(restored.api.snapshot().rows.length,1);assert.equal(restored.api.snapshot().eventCount,4);
    const unchanged=restored.storage.get(slug+'-logbook-sync-v2');
    await assert.rejects(()=>restored.api.prepareRestore({...backups[slug],images:[{id:'invalid',type:'text/plain',data:'bad'}]}),/image/);
    assert.equal(restored.storage.get(slug+'-logbook-sync-v2'),unchanged,'invalid backup leaves journal untouched');
    const other=setup(slugs.find(item=>item!==slug));await assert.rejects(()=>other.api.prepareRestore(backups[slug]),/Invalid/);
    console.log(slug+': shared connection, two-device sync, account isolation, conflicts and restore passed');
  }
  assert.equal(drive.folderCount(),5,'reuse separate existing Drive folders through one connection');
  // Include and restore an image using the actual adapter and sync routines.
  const first=setup('anaesthesia'),second=setup('anaesthesia');wire(first,drive);wire(second,drive);
  first.images.set('fictional-image',{id:'fictional-image',blob:new Blob(['fictional pixels'],{type:'image/png'})});
  first.context.sample={date:'2026-10-14',procedure:'Fictional image case',technique:'General anaesthesia',attachments:[{id:'fictional-image',name:'fictional.png',type:'image/png'}]};
  await first.run("api('/api/cases',{method:'POST',body:JSON.stringify(normalise(sample))})");await first.api.sync(session);await second.api.sync(session);
  assert.equal(await second.images.get('fictional-image').blob.text(),'fictional pixels');
  const backup=await second.api.backup(),restored=setup('anaesthesia');await restored.api.restore(await restored.api.prepareRestore(backup));
  assert.equal(await restored.images.get('fictional-image').blob.text(),'fictional pixels');
  console.log('Image upload, download and full backup restoration passed');
  // Network failures must be reported as failures, rather than a false synced state.
  const failing=setup('cme');failing.run('driveList=async()=>{throw Error("Fictional network failure")};');
  await assert.rejects(()=>failing.api.sync(session),/Fictional network failure/);assert.equal(failing.run('driveToken'),null);
  console.log('Partial failure reporting and token cleanup passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
