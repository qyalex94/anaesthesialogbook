// Share a short-lived Google connection between open logbook pages, in memory only.
let session = null;
let lock = null;
const ports = new Set();
const current = () => session && session.expiry > Date.now() ? session : (session = null);
self.onconnect = event => {
  const port = event.ports[0]; ports.add(port);
  port.onmessage = ({data}) => {
    let result;
    if (data.action === 'get') result = current();
    if (data.action === 'set') { session = data.session; result = true; }
    if (data.action === 'clear') { session = null; result = true; }
    if (data.action === 'lock') {
      if (!lock || lock.until < Date.now()) { lock = {id:data.owner,until:Date.now()+180000}; result = true; }
      else result = false;
    }
    if (data.action === 'renew') { if (lock?.id === data.owner) lock.until = Date.now()+180000; result = true; }
    if (data.action === 'unlock') { if (lock?.id === data.owner) lock = null; result = true; }
    port.postMessage({id:data.id,result});
    if (data.action === 'set' || data.action === 'clear') {
      for (const other of ports) other.postMessage({changed:true});
    }
  };
  port.start();
};
