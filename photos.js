'use strict';

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
  const DB_VERSION = 2; // v2 added the kind_createdAt index
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
      // Written so it works both on a fresh database and on one that already
      // has the store from an earlier version — every piece is created only if
      // it is missing.
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.objectStoreNames.contains(STORE)
          ? req.transaction.objectStore(STORE)
          : db.createObjectStore(STORE, { keyPath: 'id' });
        // 'kind' answers count(); 'kind_createdAt' answers list() in the order
        // the photos were taken, straight from the index — no record has to be
        // deserialized (and no blob read off disk) just to sort ids.
        if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind', { unique: false });
        if (!store.indexNames.contains('kind_createdAt')) store.createIndex('kind_createdAt', ['kind', 'createdAt'], { unique: false });
      };
      req.onsuccess = () => {
        const db = req.result;
        // A connection can die under the app: iOS evicts storage, the user
        // clears site data, another tab upgrades the schema. Drop the cached
        // promise so the next call opens a fresh connection instead of
        // failing forever against a closed one.
        db.onclose = () => { dbPromise = null; };
        db.onversionchange = () => { try { db.close(); } catch (e) { /* already closing */ } dbPromise = null; };
        resolve(db);
      };
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

  // delMany(ids) -> Promise<boolean>. One transaction for the whole set, so
  // deleting an area's photos is atomic: either they all go or none do, and a
  // half-cleared area can never be left behind. Ids that aren't there are fine.
  function delMany(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return Promise.resolve(true);
    const clean = ids.filter((id) => typeof id === 'string' && id);
    if (clean.length === 0) return Promise.resolve(true);
    return openDb().then((db) => {
      if (!db) return false;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
        let tx;
        try {
          tx = db.transaction(STORE, 'readwrite');
        } catch (e) {
          finish(false);
          return;
        }
        tx.onabort = () => finish(false);
        tx.onerror = () => finish(false);
        tx.oncomplete = () => finish(true);
        try {
          const store = tx.objectStore(STORE);
          clean.forEach((id) => store.delete(id));
        } catch (e) {
          finish(false);
        }
      });
    }).catch(() => false);
  }

  // list(kind) -> Promise<string[]> of ids, oldest first. Omit kind for all.
  // The per-kind path reads primary keys out of the compound index in index
  // order, so nothing is sorted in JS and no blobs are loaded. The all-kinds
  // path (rare, no single index spans it) still reads records and sorts.
  function list(kind) {
    const wanted = kind === undefined ? null : (kind === 'pdf' ? 'pdf' : 'photo');
    if (wanted) {
      return withStore('readonly', [], (store) => store.index('kind_createdAt').getAllKeys(
        IDBKeyRange.bound([wanted, -Infinity], [wanted, Infinity])
      ), (req) => req.result || []);
    }
    return withStore('readonly', [], (store) => store.getAll(), (req) => (req.result || [])
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

  return { put, get, del, delMany, list, count };
})();
