/**
 * VAPE WORLD — Backend console (domain + backend users).
 *
 * Shop bundle ko chhua nahi gaya. Yeh script vendor panel ke andar ek doosra
 * floating button ("Backend") lagati hai jisme do cheezein hain:
 *
 *   1. Live domain — domain save karna, sitemap/robots ke addresses, aur ek
 *      "Check now" button jo bata deta hai ke domain is server par aa raha hai
 *      ya nahi (DNS + HTTPS).
 *   2. Backend users — kaun kaun backend par login kar sakta hai; naya user
 *      add karna, password badalna, hataana.
 *
 * Styling backup.js ki CSS (.vwb-*) se milti hai, is liye index.html mein yeh
 * file backup.js ke BAAD load hoti hai.
 */
(function () {
  'use strict';

  var BASE = window.__VW_API__ || '';

  var EXTRA_CSS = [
    '.vwc-btn{position:fixed;right:18px;bottom:70px;z-index:2147483000;display:none;align-items:center;gap:8px;',
    'padding:11px 16px;border:0;border-radius:999px;background:#1E3A8A;color:#DCE7FF;',
    "font:600 13px/1 'Geist','Inter',system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);cursor:pointer}",
    '.vwc-btn:hover{background:#24479F}',
    '.vwc-btn[data-show="1"]{display:inline-flex}',
    '.vwc-in{width:100%;background:#0B171D;border:1px solid #2C4048;color:#E7F1EE;border-radius:8px;',
    'padding:8px 10px;font:inherit;margin-top:4px}',
    '.vwc-in:focus{outline:none;border-color:#12B886}',
    '.vwc-lab{display:block;font-size:11.5px;color:#829893;margin-top:9px}',
    '.vwc-two{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}',
    '.vwc-kv{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:12px;margin-top:5px}',
    '.vwc-kv dt{width:120px;flex:0 0 auto;color:#829893}',
    ".vwc-kv dd{margin:0;font:400 11.5px/1.5 'Geist Mono',ui-monospace,monospace;color:#7FC9B4;word-break:break-all}",
    '.vwc-ok{color:#7FE3B4}.vwc-bad{color:#F0A5AD}.vwc-warn{color:#F2C879}',
  ].join('');

  var state = { token: '', settings: null, team: [], check: null, busy: false };
  var ui = {};
  var toastNode = null;
  var toastTimer = null;

  /* ------------------------------------------------------------------ utils */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function toast(message, kind) {
    if (!toastNode) return;
    toastNode.textContent = message;
    toastNode.setAttribute('data-kind', kind === 'bad' ? 'bad' : 'ok');
    toastNode.setAttribute('data-show', '1');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastNode.setAttribute('data-show', '0');
    }, 4200);
  }

  function api(method, url, body) {
    var init = { method: method, headers: {} };
    if (state.token) init.headers['x-admin-token'] = state.token;
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(BASE + url, init).then(function (response) {
      return response.text().then(function (raw) {
        var data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch (error) {
          data = null;
        }
        if (!response.ok) {
          throw new Error((data && data.message) || 'Request failed (' + response.status + ')');
        }
        return data;
      });
    });
  }

  /** "vapeworld.pk" → "https://vapeworld.pk" (sirf dikhane ke liye) */
  function asBase(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var full = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    return full.replace(/\/+$/, '');
  }

  /* --------------------------------------------------------------- the panel */

  function build() {
    document.head.appendChild(el('style', { text: EXTRA_CSS }));

    ui.button = el('button', { class: 'vwc-btn', type: 'button', 'data-show': '0' });
    ui.button.appendChild(el('span', { text: 'Backend' }));
    ui.button.addEventListener('click', open);

    ui.body = el('div', { class: 'vwb-body' });
    var close = el('button', { class: 'vwb-x', type: 'button', text: '×', 'aria-label': 'Close backend panel' });
    close.addEventListener('click', function () {
      ui.wrap.setAttribute('data-open', '0');
    });
    var card = el('div', { class: 'vwb-card' }, [
      el('div', { class: 'vwb-head' }, [
        el('div', {}, [
          el('h2', { text: 'Domain & backend users' }),
          el('p', { text: 'Save the domain the shop should go live on, and manage who can log in to the backend.' }),
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
    return Promise.all([api('GET', '/api/admin/settings'), api('GET', '/api/admin/team')])
      .then(function (results) {
        state.settings = results[0];
        state.team = results[1] || [];
        render();
      })
      .catch(function (error) {
        toast(error.message, 'bad');
      });
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

  function kv(rows) {
    var list = el('dl', { class: 'vwc-kv-wrap' });
    rows.forEach(function (row) {
      var line = el('div', { class: 'vwc-kv' }, [
        el('dt', { text: row[0] }),
        el('dd', { class: row[2] || '', text: String(row[1]) }),
      ]);
      list.appendChild(line);
    });
    return list;
  }

  /* -------------------------------------------------------------- rendering */

  function render() {
    ui.body.textContent = '';
    ui.body.appendChild(domainSection());
    ui.body.appendChild(statusSection());
    ui.body.appendChild(teamSection());
    ui.body.appendChild(addSection());
  }

  function domainSection() {
    var settings = state.settings || {};
    var domainInput = el('input', {
      class: 'vwc-in',
      type: 'text',
      placeholder: 'https://vapeworld.pk',
      value: settings.siteDomain || '',
    });
    var extraInput = el('input', {
      class: 'vwc-in',
      type: 'text',
      placeholder: 'www.vapeworld.pk, vapeworld.com.pk',
      value: settings.extraDomains || '',
    });

    var save = el('button', { class: 'vwb-a', type: 'button', text: 'Save domain' });
    save.addEventListener('click', function () {
      busyRun(save, function () {
        return api('PUT', '/api/admin/settings', {
          siteDomain: domainInput.value.trim(),
          extraDomains: extraInput.value.trim(),
        }).then(function () {
          return 'Domain saved. Website, app aur sitemap sab isi domain ko use karenge.';
        });
      });
    });

    var check = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'Check if it is live' });
    check.addEventListener('click', function () {
      busyRun(check, function () {
        return api('GET', '/api/admin/site/check').then(function (result) {
          state.check = result;
          return '';
        });
      });
    });

    return el('div', { class: 'vwb-sec' }, [
      el('h3', { text: 'Live domain' }),
      el('p', {
        class: 'vwb-hint',
        text:
          'Yahan domain save karein. Phir website, sitemap, social preview aur phone app — sab isi domain par chalenge.',
      }),
      el('div', { class: 'vwc-two' }, [
        el('label', { class: 'vwc-lab', text: 'Live domain' }),
        el('label', { class: 'vwc-lab', text: 'Other domains that point here' }),
      ]),
      el('div', { class: 'vwc-two' }, [domainInput, extraInput]),
      el('div', { class: 'vwb-row' }, [save, check]),
      el('p', {
        class: 'vwb-note',
        text:
          'Domain apne panel (GoDaddy / Namecheap / PK NIC) mein jaa kar A record apne server ke IP par point karein — phir "Check if it is live" dabayein.',
      }),
    ]);
  }

  function statusSection() {
    var settings = state.settings || {};
    var base = asBase(settings.siteDomain) || window.location.origin;
    var rows = [
      ['Live site', base],
      ['Sitemap', base + '/sitemap.xml'],
      ['Robots', base + '/robots.txt'],
      ['Local address', settings.localUrl || 'http://localhost:5000'],
    ];
    var children = [
      el('h3', { text: 'Status' }),
      el('p', {
        class: 'vwb-hint',
        text: 'Sitemap aur robots.txt live products se khud banti hain — Google Search Console mein sitemap ka address daal dein.',
      }),
      kv(rows),
    ];

    var result = state.check;
    if (result) {
      var dns = result.domainIps && result.domainIps.length ? result.domainIps.join(', ') : 'not found';
      var reach = result.reachable ? (result.https ? 'yes, with HTTPS' : 'yes, but HTTP only') : 'no';
      children.push(
        el('div', { style: 'margin-top:12px;border-top:1px solid #22343B;padding-top:10px' }, [
          kv([
            ['Checked at', new Date(result.checkedAt).toLocaleString()],
            ['This server IP', (result.serverIps || []).join(', ') || 'unknown'],
            ['Domain points to', dns, result.pointsHere === false ? 'vwc-bad' : result.pointsHere ? 'vwc-ok' : 'vwc-warn'],
            ['Shop answers there', reach, result.reachable ? (result.https ? 'vwc-ok' : 'vwc-warn') : 'vwc-bad'],
          ]),
        ]),
      );
      (result.notes || []).forEach(function (note) {
        children.push(el('p', { class: 'vwb-note', text: '• ' + note }));
      });
    }

    return el('div', { class: 'vwb-sec' }, children);
  }

  function teamSection() {
    var list = el('ul', { class: 'vwb-list' });
    if (!state.team.length) {
      list.appendChild(el('li', {}, [el('div', { class: 'vwb-empty', text: 'No backend users.' })]));
    }
    state.team.forEach(function (member) {
      var meta = el('div', { class: 'vwb-meta' }, [
        el('b', { text: member.email }),
        el('span', {
          text:
            (member.name || 'Team member') +
            ' • ' +
            (member.role || 'owner') +
            (member.isYou ? ' • signed in now' : ''),
        }),
      ]);

      var reset = el('button', { class: 'vwb-a vwb-ghost', type: 'button', text: 'New password' });
      reset.addEventListener('click', function () {
        var next = window.prompt('New password for ' + member.email + ' (at least 6 characters):');
        if (!next) return;
        busyRun(reset, function () {
          return api('PATCH', '/api/admin/team/' + member.id, { password: next }).then(function () {
            return 'Password updated for ' + member.email;
          });
        });
      });

      var remove = el('button', { class: 'vwb-a vwb-danger', type: 'button', text: 'Remove' });
      remove.addEventListener('click', function () {
        if (!window.confirm('Remove backend access for ' + member.email + '?')) return;
        busyRun(remove, function () {
          return api('DELETE', '/api/admin/team/' + member.id).then(function () {
            return member.email + ' ka backend access hata diya gaya.';
          });
        });
      });

      var tags = el('div', { class: 'vwb-row', style: 'margin:0' }, [
        member.isDeveloper ? el('span', { class: 'vwb-tag', text: 'developer' }) : null,
        member.isYou ? el('span', { class: 'vwb-tag', text: 'you' }) : null,
        reset,
        remove,
      ]);

      list.appendChild(el('li', {}, [meta, tags]));
    });

    return el('div', { class: 'vwb-sec' }, [
      el('h3', { text: 'Backend users' }),
      el('p', {
        class: 'vwb-hint',
        text: 'Yeh sab backend par login kar sakte hain aur data (products, orders, settings) badal sakte hain.',
      }),
      list,
    ]);
  }

  function addSection() {
    var name = el('input', { class: 'vwc-in', type: 'text', placeholder: 'Name' });
    var email = el('input', { class: 'vwc-in', type: 'email', placeholder: 'name@example.com' });
    var pass = el('input', { class: 'vwc-in', type: 'text', placeholder: 'at least 6 characters' });
    var role = el('input', { class: 'vwc-in', type: 'text', placeholder: 'staff / developer / owner' });

    var add = el('button', { class: 'vwb-a', type: 'button', text: 'Add backend user' });
    add.addEventListener('click', function () {
      busyRun(add, function () {
        return api('POST', '/api/admin/team', {
          name: name.value.trim(),
          email: email.value.trim(),
          password: pass.value,
          role: role.value.trim() || 'staff',
        }).then(function (created) {
          name.value = '';
          email.value = '';
          pass.value = '';
          role.value = '';
          return created.email + ' ab backend par login kar sakta hai.';
        });
      });
    });

    return el('div', { class: 'vwb-sec' }, [
      el('h3', { text: 'Add someone' }),
      el('p', { class: 'vwb-hint', text: 'Naya backend user — rights owner ke barabar hote hain.' }),
      el('div', { class: 'vwc-two' }, [
        el('label', { class: 'vwc-lab', text: 'Name' }),
        el('label', { class: 'vwc-lab', text: 'Email' }),
      ]),
      el('div', { class: 'vwc-two' }, [name, email]),
      el('div', { class: 'vwc-two' }, [
        el('label', { class: 'vwc-lab', text: 'Password' }),
        el('label', { class: 'vwc-lab', text: 'Role label' }),
      ]),
      el('div', { class: 'vwc-two' }, [pass, role]),
      el('div', { class: 'vwb-row' }, [add]),
    ]);
  }

  /* --------------------------------------------------- token + route sniffing */

  // backup.js jaise hi: fetch ko lapet kar admin token pakar lete hain, bundle
  // ke andar haath dalne ki zaroorat nahi.
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      var headers = (init && init.headers) || (input && input.headers);
      if (headers) {
        var token =
          typeof headers.get === 'function' ? headers.get('x-admin-token') : headers['x-admin-token'];
        if (token) state.token = token;
      }
    } catch (error) {
      /* ignore */
    }
    return nativeFetch(input, init);
  };

  function onAdminRoute() {
    var where = window.location.pathname + ' ' + window.location.hash;
    return where.indexOf('/admin') !== -1;
  }

  function tick() {
    if (!ui.button) return;
    var show = onAdminRoute() && Boolean(state.token);
    ui.button.setAttribute('data-show', show ? '1' : '0');
    if (!show && ui.wrap) ui.wrap.setAttribute('data-open', '0');
  }

  function start() {
    build();
    setInterval(tick, 700);
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
