/**
 * VAPE WORLD — folder memory.
 *
 * Remembers the backup folder the owner connected, so the shop can keep writing
 * backups into it after a restart without asking again. The handle is kept in
 * the browser's own database (IndexedDB); when that database is switched off
 * (for example inside a sandboxed preview frame) this quietly reports itself as
 * unsupported and the shop falls back to asking each time.
 */
(function () {
  'use strict';

  var DB_NAME = 'vw-folder-memory';
  var STORE = 'handles';
  var KEY = 'backup-folder';

  var supported = (function () {
    try {
      return (
        typeof indexedDB !== 'undefined' &&
        indexedDB !== null &&
        typeof window.showDirectoryPicker === 'function'
      );
    } catch (e) {
      return false;
    }
  })();

  function openDb() {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
      request.onblocked = function () {
        reject(new Error('blocked'));
      };
    });
  }

  function withStore(mode, run) {
    if (!supported) return Promise.resolve(null);
    return openDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, mode);
          var result = run(tx.objectStore(STORE));
          tx.oncomplete = function () {
            db.close();
            resolve(result && 'result' in result ? result.result : null);
          };
          tx.onerror = function () {
            db.close();
            reject(tx.error);
          };
          tx.onabort = function () {
            db.close();
            reject(tx.error);
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  window.VWFolderMemory = {
    supported: supported,

    set: function (handle) {
      if (!handle) return this.clear();
      return withStore('readwrite', function (store) {
        store.put(handle, KEY);
      });
    },

    get: function () {
      return withStore('readonly', function (store) {
        return store.get(KEY);
      }).then(function (handle) {
        if (!handle) return null;
        if (typeof handle.queryPermission !== 'function') return handle;
        return handle
          .queryPermission({ mode: 'readwrite' })
          .then(function (state) {
            return state === 'denied' ? null : handle;
          })
          .catch(function () {
            return handle;
          });
      });
    },

    clear: function () {
      return withStore('readwrite', function (store) {
        store.delete(KEY);
      });
    },
  };
})();
