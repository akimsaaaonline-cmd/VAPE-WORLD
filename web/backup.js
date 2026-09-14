/**
 * VAPE WORLD — Backup panel.
 *
 * Adds a "Backup" button to the vendor panel without touching the shop bundle.
 * It does three things:
 *
 *   1. Server folder backups  — the shop's own data folder on the PC gets an
 *      automatic backup on a timer plus one shortly after any change, and a
 *      "Backup now" button for manual runs.
 *   2. Connected PC folder    — in Chrome/Edge the owner can connect a folder
 *      on this computer; backups are then written straight into it (auto and
 *      manual) and the same folder is read back to offer one-click restore.
 *   3. Plain file backup      — download a single .json backup, or restore the
 *      shop from a .json file.
 */
(function () {
  'use strict';

  var CSS = [
    '.vwb-btn{position:fixed;left:18px;bottom:18px;z-index:2147483000;display:none;align-items:center;gap:8px;',
    'padding:11px 16px;border:0;border-radius:999px;background:#12B886;color:#03251b;font:600 13px/1 var(--vwb-font);',
    'box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer}',
    '.vwb-btn:hover{background:#0FA678}',
    '.vwb-btn[data-show="1"]{display:inline-flex}',
    '.vwb-dot{width:7px;height:7px;border-radius:50%;background:#03251b;opacity:.55}',
    '.vwb-wrap{position:fixed;inset:0;z-index:2147483001;display:none;background:rgba(4,12,16,.62);',
    'backdrop-filter:blur(3px);padding:18px;overflow:auto}',
    '.vwb-wrap[data-open="1"]{display:block}',
    '.vwb-card{max-width:760px;margin:24px auto;background:#0E1A20;color:#E7F1EE;border:1px solid #24363E;',
    'border-radius:16px;font:400 13.5px/1.55 var(--vwb-font);box-shadow:0 30px 80px rgba(0,0,0,.5)}',
    '.vwb-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px;',
    'border-bottom:1px solid #24363E}',
    '.vwb-head h2{margin:0;font-size:16px;font-weight:700;letter-spacing:-.01em}',
    '.vwb-head p{margin:4px 0 0;font-size:12.5px;color:#8FA5A0}',
    '.vwb-x{border:1px solid #2C4048;background:transparent;color:#B9CBC6;width:30px;height:30px;border-radius:8px;',
    'cursor:pointer;font-size:15px;line-height:1;flex:0 0 auto}',
    '.vwb-x:hover{background:#17262D}',
    '.vwb-body{padding:6px 20px 20px}',
    '.vwb-sec{border:1px solid #24363E;border-radius:12px;padding:14px 15px;margin-top:14px;background:#101E25}',
    '.vwb-sec h3{margin:0 0 3px;font-size:13px;font-weight:650;color:#F1F8F6}',
    '.vwb-sec p.vwb-hint{margin:0 0 11px;font-size:12px;color:#8FA5A0}',
    '.vwb-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}',
    '.vwb-stat{background:#0B171D;border:1px solid #22343B;border-radius:10px;padding:9px 11px}',
    '.vwb-stat span{display:block;font-size:11px;color:#829893}',
    '.vwb-stat strong{display:block;margin-top:3px;font-size:13.5px;font-weight:650;word-break:break-word}',
    '.vwb-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:11px}',
    '.vwb-a{border:0;border-radius:9px;padding:9px 13px;font:600 12.5px/1 var(--vwb-font);cursor:pointer;',
    'background:#12B886;color:#03251b}',
    '.vwb-a:hover{background:#0FA678}',
    '.vwb-a.vwb-ghost{background:transparent;border:1px solid #2C4048;color:#CDDDD9}',
    '.vwb-a.vwb-ghost:hover{background:#17262D}',
    '.vwb-a.vwb-danger{background:transparent;border:1px solid #5B2C33;color:#F0A5AD}',
    '.vwb-a.vwb-danger:hover{background:#2A1418}',
    '.vwb-a:disabled{opacity:.5;cursor:not-allowed}',
    '.vwb-field{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#C6D6D2}',
    '.vwb-field input[type=number]{width:78px;background:#0B171D;border:1px solid #2C4048;color:#E7F1EE;',
    'border-radius:8px;padding:7px 9px;font:inherit}',
    '.vwb-switch{display:flex;align-items:center;gap:9px;font-size:12.5px;color:#C6D6D2;cursor:pointer}',
    '.vwb-switch input{width:16px;height:16px;accent-color:#12B886}',
    '.vwb-list{margin:11px 0 0;padding:0;list-style:none;max-height:250px;overflow:auto;border:1px solid #22343B;',
    'border-radius:10px}',
    '.vwb-list li{display:flex;flex-wrap:wrap;align-items:center;gap:8px;justify-content:space-between;',
    'padding:9px 11px;border-bottom:1px solid #1B2C33}',
    '.vwb-list li:last-child{border-bottom:0}',
    '.vwb-list .vwb-meta{min-width:0}',
    '.vwb-list .vwb-meta b{display:block;font:650 12.5px/1.3 var(--vwb-mono);word-break:break-all}',
    '.vwb-list .vwb-meta span{font-size:11.5px;color:#829893}',
    '.vwb-tag{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;padding:3px 7px;border-radius:999px;',
    'background:#17303A;color:#7FC9B4}',
    '.vwb-empty{padding:16px;text-align:center;font-size:12.5px;color:#829893}',
    '.vwb-path{font:400 11.5px/1.5 var(--vwb-mono);color:#7FC9B4;word-break:break-all}',
    '.vwb-note{margin:10px 0 0;font-size:11.5px;color:#829893}',
    '.vwb-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483002;',
    'background:#12B886;color:#03251b;padding:10px 16px;border-radius:10px;font:600 12.5px/1.3 var(--vwb-font);',
    'box-shadow:0 12px 30px rgba(0,0,0,.4);max-width:min(420px,90vw);display:none}',
    '.vwb-toast[data-kind="bad"]{background:#E2596B;color:#2A0A10}',
    '.vwb-toast[data-show="1"]{display:block}',
  ].join('');

  var FONT =
    "'Geist','Inter',system-ui,-apple-system,'Segoe UI',sans-serif";
  var MONO = "'Geist Mono','JetBrains Mono',ui-monospace,monospace";

  var BASE = (function () {
    var base = window.__VW_API__ || '';
    // Same rule the shop bundle uses: "port/9000" is relative to this page.
    if (/^port\/\d+$/.test(base)) base = location.pathname.replace(/[^/]*$/, '') + base;
    return base;
  })();

  var state = {
    adminToken: '',
    status: null,
    folderHandle: null,
    folderName: '',
    localAuto: true,
    localTimer: null,
    busy: false,
  };

  /* ----------------------------------------------------------------- utils */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function bytes(value) {
    var size = Number(value) || 0;
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return (index === 0 ? size : size.toFixed(1)) + ' ' + units[index];
  }

  function when(value) {
    if (!value) return 'never';
    var date = new Date(value);
    if (isNaN(date.getTime())) return 'never';
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function stamp() {
    var d = new Date();
    var p = function (n) {
      return String(n).padStart(2, '0');
    };
    return (
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      '_' + p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds())
    );
  }

  var toastNode;
  var toastTimer;
  function toast(message, kind) {
    if (!toastNode) return;
    toastNode.textContent = message;
    toastNode.setAttribute('data-kind', kind === 'bad' ? 'bad' : 'good');
    toastNode.setAttribute('data-show', '1');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastNode.setAttribute('data-show', '0');
    }, kind === 'bad' ? 6000 : 3200);
  }

  function api(method, url, body) {
    var init = { method: method, headers: { 'x-admin-token': state.adminToken } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(BASE + url, init).then(function (response) {
      return response.text().then(function (raw) {
        var parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_error) {
          parsed = null;
        }
        if (!response.ok) {
          throw new Error((parsed && parsed.message) || raw || response.statusText);
        }
        return parsed;
      });
    });
  }

  /* ------------------ remember the folder the owner picked (folder-memory.js) */

  function rememberFolder(handle) {
    return window.VWFolderMemory
      ? window.VWFolderMemory.set(handle)
      : Promise.resolve();
  }

  function recallFolder() {
    return window.VWFolderMemory ? window.VWFolderMemory.get() : Promise.resolve(null);
  }

  var supportsFolder = typeof window.showDirectoryPicker === 'function';

  function ensurePermission(handle, interactive) {
    if (!handle || !handle.queryPermission) return Promise.resolve(false);
    return handle.queryPermission({ mode: 'readwrite' }).then(function (result) {
      if (result === 'granted') return true;
      if (!interactive) return false;
      return handle.requestPermission({ mode: 'readwrite' }).then(function (next) {
        return next === 'granted';
      });
    });
  }

  /** Write one backup file into the connected PC folder. */
  function writeToFolder(reason) {
    if (!state.folderHandle) return Promise.reject(new Error('No PC folder is connected yet.'));
    return ensurePermission(state.folderHandle, false)
      .then(function (ok) {
        if (!ok) throw new Error('Folder permission was lost — connect the folder again.');
        return api('GET', '/api/admin/backup/export');
      })
      .then(function (snapshot) {
        var name = 'vape-world-backup-' + stamp() + '.json';
        return state.folderHandle
          .getFileHandle(name, { create: true })
          .then(function (fileHandle) {
            return fileHandle.createWritable();
          })
          .then(function (writable) {
            return writable
              .write(JSON.stringify(snapshot, null, 2))
              .then(function () {
                return writable.close();
              });
          })
          .then(function () {
            return pruneFolder();
          })
          .then(function () {
            return { name: name, reason: reason };
          });
      });
  }

  function readFolder() {
    if (!state.folderHandle) return Promise.resolve([]);
    var rows = [];
    return ensurePermission(state.folderHandle, false)
      .then(function (ok) {
        if (!ok) return [];
        var iterate = (async function () {
          for await (var entry of state.folderHandle.values()) {
            if (entry.kind !== 'file') continue;
            if (!/\.json$/i.test(entry.name)) continue;
            var file = await entry.getFile();
            rows.push({ name: entry.name, size: file.size, modified: file.lastModified });
          }
          return rows.sort(function (a, b) {
            return b.modified - a.modified;
          });
        })();
        return iterate;
      })
      .catch(function () {
        return [];
      });
  }

  function pruneFolder() {
    var keep = state.status && state.status.keep ? Number(state.status.keep) : 30;
    return readFolder().then(function (rows) {
      var extra = rows.filter(function (row) {
        return /^vape-world-backup-/i.test(row.name);
      }).slice(keep);
      return Promise.all(
        extra.map(function (row) {
          return state.folderHandle.removeEntry(row.name).catch(function () {});
        }),
      );
    });
  }

  function restoreFromFolderFile(name, mode) {
    return state.folderHandle
      .getFileHandle(name)
      .then(function (handle) {
        return handle.getFile();
      })
      .then(function (file) {
        return file.text();
      })
      .then(function (raw) {
        return api('POST', '/api/admin/backup/import', {
          snapshot: JSON.parse(raw),
          mode: mode || 'replace',
        });
      });
  }

  function startLocalAuto() {
    if (state.localTimer) clearInterval(state.localTimer);
    state.localTimer = null;
    if (!state.folderHandle || !state.localAuto) return;
    var minutes = state.status && state.status.intervalMinutes ? state.status.intervalMinutes : 30;
    state.localTimer = setInterval(function () {
      writeToFolder('auto').then(render).catch(function () {});
    }, Math.max(1, minutes) * 60 * 1000);
  }

  /* -------------------------------------------------------------------- UI */

  var ui = {};

  function build() {
    var style = el('style', { text: CSS.replace(/var\(--vwb-font\)/g, FONT).replace(/var\(--vwb-mono\)/g, MONO) });
    document.head.appendChild(style);

    ui.button = el('button', { class: 'vwb-btn', type: 'button', 'data-show': '0' });
    ui.button.appendChild(el('span', { class: 'vwb-dot' }));
    ui.button.appendChild(el('span', { text: 'Backup & restore' }));
    ui.button.addEventListener('click', open);

    ui.body = el('div', { class: 'vwb-body' });
    var close = el('button', { class: 'vwb-x', type: 'button', text: '×', 'aria-label': 'Close backup panel' });
    close.addEventListener('click', function () {
      ui.wrap.setAttribute('data-open', '0');
    });
    var card = el('div', { class: 'vwb-card' }, [
      el('div', { class: 'vwb-head' }, [
        el('div', {}, [
          el('h2', { text: 'Backup & restore' }),
          el('p', { text: 'Keep a copy of your products, orders and settings in a folder on this PC.' }),
        ]),
        close,
      ]),
      ui.body,
    ]);
    ui.wrap = el('div', { class: 'vwb-wrap', 'data-open': '0' }, [card]);
    ui.wrap.addEventListener('click', function (event) {
      if (event.target === ui.wrap) ui.wrap.setAttribute('data-open', '0');
    });

    toastNode = el('div', { class: 'vwb-toast', 'data-show': '0' });

    document.body.appendChild(ui.button);
    document.body.appendChild(ui.wrap);
    document.body.appendChild(toastNode);
  }

  function open() {
    ui.wrap.setAttribute('data-open', '1');
    refresh();
  }

  function refresh() {
    return api('GET', '/api/admin/backup/status')
      .then(function (status) {
        state.status = status;
        return render();
      })
      .catch(function (error) {
        toast(error.message, 'bad');
      });
  }

  function stat(label, value) {
    return el('div', { class: 'vwb-stat' }, [
      el('span', { text: label }),
      el('strong', { text: String(value) }),
    ]);
  }

  function busyRun(button, work) {
    if (state.busy) return;
    state.busy = true;
    var label = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Working…';
    }
    work()
      .then(function (message) {
        if (message) toast(message);
        return refresh();
      })
      .catch(function (error) {
        toast(error.message, 'bad');
      })
      .then(function () {
        state.busy = false;
        if (button) {
          button.disabled = false;
          button.textContent = label;
        }
      });
  }

  function render() {
    var status = state.status;
    if (!status) return Promise.resolve();
    ui.body.textContent = '';

    /* --- 1. where the shop keeps its data ------------------------------- */
    var overview = el('div', { class: 'vwb-sec' }, [
      el('h3', { text: 'Shop data folder' }),
      el('p', { class: 'vwb-hint', text: 'Everything lives in this one folder — products, orders, pictures and every backup.' }),
      el('p', { class: 'vwb-path', text: status.dataFolder }),
      el('div', { class: 'vwb-grid', style: 'margin-top:11px' }, [
        stat('Products', status.counts.products),
        stat('Orders', status.counts.orders),
        stat('Customers', status.counts.customers),
        stat('Backups kept', status.totalBackups + ' · ' + bytes(status.totalSize)),
        stat('Last backup', when(status.lastBackupAt)),
      ]),
    ]);
    if (status.desktop) {
      var pick = el('button', { class: 'vwb-a', type: 'button', text: 'Change folder…' });
      pick.addEventListener('click', function () {
        busyRun(pick, function () {
          return api('POST', '/api/admin/backup/pick-folder').then(function (result) {
            return result.cancelled ? '' : 'Data folder moved to ' + result.folder;
          });
        });
      });
      var openFolder = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Open in Explorer' });
      openFolder.addEventListener('click', function () {
        api('POST', '/api/admin/backup/open-folder', { which: 'backups' }).catch(function (error) {
          toast(error.message, 'bad');
        });
      });
      overview.appendChild(el('div', { class: 'vwb-row' }, [pick, openFolder]));
    }
    if (status.lastError) {
      overview.appendChild(
        el('p', { class: 'vwb-note', text: 'Last backup problem: ' + status.lastError }),
      );
    }
    ui.body.appendChild(overview);

    /* --- 2. automatic backup ------------------------------------------- */
    var autoBox = el('input', { type: 'checkbox' });
    autoBox.checked = !!status.autoEnabled;
    var changeBox = el('input', { type: 'checkbox' });
    changeBox.checked = !!status.onChange;
    var minutes = el('input', { type: 'number', min: '1', max: '1440', value: String(status.intervalMinutes) });
    var keep = el('input', { type: 'number', min: '1', max: '500', value: String(status.keep) });
    var save = el('button', { class: 'vwb-a', type: 'button', text: 'Save backup settings' });
    save.addEventListener('click', function () {
      busyRun(save, function () {
        return api('POST', '/api/admin/backup/config', {
          autoEnabled: autoBox.checked,
          onChange: changeBox.checked,
          intervalMinutes: Number(minutes.value),
          keep: Number(keep.value),
        }).then(function () {
          startLocalAuto();
          return 'Backup settings saved.';
        });
      });
    });
    var runNow = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Backup now' });
    runNow.addEventListener('click', function () {
      busyRun(runNow, function () {
        var jobs = [api('POST', '/api/admin/backup/run', { reason: 'manual' })];
        if (state.folderHandle) jobs.push(writeToFolder('manual'));
        return Promise.all(jobs).then(function () {
          return 'Backup saved.';
        });
      });
    });
    ui.body.appendChild(
      el('div', { class: 'vwb-sec' }, [
        el('h3', { text: 'Automatic backup' }),
        el('p', { class: 'vwb-hint', text: 'Runs on a timer and again shortly after you add or change anything.' }),
        el('label', { class: 'vwb-switch' }, [autoBox, el('span', { text: 'Back up automatically' })]),
        el('label', { class: 'vwb-switch', style: 'margin-top:8px' }, [
          changeBox,
          el('span', { text: 'Also back up right after a change' }),
        ]),
        el('div', { class: 'vwb-row' }, [
          el('label', { class: 'vwb-field' }, [el('span', { text: 'Every' }), minutes, el('span', { text: 'minutes' })]),
          el('label', { class: 'vwb-field' }, [el('span', { text: 'Keep last' }), keep, el('span', { text: 'backups' })]),
        ]),
        el('div', { class: 'vwb-row' }, [save, runNow]),
      ]),
    );

    /* --- 3. connected PC folder ---------------------------------------- */
    var folderSec = el('div', { class: 'vwb-sec' }, [
      el('h3', { text: 'Connected PC folder' }),
      el('p', {
        class: 'vwb-hint',
        text: supportsFolder
          ? 'Choose one folder on this computer. Backups are written into it automatically and manually, and the same folder is read back so you can restore in one click.'
          : 'Your browser cannot write straight into a folder. Use the desktop app (VAPE WORLD.exe) for that, or download backup files below.',
      }),
    ]);
    if (supportsFolder) {
      folderSec.appendChild(
        el('p', {
          class: 'vwb-path',
          text: state.folderHandle ? 'Connected: ' + state.folderName : 'No folder connected yet.',
        }),
      );
      var connect = el('button', {
        class: 'vwb-a',
        type: 'button',
        text: state.folderHandle ? 'Change folder…' : 'Connect PC folder…',
      });
      connect.addEventListener('click', function () {
        window
          .showDirectoryPicker({ id: 'vapeworld-backups', mode: 'readwrite', startIn: 'documents' })
          .then(function (handle) {
            return ensurePermission(handle, true).then(function (ok) {
              if (!ok) throw new Error('Permission for that folder was not given.');
              state.folderHandle = handle;
              state.folderName = handle.name;
              return rememberFolder(handle).then(function () {
                startLocalAuto();
                toast('Folder connected: ' + handle.name);
                return render();
              });
            });
          })
          .catch(function (error) {
            if (error && error.name === 'AbortError') return;
            toast(error.message, 'bad');
          });
      });
      folderSec.appendChild(el('div', { class: 'vwb-row' }, [connect]));

      if (state.folderHandle) {
        var localAutoBox = el('input', { type: 'checkbox' });
        localAutoBox.checked = state.localAuto;
        localAutoBox.addEventListener('change', function () {
          state.localAuto = localAutoBox.checked;
          startLocalAuto();
          toast(state.localAuto ? 'Auto download to folder is on.' : 'Auto download to folder is off.');
        });
        folderSec.appendChild(
          el('label', { class: 'vwb-switch', style: 'margin-top:10px' }, [
            localAutoBox,
            el('span', { text: 'Auto download a backup into this folder (while the panel stays open)' }),
          ]),
        );

        var saveNow = el('button', { class: 'vwb-a', type: 'button', text: 'Download into folder now' });
        saveNow.addEventListener('click', function () {
          busyRun(saveNow, function () {
            return writeToFolder('manual').then(function (result) {
              return 'Saved ' + result.name + ' into ' + state.folderName + '.';
            });
          });
        });
        var reload = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Read folder' });
        reload.addEventListener('click', function () {
          renderFolderList(folderList);
          toast('Folder re-read.');
        });
        folderSec.appendChild(el('div', { class: 'vwb-row' }, [saveNow, reload]));

        var folderList = el('ul', { class: 'vwb-list' });
        folderSec.appendChild(folderList);
        renderFolderList(folderList);
      }
    }
    ui.body.appendChild(folderSec);

    /* --- 4. backups inside the shop folder ----------------------------- */
    var list = el('ul', { class: 'vwb-list' });
    if (!status.backups.length) {
      list.appendChild(el('li', {}, [el('div', { class: 'vwb-empty', text: 'No backups yet — press "Backup now".' })]));
    }
    status.backups.forEach(function (row) {
      var restore = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Restore' });
      restore.addEventListener('click', function () {
        if (!window.confirm('Replace the current shop data with "' + row.name + '"?')) return;
        busyRun(restore, function () {
          return api('POST', '/api/admin/backup/restore', { name: row.name, mode: 'replace' }).then(function () {
            return 'Restored from ' + row.name + '. Reload the page to see it.';
          });
        });
      });
      var download = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Download' });
      download.addEventListener('click', function () {
        fetch(BASE + '/api/admin/backup/file/' + encodeURIComponent(row.name), {
          headers: { 'x-admin-token': state.adminToken },
        })
          .then(function (response) {
            if (!response.ok) throw new Error('Download failed.');
            return response.blob();
          })
          .then(function (blob) {
            var url = URL.createObjectURL(blob);
            var link = el('a', { href: url, download: row.name + '.json' });
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
          })
          .catch(function (error) {
            toast(error.message, 'bad');
          });
      });
      var remove = el('button', { class: 'vwb-a vwb-danger', type: 'button', text: 'Delete' });
      remove.addEventListener('click', function () {
        if (!window.confirm('Delete backup "' + row.name + '"?')) return;
        busyRun(remove, function () {
          return api('DELETE', '/api/admin/backup/file/' + encodeURIComponent(row.name)).then(function () {
            return 'Backup deleted.';
          });
        });
      });
      list.appendChild(
        el('li', {}, [
          el('div', { class: 'vwb-meta' }, [
            el('b', { text: row.name }),
            el('span', {
              text:
                when(row.createdAt) +
                ' · ' +
                bytes(row.size) +
                (row.counts ? ' · ' + row.counts.products + ' products, ' + row.counts.orders + ' orders' : ''),
            }),
          ]),
          el('div', { class: 'vwb-row', style: 'margin:0' }, [
            el('span', { class: 'vwb-tag', text: row.reason === 'manual' ? 'manual' : 'auto' }),
            restore,
            download,
            remove,
          ]),
        ]),
      );
    });
    ui.body.appendChild(
      el('div', { class: 'vwb-sec' }, [
        el('h3', { text: 'Backups in the shop folder' }),
        el('p', { class: 'vwb-hint', text: 'Newest first. Restore puts the shop back exactly as it was, pictures included.' }),
        list,
      ]),
    );

    /* --- 5. single-file backup ---------------------------------------- */
    var exportBtn = el('button', { class: 'vwb-a', type: 'button', text: 'Download backup file' });
    exportBtn.addEventListener('click', function () {
      fetch(BASE + '/api/admin/backup/export', { headers: { 'x-admin-token': state.adminToken } })
        .then(function (response) {
          return response.blob();
        })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var link = el('a', { href: url, download: 'vape-world-backup-' + stamp() + '.json' });
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          toast('Backup file downloaded.');
        })
        .catch(function (error) {
          toast(error.message, 'bad');
        });
    });
    var file = el('input', { type: 'file', accept: '.json', style: 'display:none' });
    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      if (!window.confirm('Replace the current shop data with "' + chosen.name + '"?')) {
        file.value = '';
        return;
      }
      chosen
        .text()
        .then(function (raw) {
          return api('POST', '/api/admin/backup/import', { snapshot: JSON.parse(raw), mode: 'replace' });
        })
        .then(function () {
          toast('Restored. Reload the page to see it.');
          return refresh();
        })
        .catch(function (error) {
          toast(error.message, 'bad');
        })
        .then(function () {
          file.value = '';
        });
    });
    var importBtn = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Restore from a file…' });
    importBtn.addEventListener('click', function () {
      file.click();
    });
    ui.body.appendChild(
      el('div', { class: 'vwb-sec' }, [
        el('h3', { text: 'Backup file' }),
        el('p', { class: 'vwb-hint', text: 'One .json file with the whole shop inside — good for email, USB or cloud storage.' }),
        el('div', { class: 'vwb-row', style: 'margin-top:0' }, [exportBtn, importBtn, file]),
      ]),
    );

    return Promise.resolve();
  }

  function renderFolderList(target) {
    target.textContent = '';
    target.appendChild(el('li', {}, [el('div', { class: 'vwb-empty', text: 'Reading folder…' })]));
    readFolder().then(function (rows) {
      target.textContent = '';
      if (!rows.length) {
        target.appendChild(
          el('li', {}, [el('div', { class: 'vwb-empty', text: 'No backup files in that folder yet.' })]),
        );
        return;
      }
      rows.slice(0, 40).forEach(function (row) {
        var restore = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Restore' });
        restore.addEventListener('click', function () {
          if (!window.confirm('Replace the current shop data with "' + row.name + '"?')) return;
          busyRun(restore, function () {
            return restoreFromFolderFile(row.name, 'replace').then(function () {
              return 'Restored from ' + row.name + '. Reload the page to see it.';
            });
          });
        });
        target.appendChild(
          el('li', {}, [
            el('div', { class: 'vwb-meta' }, [
              el('b', { text: row.name }),
              el('span', { text: when(new Date(row.modified).toISOString()) + ' · ' + bytes(row.size) }),
            ]),
            el('div', { class: 'vwb-row', style: 'margin:0' }, [el('span', { class: 'vwb-tag', text: 'PC folder' }), restore]),
          ]),
        );
      });
    });
  }

  /* ------------------------------------------- learn the vendor's token */

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var headers = (init && init.headers) || (input && input.headers) || null;
      var token = '';
      if (headers) {
        if (typeof headers.get === 'function') token = headers.get('x-admin-token') || '';
        else token = headers['x-admin-token'] || '';
      }
      if (token && token !== state.adminToken) {
        state.adminToken = token;
        ui.button && ui.button.setAttribute('data-show', '1');
      }
    } catch (_error) {}
    return nativeFetch(input, init);
  };

  function boot() {
    build();
    if (supportsFolder) {
      recallFolder()
        .then(function (handle) {
          if (!handle) return null;
          return ensurePermission(handle, false).then(function (ok) {
            state.folderHandle = handle;
            state.folderName = handle.name + (ok ? '' : ' (needs permission again)');
            startLocalAuto();
            return null;
          });
        })
        .catch(function () {});
    }
    // The vendor panel is the only place the button belongs.
    setInterval(function () {
      if (!state.adminToken) return;
      // The shop may use plain paths (/admin) or hash routes (#/admin).
      var route = location.pathname + ' ' + location.hash;
      ui.button.setAttribute('data-show', route.indexOf('/admin') !== -1 ? '1' : '0');
    }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
