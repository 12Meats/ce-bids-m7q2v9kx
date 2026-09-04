// photos.js — binary side store (walkthrough photos and generated PDFs).
//
// localStorage holds the bid document; blobs are far too big for it, so they
// live in IndexedDB under their own database. The two stores are deliberately
// independent: a bid references a photo by id, and a photo that is missing —
// evicted by iOS, never written, IndexedDB blocked entirely — must never stop
// a bid from opening or a proposal from printing.
//
// So every call here RESOLVES. Nothing rejects, nothing throws: a failure
// comes back as false / null / [] / 0 and the caller carries on. Browser-only;
// there is no Node build of this file and nothing in it is unit-tested.

const Photos = (function () {
  const DB_NAME = 'ce-bids-files';
  const DB_VERSION = 1;
  const STORE = 'files';

  // Cached open request. Once IndexedDB has failed we keep returning null
  // rather than retrying on every call.
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null); // private-mode Safari and locked-down browsers throw right here
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          // Photos are listed per kind and shown oldest first (the order they
          // were taken on the walkthrough), so index the kind and sort on
          // createdAt after reading.
          store.createIndex('kind', 'kind', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  // Runs fn(store) inside a transaction and resolves with `fallback` on any
  // failure — a missing database, a throwing request, an aborted transaction.
  // fn returns an IDBRequest whose result is passed to map().
  function withStore(mode, fallback, fn, map) {
    return openDb().then((db) => {
      if (!db) return fallback;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
        let tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch (e) {
          finish(fallback);
          return;
        }
        tx.onabort = () => finish(fallback);
        tx.onerror = () => finish(fallback);
        let req;
        try {
          req = fn(tx.objectStore(STORE));
        } catch (e) {
          finish(fallback);
          return;
        }
        req.onerror = () => finish(fallback);
        req.onsuccess = () => {
          let value;
          try {
            value = map ? map(req) : req.result;
          } catch (e) {
            finish(fallback);
            return;
          }
          // For writes, wait for the transaction itself to commit before
          // reporting success — a request that succeeded inside a transaction
          // that later aborts (quota) did not actually store anything.
          if (mode === 'readwrite') tx.oncomplete = () => finish(value);
          else finish(value);
        };
      });
    }).catch(() => fallback);
  }

  // put(id, blob, kind) -> Promise<boolean>. kind is 'photo' or 'pdf'.
  function put(id, blob, kind) {
    if (typeof id !== 'string' || !id || !blob) return Promise.resolve(false);
    const rec = { id, kind: kind === 'pdf' ? 'pdf' : 'photo', blob, createdAt: Date.now() };
    return withStore('readwrite', false, (store) => store.put(rec), () => true);
  }

  // get(id) -> Promise<Blob|null>. null for a missing or unreadable record.
  function get(id) {
    if (typeof id !== 'string' || !id) return Promise.resolve(null);
    return withStore('readonly', null, (store) => store.get(id), (req) => {
      const rec = req.result;
      return rec && rec.blob ? rec.blob : null;
    });
  }

  // del(id) -> Promise<boolean>. True once the delete has committed; deleting
  // an id that isn't there is a success, not an error.
  function del(id) {
    if (typeof id !== 'string' || !id) return Promise.resolve(false);
    return withStore('readwrite', false, (store) => store.delete(id), () => true);
  }

  // list(kind) -> Promise<string[]> of ids, oldest first. Omit kind for all.
  function list(kind) {
    const wanted = kind === undefined ? null : (kind === 'pdf' ? 'pdf' : 'photo');
    return withStore('readonly', [], (store) => (
      wanted ? store.index('kind').getAll(wanted) : store.getAll()
    ), (req) => (req.result || [])
      .slice()
      .sort((a, b) => (a.createdAt - b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((r) => r.id));
  }

  // count(kind) -> Promise<number>. Omit kind to count everything.
  function count(kind) {
    const wanted = kind === undefined ? null : (kind === 'pdf' ? 'pdf' : 'photo');
    return withStore('readonly', 0, (store) => (
      wanted ? store.index('kind').count(wanted) : store.count()
    ), (req) => (typeof req.result === 'number' ? req.result : 0));
  }

  return { put, get, del, list, count };
})();
