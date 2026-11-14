/* ICAI VERA bridge for CAAT Tools.
 *
 * Loaded after the tool's own script when caat-tools.html is embedded in the
 * VERA CAAT Tools page. It saves and restores the workspace through the host
 * page (which owns the database connection) using postMessage. It reads the
 * tool's globals (S, profSnap, TBYID, ...) and calls the tool's own functions
 * to rebuild the state; it does not change how any test, sample or export
 * works. The only wrapped function is addFiles, which is wrapped to keep a copy
 * of each loaded file's bytes so the file can be saved with the engagement.
 *
 * Saved: source files, sheet selection, layout/clean-up/mapping settings, row
 * filters, test parameters, which tests were run, the sampling plan (seed
 * included) and the audited values / control results / remarks entered.
 * Results are re-computed on open from the saved files and settings, which
 * gives the same test results and the same sample.
 *
 * When the page is opened on its own (not inside VERA) the bridge does nothing.
 */
(function () {
  'use strict';
  if (window.parent === window) return;

  var host = window.parent;
  var targetOrigin = location.protocol === 'file:' ? '*' : location.origin;
  var post = function (msg) { host.postMessage(msg, targetOrigin); };

  var bytes = new Map();      // file key -> { name, kind, buf }
  var persisted = new Set();  // file keys already stored in the database
  var ready = false;          // restore finished, autosave allowed
  var restoring = false;
  var saving = false;
  var lastJson = '';
  var pendingJson = '';
  var retryAt = 0;

  var keyOf = function (hash, name) { return hash + '|' + name; };
  var kindOf = function (name) { return /\.(csv|txt|tsv)$/i.test(name) ? 'csv' : 'xlsx'; };

  /* ---- keep file bytes (behaviour of addFiles is unchanged) ---- */
  var toolAddFiles = addFiles;
  addFiles = async function (list) {
    var arr = Array.prototype.slice.call(list);
    for (var i = 0; i < arr.length; i++) {
      try {
        var buf = await arr[i].arrayBuffer();
        var h = await sha256(buf);
        bytes.set(keyOf(h, arr[i].name), { name: arr[i].name, kind: kindOf(arr[i].name), buf: buf });
      } catch (e) { /* the tool reports unreadable files itself */ }
    }
    return toolAddFiles(list);
  };

  /* ---- snapshot of what the auditor has set and entered ---- */
  function iso(d) { try { return d ? new Date(d).toISOString() : null; } catch (e) { return null; } }
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  function snapshot() {
    var demo = S.files.length === 1 && S.files[0].id === 'demo';
    var files = demo ? [] : S.files.map(function (f) { return { key: keyOf(f.hash, f.name), name: f.name, kind: f.kind }; });
    var results = {};
    Object.keys(S.results || {}).forEach(function (id) { if (S.results[id]) results[id] = iso(S.results[id].at); });
    var samp = null;
    if (S.samp) {
      samp = {
        p: S.samp.p,
        audit: S.samp.audit || {},
        dev: S.samp.dev || {},
        rem: S.samp.rem || {},
        hasRes: !!S.samp.res,
        at: S.samp.res ? iso(S.samp.res.at) : null
      };
    }
    return {
      v: 1,
      ent: { eEnt: val('eEnt'), ePer: val('ePer'), ePrep: val('ePrep') },
      demo: demo,
      files: files,
      partsOn: S.parts.map(function (p) { return !!p.on; }),
      cfg: profSnap(),
      mapped: !!S.mapped,
      params: S.params || {},
      view: S.view,
      results: results,
      samp: samp
    };
  }

  /* ---- autosave ---- */
  function tick() {
    if (!ready || restoring || saving || Date.now() < retryAt) return;
    var st;
    try { st = snapshot(); } catch (e) { return; }
    var json = JSON.stringify(st);
    if (json === lastJson) return;
    var files = st.files
      .filter(function (f) { return !persisted.has(f.key) && bytes.has(f.key); })
      .map(function (f) {
        var b = bytes.get(f.key);
        return { key: f.key, name: f.name, kind: f.kind, sha256: f.key.split('|')[0], buf: b.buf };
      });
    saving = true;
    pendingJson = json;
    post({ type: 'caat:save', state: st, files: files, keep: st.files.map(function (f) { return f.key; }) });
  }
  var soon = null;
  function tickSoon() { clearTimeout(soon); soon = setTimeout(tick, 400); }
  setInterval(tick, 1500);
  ['change', 'click', 'input', 'drop'].forEach(function (ev) { document.addEventListener(ev, tickSoon, true); });

  /* ---- restore ---- */
  function setEnt(id, v) {
    var e = document.getElementById(id);
    if (!e || v == null) return;
    e.value = v;
    try { localStorage.setItem('caat_' + id, v); } catch (x) { /* not needed */ }
  }

  function rerunSample(saved) {
    var p = S.samp.p;
    var res;
    if (p.useSeed === false) {
      // Re-perform with the seed that was drawn for the saved run.
      var seed0 = p.seed;
      p.useSeed = true;
      p.seed = p._seedUsed;
      try { res = spRun(); } finally { p.useSeed = false; p.seed = seed0; }
      res.useSeed = false;
      res.plan = spPlan(p, { txt: res.calcTxt });
    } else {
      res = spRun();
    }
    if (saved.at) res.at = new Date(saved.at);
    S.samp.res = res;
  }

  async function restore(st, files, defaults) {
    restoring = true;
    var notes = [];
    try {
      if (!st) {
        // New workspace for this engagement: start from the engagement details.
        setEnt('eEnt', defaults.eEnt || '');
        setEnt('ePer', defaults.ePer || '');
        setEnt('ePrep', defaults.ePrep || '');
        render();
        return;
      }
      setEnt('eEnt', st.ent && st.ent.eEnt);
      setEnt('ePer', st.ent && st.ent.ePer);
      setEnt('ePrep', st.ent && st.ent.ePrep);

      if (st.demo) {
        demoData();
      } else if (st.files && st.files.length) {
        var byKey = new Map(files.map(function (f) { return [f.key, f]; }));
        var list = [];
        st.files.forEach(function (f) {
          var c = byKey.get(f.key);
          if (c) list.push(new File([c.buf], f.name));
          else notes.push(f.name);
        });
        S.files = []; S.parts = [];
        if (list.length) await addFiles(list);
        byKey.forEach(function (_, k) { persisted.add(k); });
      }

      if (S.parts.length) {
        (st.partsOn || []).forEach(function (on, i) { if (S.parts[i]) S.parts[i].on = on; });
        if (!S.parts.some(function (p) { return p.on; })) S.parts[0].on = true;
        if (st.cfg) profApply(st.cfg); else buildRows(false);
        S.err.data = notes.length ? 'These saved files could not be found and were not loaded: ' + notes.join(', ') : '';

        if (st.mapped) {
          S.params = JSON.parse(JSON.stringify(st.params || {}));
          applyMap();
          if (S.mapped) {
            Object.keys(st.results || {}).forEach(function (id) {
              var t = TBYID[id];
              if (!t) return;
              runTest(t, true);
              if (S.results[id] && st.results[id]) S.results[id].at = new Date(st.results[id]);
            });
            if (st.samp) {
              S.samp = { p: st.samp.p, res: null, audit: st.samp.audit || {}, dev: st.samp.dev || {}, rem: st.samp.rem || {}, err: '' };
              if (st.samp.hasRes) {
                try { rerunSample(st.samp); } catch (e) { S.samp.err = 'The saved sample could not be re-selected: ' + (e.message || e); }
              }
            }
            S.view = st.view || 'overview';
          }
        }
      }
      render();
      toast('Saved CAAT workspace restored');
    } catch (e) {
      post({ type: 'caat:error', message: 'Could not restore the saved workspace: ' + (e.message || e) });
      try { render(); } catch (x) { /* ignore */ }
    } finally {
      restoring = false;
      try { lastJson = JSON.stringify(snapshot()); } catch (e) { lastJson = ''; }
      ready = true;
    }
  }

  /* ---- messages from the VERA page ---- */
  window.addEventListener('message', function (ev) {
    if (ev.source !== host) return;
    var m = ev.data || {};
    if (m.type === 'caat:init') {
      restore(m.state || null, m.files || [], m.defaults || {});
    } else if (m.type === 'caat:saved') {
      saving = false;
      if (m.ok) {
        lastJson = pendingJson;
        (m.keys || []).forEach(function (k) { persisted.add(k); });
        var keep = new Set(m.keep || []);
        persisted.forEach(function (k) { if (!keep.has(k)) persisted.delete(k); });
      } else {
        retryAt = Date.now() + 10000;
      }
    }
  });

  post({ type: 'caat:ready' });
})();
