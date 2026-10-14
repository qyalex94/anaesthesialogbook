// Reuse each logbook's existing journal, image store and Drive folder unchanged.
(() => {
  const slug = SYNC_KEY.replace('-logbook-sync-v2', '');
  let syncing = false;
  const checkAccount = account => {
    const state = readSyncState();
    if (!account?.id) throw Error('Could not verify the Google account.');
    if (state.account && state.account.id !== account.id) {
      throw Error('These entries belong to ' + state.account.email + '. Reconnect that Google account.');
    }
    return state;
  };
  const encode = blob => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('Could not read a backup image.')); reader.readAsDataURL(blob);
  });
  window.logbookSyncAdapter = {
    slug,
    clientId,
    snapshot() {
      const state = readSyncState();
      return {fields: fields.map(([key,label]) => [key,label]), rows: projectCases(state.events),
        account: state.account, eventCount: state.events.length,
        conflicts: [...caseHeads(state.events)].filter(([,heads]) => heads.length > 1)};
    },
    checkAccount,
    async sync(session) {
      if (syncing || syncBusy) throw Error('Sync is already running. Try again shortly.');
      const state = checkAccount(session.account);
      state.account = session.account; writeSyncState(state);
      syncing = true; driveToken = session.token; driveExpiry = session.expiry;
      try {
        await syncDrive();
        const status = $('drivestatus').textContent;
        if (!status.startsWith('Synced at ') && !status.startsWith('More changes waiting')) throw Error(status);
        return {status, folder: driveFolder};
      } finally { driveToken = null; driveExpiry = 0; syncing = false; }
    },
    resolve(caseId, revisionId) {
      const state = readSyncState(), heads = caseHeads(state.events).get(caseId) || [];
      const head = heads.find(item => item.id === revisionId);
      if (!head || heads.length < 2) throw Error('This entry changed. Refresh and review its versions.');
      state.events.push(makeRevision(head.record || {id:caseId}, heads.map(item => item.id), head.deleted));
      writeSyncState(state); records = projectCases(state.events); render(); renderConflicts(); queueSync();
    },
    async backup() {
      if (syncBusy) throw Error('Wait for syncing to finish before making a backup.');
      const state = readSyncState(), images = new Map();
      for (const event of state.events) for (const image of event.record?.attachments || []) images.set(image.id, image);
      const encoded = [];
      for (const image of images.values()) {
        const local = await attachmentOp('get', image.id);
        if (!local?.blob) throw Error('Image “' + image.name + '” is missing on this device. Sync it first.');
        encoded.push({...image, data: await encode(local.blob)});
      }
      return {format:slug+'-logbook-backup', version:2, state, images:encoded};
    },
    async prepareRestore(backup) {
      if (syncBusy) throw Error('Wait for syncing to finish before importing a backup.');
      if (backup.format !== slug+'-logbook-backup' || backup.version !== 2 ||
          !Array.isArray(backup.state?.events) || !Array.isArray(backup.images)) throw Error('Invalid ' + slug + ' backup.');
      const state = readSyncState();
      if (state.account && backup.state.account && state.account.id !== backup.state.account.id) throw Error('This backup belongs to another Google account.');
      const merged = mergeEvents(state.events, backup.state.events), blobs = [];
      for (const image of backup.images) {
        if (!validId(image.id) || typeof image.type !== 'string' || !image.type.startsWith('image/') ||
            typeof image.data !== 'string' || !/^data:image\/[^;,]+;base64,/.test(image.data)) throw Error('Invalid backup image.');
        const bytes = Uint8Array.from(atob(image.data.split(',')[1]), c => c.charCodeAt(0));
        blobs.push({...image, blob:new Blob([bytes], {type:image.type})});
      }
      const available = new Set(blobs.map(image => image.id));
      for (const event of merged) for (const image of event.record?.attachments || []) {
        if (!available.has(image.id) && !(await attachmentOp('get',image.id))?.blob) throw Error('Backup is missing image: ' + image.name);
      }
      return {backup, blobs};
    },
    async restore({backup, blobs}) {
      for (const {data,...image} of blobs) await attachmentOp('put',image);
      const latest = readSyncState(); latest.events = mergeEvents(latest.events,backup.state.events);
      latest.account = latest.account || backup.state.account || null; writeSyncState(latest);
      records = projectCases(latest.events); render(); renderConflicts(); queueSync();
    },
    refresh() { records = projectCases(readSyncState().events); render(); },
  };
  queueSync = () => {
    clearTimeout(syncTimer);
    if (window.logbookUnifiedSync) window.logbookUnifiedSync.queue();
  };
})();
