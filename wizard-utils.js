// wizard-utils.js — shared DOM helpers and UI primitives for all step wizards
window.WizUtils = (function () {
  'use strict';

  // ---- DOM helper -----------------------------------------------------
  // Full version: supports optional props object, with style handled as cssText
  function el(tag, cls, props) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (props) Object.entries(props).forEach(([k, v]) => {
      if (k === 'style') e.style.cssText = v; else e[k] = v;
    });
    return e;
  }

  function sectionLabel(text) {
    return el('p', 'section-label', { textContent: text });
  }

  // ---- sessionStorage -------------------------------------------------
  function loadRecord() {
    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      return s ? JSON.parse(s) : {};
    } catch (_) { return {}; }
  }

  function saveRecord(record) {
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(record)); } catch (_) {}
    // Let the shell refresh anything that reflects completion state (e.g. the
    // nav step icons that turn green once a step is complete).
    try { window.dispatchEvent(new CustomEvent('record-saved')); } catch (_) {}
  }

  // ---- Clipboard ------------------------------------------------------
  function copyToClipboard(text, btn) {
    const label = btn.textContent;
    const done = () => {
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = label; }, 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    }
  }

  // ---- Style injection ------------------------------------------------
  function injectStyles(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id; style.textContent = css;
    document.head.appendChild(style);
  }

  // ---- Tab strip ------------------------------------------------------
  // tabs: array of [id, label] pairs
  // onSwitch: function(id) called when a tab button is clicked
  // Uses wiz-tab--active (modern pattern used by steps 4-7)
  function buildTabStrip(tabs, onSwitch) {
    const strip = document.createElement('div');
    strip.className = 'wiz-tab-strip';
    tabs.forEach(([id, lbl], i) => {
      const btn = document.createElement('button');
      btn.className = 'wiz-tab' + (i === 0 ? ' wiz-tab--active' : '');
      btn.dataset.tab = id; btn.textContent = lbl;
      btn.addEventListener('click', () => onSwitch(id));
      strip.appendChild(btn);
    });
    return strip;
  }

  const _RISK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  // ---- Collapsible section --------------------------------------------
  // opts: { title, icon?, artId?, sectionClass?, headerClass?, bodyClass?, chevronClass?, body? }
  // icon: true = standard risk warning triangle; or pass an SVG string
  // artId: pk_AI_Article_ID — renders a wiz-art-tag chip in header-right
  function buildCollapsible(opts) {
    const section = document.createElement('div');
    section.className = opts.sectionClass || 'wiz-collapsible-section';

    const header = document.createElement('div');
    header.className = opts.headerClass || 'wiz-collapsible-header';

    const hLeft = document.createElement('div');
    hLeft.className = 'wiz-collapsible-header-left';
    if (opts.number) {
      hLeft.appendChild(el('span', 'wiz-item-num', { textContent: opts.number }));
    }
    if (opts.icon) {
      const iconEl = el('span', 'wiz-item-icon');
      iconEl.innerHTML = opts.icon === true ? _RISK_ICON : opts.icon;
      hLeft.appendChild(iconEl);
    }
    hLeft.appendChild(el('span', 'wiz-item-name', { textContent: opts.title }));
    // Article tag can sit inline next to the name (left) or on the right.
    if (opts.artId && opts.artInline) {
      hLeft.appendChild(el('span', 'wiz-art-tag', { textContent: artLabel(opts.artId) }));
    }

    const hRight = document.createElement('div');
    hRight.className = 'wiz-collapsible-header-right';
    if (opts.artId && !opts.artInline) {
      hRight.appendChild(el('span', 'wiz-art-tag', { textContent: artLabel(opts.artId) }));
    }
    const chevron = document.createElement('span');
    chevron.className = opts.chevronClass || 'wiz-gate-chevron';
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const bodyEl = document.createElement('div');
    bodyEl.className = opts.bodyClass || 'wiz-collapsible-body';
    bodyEl.style.display = 'none';
    if (opts.body) bodyEl.appendChild(opts.body);
    section.appendChild(bodyEl);

    header.addEventListener('click', () => {
      const open = bodyEl.style.display !== 'none';
      bodyEl.style.display = open ? 'none' : '';
      chevron.style.transform = open ? '' : 'rotate(-180deg)';
    });

    return { section, bodyEl };
  }

  // ---- EU AI Act articles (tbl_AI_Articles.json) --------------------
  // The article table is the source of truth. ARTICLES / ARTICLES_BY_ID are
  // kept as a mutable array + map, hydrated once at startup via loadArticles(),
  // so the many synchronous consumers (artLabel, buildStepHeader, the step
  // wizards, the report, the framework mapping) keep working unchanged.
  const ARTICLES = [];
  const ARTICLES_BY_ID = new Map();

  function loadArticles() {
    return fetch('tbl_AI_Articles.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}: tbl_AI_Articles.json`); return r.json(); })
      .then(list => {
        ARTICLES.length = 0;
        ARTICLES_BY_ID.clear();
        (list || []).forEach(a => { ARTICLES.push(a); ARTICLES_BY_ID.set(a.pk_AI_Article_ID, a); });
        return ARTICLES;
      });
  }

  function artLabel(artId) {
    const art = ARTICLES_BY_ID.get(artId);
    if (!art) return '';
    const m = art.article_name.match(/^(Article \d+[a-zA-Z]*)/);
    return m ? `${m[1]} · ${art.short_name}` : art.short_name;
  }

  // ---- Internal Standard (SR) controls (tbl_AI_SR_Controls.json) -------
  // Hydrated once at startup like the article table, and indexed by the steps
  // each control applies to (its workflow_steps array). buildStepHeader reads
  // SR_BY_STEP synchronously to render the per-step "internal standard checklist".
  const SR_CONTROLS = [];
  const SR_BY_STEP = new Map(); // step-id → SR control rows

  function loadSrControls() {
    return fetch('tbl_AI_SR_Controls.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}: tbl_AI_SR_Controls.json`); return r.json(); })
      .then(list => {
        SR_CONTROLS.length = 0;
        SR_BY_STEP.clear();
        (list || []).forEach(c => {
          SR_CONTROLS.push(c);
          (c.workflow_steps || []).forEach(sid => {
            if (!SR_BY_STEP.has(sid)) SR_BY_STEP.set(sid, []);
            SR_BY_STEP.get(sid).push(c);
          });
        });
        return SR_CONTROLS;
      })
      .catch(() => SR_CONTROLS); // header degrades gracefully if the table is unavailable
  }

  // Applicable SR controls for a step, ordered by control number.
  function srControlsForStep(stepId) {
    return (SR_BY_STEP.get(stepId) || [])
      .slice()
      .sort((a, b) => (a.control_number || 0) - (b.control_number || 0));
  }

  // ---- Harmonised standard reference formatting ---------------------
  // These standards are not yet confirmed, so refs are displayed with a
  // provisional "PRN" prefix to avoid implying they are accepted ISO
  // standards. Once accepted, change STD_REF_PREFIX to 'ISO' in this one
  // place and every display site updates.
  const STD_REF_PREFIX = 'PRN';
  function fmtStdRef(raw) {
    if (raw == null || raw === '') return '';
    return String(raw)
      .split(',')
      .map(s => s.trim().replace(/^\[+|\]+$/g, '').trim())
      .filter(Boolean)
      .map(s => `${STD_REF_PREFIX} ${s}`)
      .join(', ');
  }

  // ---- Shared async JSON loader -------------------------------------
  // Returns an array parallel to urls; null for any fetch/parse failure.
  async function fetchAll(urls) {
    const results = await Promise.allSettled(urls.map(u => fetch(u)));
    return Promise.all(results.map(r =>
      r.status === 'fulfilled' && r.value.ok ? r.value.json().catch(() => null) : null
    ));
  }

  // ---- Deliverables list ----------------------------------------------
  function buildDeliverablesList(deliverables) {
    const dl = document.createElement('ul');
    dl.className = 'deliverables-list';
    (deliverables || []).forEach(d => {
      const li = document.createElement('li');
      li.className = 'deliverable-item';
      li.innerHTML = `<span class="deliverable-icon">${typeof ICONS !== 'undefined' ? ICONS.check : ''}</span><span>${d}</span>`;
      dl.appendChild(li);
    });
    return dl;
  }

  // ---- Standard step title section ------------------------------------
  // Full-width header shared by every step. Reads its content from the step's
  // workflow.json entry. Layout: phase eyebrow, "number — title", owners,
  // Summary (deliverables-style box), Deliverables, Gates and Notes.
  function buildStepHeader(step, colorKey, phaseTitle) {
    const icons = (typeof ICONS !== 'undefined') ? ICONS : (typeof window !== 'undefined' && window.ICONS) || {};
    const sec = el('div', 'step-title-section');

    if (phaseTitle) sec.appendChild(el('p', 'step-detail-phase-label', { textContent: phaseTitle }));
    sec.appendChild(el('h1', 'step-detail-title step-title-lg', { textContent: `${step.number} — ${step.title}` }));

    // Everything else (meta, summary, deliverables, gates, requirement labels)
    // lives in a details block that is collapsed by default, so each step reads
    // as just its title until the assessor chooses to expand the context.
    const body = el('div', 'step-header-body');
    body.style.display = 'none';

    const meta = el('div', 'step-detail-meta');
    const owner = el('span', 'owner-tag');
    owner.innerHTML = `${icons[step.ownerIcon] || ''}&nbsp;${(step.owners || []).join(', ')}`;
    meta.appendChild(owner);
    (step.requirements || []).forEach(r => meta.appendChild(el('span', 'badge sr', { textContent: r })));
    if (step.applicability) meta.appendChild(el('span', `badge ${step.applicabilityKey || 'all'}`, { textContent: step.applicability }));
    body.appendChild(meta);

    // internal standard checklist — the SR controls this step discharges, sourced
    // from tbl_AI_SR_Controls.json (workflow_steps). Ref + name per row; the
    // csa_checklist_item is revealed on click (and shown as a hover tooltip).
    const srControls = srControlsForStep(step.id);
    if (srControls.length) {
      body.appendChild(sectionLabel('internal standard checklist'));
      const list = el('ul', 'sr-todo-list');
      srControls.forEach(c => {
        const li = el('li', 'sr-todo-item');
        const row = el('button', 'sr-todo-row', { type: 'button' });
        row.title = c.csa_checklist_item || '';
        const ref = el('span', 'sr-todo-ref', { textContent: `${c.groupstandard_ref || c.pk_SR_Control_ID}` });
        const name = el('span', 'sr-todo-name', { textContent: c.control_name || '' });
        const chev = el('span', 'sr-todo-chev');
        chev.innerHTML = '<svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        row.append(ref, name, chev);
        const csa = el('p', 'sr-todo-csa');
        csa.textContent = c.csa_checklist_item || 'No checklist item defined.';
        csa.style.display = 'none';
        row.addEventListener('click', () => {
          const open = csa.style.display === 'none';
          csa.style.display = open ? '' : 'none';
          chev.style.transform = open ? 'rotate(180deg)' : '';
        });
        li.append(row, csa);
        list.appendChild(li);
      });
      body.appendChild(list);
    }

    if (step.gates && step.gates.length) {
      body.appendChild(sectionLabel('Gates and Notes'));
      step.gates.forEach(g => {
        const n = el('div', `gate-note ${g.type || 'info'}`);
        n.innerHTML = g.text;
        body.appendChild(n);
      });
    }

    // Only add the toggle when there is something to reveal.
    if (body.childElementCount > 1 || (meta.childElementCount > 0)) {
      const toggle = el('button', 'step-header-toggle', { type: 'button' });
      toggle.setAttribute('aria-expanded', 'false');
      const label   = el('span', 'step-header-toggle-label', { textContent: 'Show group standard checklist' });
      const chevron = el('span', 'step-header-chevron');
      chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      toggle.append(label, chevron);
      toggle.addEventListener('click', () => {
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        chevron.style.transform = open ? 'rotate(180deg)' : '';
        label.textContent = open ? 'Hide group standard checklist' : 'Show group standard checklist';
        toggle.setAttribute('aria-expanded', String(open));
      });
      sec.appendChild(toggle);
      sec.appendChild(body);
    }

    return sec;
  }

  // ---- Digital attestation block --------------------------------------
  // A lightweight "complete this step without uploading evidence" control.
  // Checkbox + name + Save writes a digital record to _record[stepId], which
  // the report's Internal Standard Compliance section reads as evidence.
  // opts: { stepId, title?, statement, nameLabel?, onChange? }
  function buildAttestation(opts) {
    const wrap = el('div', 'wiz-attest');
    wrap.appendChild(el('div', 'wiz-attest-title', { textContent: opts.title || 'Confirm completion' }));

    const cbRow = el('label', 'wiz-attest-check');
    const cb = el('input', null, { type: 'checkbox' });
    cbRow.append(cb, el('span', null, { textContent: opts.statement }));
    wrap.appendChild(cbRow);

    const field = el('div', 'wiz-attest-field');
    field.appendChild(el('label', 'wiz-attest-label', { textContent: opts.nameLabel || 'Name' }));
    const nameInput = el('input', 'wiz-attest-input', { type: 'text', placeholder: 'Full name' });
    field.appendChild(nameInput);
    wrap.appendChild(field);

    const footer = el('div', 'wiz-attest-footer');
    const btn = el('button', 'wiz-btn-primary', { textContent: 'Save confirmation' });
    const status = el('span', 'wiz-attest-status');
    footer.append(btn, status);
    wrap.appendChild(footer);

    function paint() {
      const r = loadRecord()[opts.stepId];
      if (r && r.attested) {
        wrap.classList.add('wiz-attest--done');
        status.className = 'wiz-attest-status wiz-attest-status--ok';
        status.textContent = `✓ Recorded — ${r.attested_by || '—'}, ${(r.attested_at || '').slice(0, 10)}`;
      } else {
        wrap.classList.remove('wiz-attest--done');
        status.className = 'wiz-attest-status';
        status.textContent = '';
      }
    }

    // Hydrate from any existing record
    const rec0 = loadRecord();
    const r0 = rec0[opts.stepId];
    cb.checked = !!(r0 && r0.attested);
    nameInput.value = (r0 && r0.attested_by) || (rec0._meta && rec0._meta.assessed_by) || '';
    paint();

    btn.addEventListener('click', () => {
      const rec = loadRecord();
      if (cb.checked) {
        const name = nameInput.value.trim();
        if (!name) {
          status.className = 'wiz-attest-status wiz-attest-status--err';
          status.textContent = 'Enter a name to confirm.';
          nameInput.focus();
          return;
        }
        rec[opts.stepId] = {
          step_id: opts.stepId,
          attested: true,
          attested_by: name,
          attested_at: new Date().toISOString()
        };
      } else {
        delete rec[opts.stepId];
      }
      if (!rec._meta) rec._meta = {
        schema_version: '1.0',
        title: 'AI Acceptable Use — System Authorisation Record',
        standard: 'ISO/IEC 42001-aligned',
        created: new Date().toISOString()
      };
      rec._meta.last_modified = new Date().toISOString();
      saveRecord(rec);
      paint();
      if (opts.onChange) opts.onChange(cb.checked);
    });

    return wrap;
  }

  injectStyles('wiz-shared-styles', `
.wiz-shell{display:flex;flex-direction:column;height:100%}
.step-header-toggle{display:inline-flex;align-items:center;gap:7px;margin-top:12px;padding:5px 0;background:none;border:none;cursor:pointer;color:var(--color-text-tertiary);font-family:inherit;font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase}
.step-header-toggle:hover{color:var(--color-text-secondary)}
.step-header-chevron{display:flex;align-items:center;transition:transform .2s}
.step-header-body{margin-top:14px}
.sr-todo-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.sr-todo-item{border:1px solid var(--color-border);border-radius:var(--radius-md,6px);overflow:hidden;background:var(--color-bg-subtle,#211d15)}
.sr-todo-row{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;background:none;border:none;cursor:pointer;text-align:left;font-family:inherit;color:var(--color-text-primary)}
.sr-todo-row:hover{background:var(--color-bg-hover,#262219)}
.sr-todo-ref{flex-shrink:0;font-family:var(--font-mono);font-size:11px;font-weight:600;color:#ecd489;background:rgba(212,184,96,0.16);border-radius:4px;padding:2px 8px;white-space:nowrap}
.sr-todo-name{flex:1;min-width:0;font-size:13px;font-weight:500}
.sr-todo-chev{flex-shrink:0;display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
.sr-todo-csa{margin:0;padding:0 12px 11px 12px;font-size:12.5px;line-height:1.6;color:var(--color-text-secondary)}
.step-header-body>.step-summary-box:last-child,.step-header-body>.req-list:last-child,.step-header-body>.gate-note:last-child{margin-bottom:0}
.wiz-tab-strip{display:flex;gap:4px;padding:16px 24px 0;border-bottom:1px solid var(--color-border);background:var(--color-bg);flex-shrink:0}
.wiz-tab{padding:8px 16px;font-size:13px;font-weight:500;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;color:var(--color-text-secondary);margin-bottom:-1px;transition:color .15s,border-color .15s}
.wiz-tab--active{color:var(--teal-600,#8ce3c6);border-bottom-color:var(--teal-600,#8ce3c6)}
.wiz-pane-wrap{flex:1;overflow-y:auto}
.wiz-pane{min-height:100%}
.wiz-pane--hidden{display:none}
.wiz-action-row{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-top:1px solid var(--color-border);margin-top:24px;gap:12px;flex-wrap:wrap}
.wiz-btn-primary{padding:9px 20px;background:var(--teal-600,#8ce3c6);color:#241d08;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.wiz-btn-primary:hover{background:var(--teal-700,#8ce3c6)}
.wiz-btn-secondary{padding:9px 20px;background:transparent;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-weight:500;cursor:pointer}
.wiz-btn-secondary:hover{background:var(--color-bg-hover,#262219)}
.wiz-attest{border:1px solid var(--color-border,#2e2a1f);border-radius:var(--radius-md,8px);padding:16px 18px;margin:20px 24px;background:var(--color-bg-subtle,#211d15)}
.wiz-attest--done{border-color:#86efac;background:rgba(52,199,120,0.10)}
.wiz-attest-title{font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:12px}
.wiz-attest-check{display:flex;align-items:flex-start;gap:10px;font-size:13px;color:var(--color-text-primary);cursor:pointer;line-height:1.5;margin-bottom:14px}
.wiz-attest-check input{margin-top:2px;width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--teal-600,#8ce3c6)}
.wiz-attest-field{display:flex;flex-direction:column;gap:4px;margin-bottom:14px;max-width:340px}
.wiz-attest-label{font-size:11px;font-weight:600;color:var(--color-text-secondary)}
.wiz-attest-input{padding:8px 11px;border:1px solid var(--color-border-mid,rgba(240,232,208,0.30));border-radius:6px;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface,#fff)}
.wiz-attest-footer{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.wiz-attest-status{font-size:12px;font-weight:600}
.wiz-attest-status--ok{color:#8cebb0}
.wiz-attest-status--err{color:#fba4a3}
`);
  injectStyles('wiz-collapsible-styles', `
.wiz-collapsible-section{border:1px solid var(--color-border);border-radius:var(--radius-md,6px);overflow:hidden;margin-bottom:20px}
.wiz-collapsible-header{padding:12px 16px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:10px}
.wiz-collapsible-header:hover{background:var(--color-bg-hover,#262219)}
.wiz-collapsible-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.wiz-collapsible-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.wiz-collapsible-body{padding:14px 16px;border-top:1px solid var(--color-border)}
.wiz-item-icon{display:flex;color:#ec6a68;flex-shrink:0}
.wiz-item-num{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--color-text-secondary);background:var(--color-bg-subtle);border:1px solid var(--color-border);border-radius:4px;padding:2px 7px;white-space:nowrap;flex-shrink:0}
.wiz-item-name{font-size:13px;font-weight:700;color:var(--color-text-primary);min-width:0}
.wiz-art-tag{font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(80,150,225,0.16);color:#a4ccf6;white-space:nowrap;flex-shrink:0;letter-spacing:.02em}
.wiz-item-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center;flex-shrink:0}
.wiz-item-badge--ok{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz-item-badge--partial{background:rgba(212,184,96,0.16);color:#ecd489}
.wiz-item-badge--none{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz-item-badge--na{background:var(--color-bg-subtle,#262219);color:var(--color-text-tertiary)}
.wiz-item-badge--info{background:rgba(80,150,225,0.16);color:#a4ccf6}
.wiz-gate-chevron{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
`);

  return { el, sectionLabel, loadRecord, saveRecord, copyToClipboard, injectStyles, buildTabStrip, buildCollapsible, buildDeliverablesList, buildStepHeader, buildAttestation, fetchAll, ARTICLES, ARTICLES_BY_ID, loadArticles, artLabel, fmtStdRef, STD_REF_PREFIX, SR_CONTROLS, SR_BY_STEP, loadSrControls, srControlsForStep };
})();
