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

  // ---- Plain-language glossary (Wave 2) -------------------------------
  // Jargon gets a dotted underline + hover definition so non-practitioners
  // aren't bounced by acronyms. glossify() wraps the FIRST occurrence of each
  // term inside a mounted panel; longest terms match first.
  const GLOSSARY = [
    { key: 'special',    term: 'special category data',     ci: true,  def: 'Sensitive personal data (health, biometric, etc.) with extra protection under GDPR Article 9.' },
    { key: 'presumption',term: 'presumption of conformity', ci: true,  def: 'The law assumes you comply with a requirement once you implement the relevant harmonised standard.' },
    { key: 'conformity', term: 'conformity assessment',     ci: true,  def: 'The formal check that your system meets the EU AI Act’s requirements before it is deployed.' },
    { key: 'harmonised', term: 'harmonised standards',      ci: true,  def: 'EU-approved technical standards. Following them gives a legal presumption that you meet the law.' },
    { key: 'nist',       term: 'NIST AI RMF',               ci: false, def: 'A voluntary US framework for identifying and managing AI risks; complements the EU AI Act.' },
    { key: 'residual',   term: 'residual risk',             ci: true,  def: 'The risk that remains after your controls have been applied.' },
    { key: 'inherent',   term: 'inherent risk',             ci: true,  def: 'The risk before any controls are applied.' },
    { key: 'lawful',     term: 'lawful basis',              ci: true,  def: 'The legal ground (GDPR Article 6) that permits you to process personal data.' },
    { key: 'annex3',     term: 'Annex III',                 ci: false, def: 'The EU AI Act’s list of high-risk uses — e.g. employment, credit, essential services, law enforcement.' },
    { key: 'confab',     term: 'confabulation',             ci: true,  def: 'An AI stating a confident, plausible, but false answer — a hallucination.' },
    { key: 'dpia',       term: 'DPIA',                      ci: false, def: 'Data Protection Impact Assessment — the privacy risk check the GDPR requires before high-risk processing of personal data.' },
    { key: 'dpo',        term: 'DPO',                       ci: false, def: 'Data Protection Officer — the person accountable for data-protection compliance.' },
    { key: 'deployer',   term: 'deployer',                  ci: true,  def: 'The organisation that uses an AI system under its own authority (rather than building it).' },
    { key: 'provider',   term: 'provider',                  ci: true,  def: 'The organisation that builds or substantially modifies an AI system.' }
  ].map(g => ({ ...g, re: new RegExp('\\b' + g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', g.ci ? 'i' : '') }))
   .sort((a, b) => b.term.length - a.term.length);

  function glossify(root) {
    if (!root || !root.ownerDocument) return;
    const reject = ['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'ABBR', 'CODE', 'OPTION', 'BUTTON', 'H1'];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentNode;
        if (!p || reject.includes(p.nodeName)) return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('.wiz-term, .no-glossify, .momentum-bar, button, input, textarea')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
    // Idempotent: skip terms already wrapped, so glossify() is safe to call
    // more than once on the same panel (e.g. for async-rendered content).
    const used = new Set();
    root.querySelectorAll && root.querySelectorAll('abbr.wiz-term[data-gk]').forEach(a => used.add(a.dataset.gk));
    nodes.forEach(node => {
      for (const g of GLOSSARY) {
        if (used.has(g.key)) continue;
        const m = g.re.exec(node.nodeValue);
        if (!m) continue;
        used.add(g.key);
        const after = node.splitText(m.index);
        after.nodeValue = after.nodeValue.slice(m[0].length);
        const ab = el('abbr', 'wiz-term', { title: g.def, textContent: m[0] });
        ab.dataset.gk = g.key;
        after.parentNode.insertBefore(ab, after);
        break; // one term per text node
      }
    });
  }

  // ---- Per-step "Why this step?" plain-language purpose (Wave 2) -------
  const STEP_WHY = {
    'step-1':  'Confirms the person requesting the AI has done basic risk-awareness training, so they can make sensible calls in the steps that follow.',
    'step-2':  'Captures what the system actually does. Everything downstream — the classification, the risks, the controls — is derived from this description, so it is worth getting right.',
    'step-3':  'Works out how tightly the EU AI Act regulates this system (prohibited, high-risk, limited, or minimal). That risk class decides which obligations apply.',
    'step-4':  'Runs the privacy check the GDPR requires before processing personal data, and records the safeguards you have in place.',
    'step-5':  'Identifies which risks actually apply to your system — from the law, NIST, privacy, and your internal standards — in one list.',
    'step-6':  'Selects the controls that treat each applicable risk. These are the concrete things you must do to make the system safe.',
    'step-7':  'Checks whether each control’s evidence is in place, and what risk remains after the controls are applied.',
    'step-8':  'Pulls everything into the formal report: the evidence a regulator would want, and the sign-off decision to deploy.',
    'step-9':  'Records the obligations the people using this system must follow day-to-day.',
    'step-10': 'Records the obligations the people using this system must follow day-to-day.',
    'step-11': 'Registers the use case in the central AI inventory so it is tracked and not forgotten.',
    'step-12': 'Sets the schedule for reviewing this system as it — and the law — changes over time.'
  };

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

    // "Why this step?" — plain-language purpose, so a non-practitioner sees the
    // point of the step without needing it explained in person.
    const why = STEP_WHY[step.id];
    if (why) {
      const wrap = el('div', 'step-why');
      const btn = el('button', 'step-why-btn', { type: 'button' });
      btn.innerHTML = '<span class="step-why-q">?</span> Why this step?';
      const p = el('p', 'step-why-text', { textContent: why });
      p.style.display = 'none';
      btn.addEventListener('click', () => {
        const open = p.style.display === 'none';
        p.style.display = open ? '' : 'none';
        btn.classList.toggle('is-open', open);
      });
      wrap.append(btn, p);
      sec.appendChild(wrap);
    }

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
      const label   = el('span', 'step-header-toggle-label', { textContent: 'Show step details' });
      const chevron = el('span', 'step-header-chevron');
      chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      toggle.append(label, chevron);
      toggle.addEventListener('click', () => {
        const open = body.style.display === 'none';
        body.style.display = open ? '' : 'none';
        chevron.style.transform = open ? 'rotate(180deg)' : '';
        label.textContent = open ? 'Hide step details' : 'Show step details';
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
.wiz-term{border-bottom:1px dotted var(--color-text-tertiary);cursor:help;text-decoration:none;color:inherit}
.step-why{margin:4px 0 2px}
.step-why-btn{display:inline-flex;align-items:center;gap:6px;background:none;border:none;padding:2px 0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:500;color:var(--teal-600,#8ce3c6)}
.step-why-btn:hover{color:var(--teal-700,#a7ecd4)}
.step-why-q{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--teal-100,rgba(93,202,165,0.18));color:var(--teal-700,#8ce3c6);font-size:10px;font-weight:700}
.step-why-btn.is-open{color:var(--color-text-secondary)}
.step-why-text{margin:8px 0 0;max-width:70ch;font-size:12.5px;line-height:1.6;color:var(--color-text-secondary);background:var(--teal-50,rgba(93,202,165,0.08));border-left:3px solid var(--teal-400,#5dcaa5);border-radius:0 6px 6px 0;padding:10px 14px}
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
/* Shared Approve & Save block (all steps) */
.wiz-save-block{margin:24px 0 0;border-top:1px solid var(--color-border);padding-top:16px}
.wiz-save-row{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.wiz-save-btn{font-size:13px}
.wiz-save-summary{margin-top:14px;border:1px solid rgba(52,199,120,0.4);background:rgba(52,199,120,0.08);border-radius:8px;padding:14px 16px}
.wiz-save-summary-title{font-size:13px;font-weight:700;color:#8cebb0;margin-bottom:10px}
.wiz-save-summary-stats{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:8px}
.wiz-save-stat{display:flex;flex-direction:column;gap:2px}
.wiz-save-stat-num{font-size:20px;font-weight:700;color:var(--color-text-primary)}
.wiz-save-stat-lbl{font-size:11px;color:var(--color-text-tertiary)}
.wiz-save-summary-note{font-size:12.5px;line-height:1.6;color:var(--color-text-secondary);margin:0}
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

  // Shared "Approve & Save" block for every step: a right-aligned primary button
  // (consistent label + CSS) plus a summary panel that renders what was saved.
  // opts: { label?, secondary?:{label,onClick}, onSave: () => ({title, stats:[[n,label]], note}) | null }
  // onSave returns a summary descriptor to display, or null to show nothing
  // (e.g. on a validation failure the handler surfaces its own message).
  function buildSaveBlock(opts) {
    opts = opts || {};
    const wrap = el('div', 'wiz-save-block');
    const row  = el('div', 'wiz-save-row');
    if (opts.secondary) {
      const sb = el('button', 'wiz-btn-secondary', { type: 'button', textContent: opts.secondary.label });
      sb.addEventListener('click', opts.secondary.onClick);
      row.appendChild(sb);
    }
    const btn = el('button', 'wiz-btn-primary wiz-save-btn', { type: 'button', textContent: opts.label || 'Approve & Save' });
    row.appendChild(btn);
    wrap.appendChild(row);
    const summary = el('div', 'wiz-save-summary'); summary.style.display = 'none';
    wrap.appendChild(summary);
    function renderSummary(res) {
      summary.innerHTML = '';
      if (!res) { summary.style.display = 'none'; return; }
      summary.style.display = '';
      summary.appendChild(el('div', 'wiz-save-summary-title', { textContent: res.title || 'Saved ✓' }));
      if (Array.isArray(res.stats) && res.stats.length) {
        const stats = el('div', 'wiz-save-summary-stats');
        res.stats.forEach(([num, lbl]) => {
          const s = el('div', 'wiz-save-stat');
          s.appendChild(el('span', 'wiz-save-stat-num', { textContent: String(num) }));
          s.appendChild(el('span', 'wiz-save-stat-lbl', { textContent: lbl }));
          stats.appendChild(s);
        });
        summary.appendChild(stats);
      }
      if (res.note) { const n = el('p', 'wiz-save-summary-note'); n.innerHTML = res.note; summary.appendChild(n); }
      // A caller can supply a DOM node (res.el) to embed in the summary — used to
      // render the exact conformity-report section for this step.
      if (res.el instanceof Node) summary.appendChild(res.el);
      try { summary.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
    }
    btn.addEventListener('click', () => {
      let res = null;
      try { res = opts.onSave ? opts.onSave() : null; } catch (e) { res = { title: 'Save failed', note: String((e && e.message) || e) }; }
      if (res && typeof res.then === 'function') res.then(renderSummary); else renderSummary(res);
    });
    return { el: wrap, button: btn, renderSummary };
  }

  // ---- StepDIV: the one panel every step section uses ------------------
  // A gold-bordered collapsible card, styled like the Assessment-home rows:
  // a title on the left, a status/progress chip in the right corner, and a
  // chevron. Collapsed by default; the body opens to reveal a short one-line
  // description followed by the section's content. Using this everywhere is
  // what makes the steps read as one calm, consistent screen.
  // opts: { title, description?, status?, statusKind?, num?, open?, body?, id? }
  //   statusKind: 'done' | 'todo' | 'progress' | 'info' | 'muted'
  // Returns { el, body, header, setStatus(text,kind), open(), close() }.
  function buildStepPanel(opts) {
    opts = opts || {};
    const panel = el('div', 'wiz-panel');
    if (opts.id) panel.id = opts.id;

    const header = el('button', 'wiz-panel-head', { type: 'button' });
    const hLeft = el('div', 'wiz-panel-head-left');
    if (opts.num != null) hLeft.appendChild(el('span', 'wiz-panel-num', { textContent: String(opts.num) }));
    hLeft.appendChild(el('span', 'wiz-panel-title', { textContent: opts.title || '' }));
    const hRight = el('div', 'wiz-panel-head-right');
    const statusEl = el('span', 'wiz-panel-status');
    const chev = el('span', 'wiz-panel-chev');
    chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.append(statusEl, chev);
    header.append(hLeft, hRight);

    const body = el('div', 'wiz-panel-body');
    if (opts.description) body.appendChild(el('p', 'wiz-panel-desc', { textContent: opts.description }));
    const content = el('div', 'wiz-panel-content');
    if (opts.body) content.appendChild(opts.body);
    body.appendChild(content);

    panel.append(header, body);

    function setOpen(open) {
      body.style.display = open ? '' : 'none';
      panel.classList.toggle('is-open', open);
    }
    setOpen(!!opts.open);
    header.addEventListener('click', () => setOpen(body.style.display === 'none'));

    function setStatus(text, kind) {
      statusEl.textContent = text || '';
      statusEl.className = 'wiz-panel-status' + (kind ? ' wiz-panel-status--' + kind : '');
      statusEl.style.display = text ? '' : 'none';
    }
    setStatus(opts.status, opts.statusKind);

    return { el: panel, body: content, header, setStatus, open: () => setOpen(true), close: () => setOpen(false) };
  }

  injectStyles('wiz-panel-styles', `
.wiz-panel{border:1px solid rgba(212,184,96,0.34);border-radius:10px;margin-bottom:12px;background:var(--color-surface,#1c1810);overflow:hidden;transition:border-color .15s}
.wiz-panel:hover{border-color:rgba(212,184,96,0.5)}
.wiz-panel.is-open{border-color:rgba(212,184,96,0.62)}
.wiz-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:14px 18px;background:none;border:none;cursor:pointer;text-align:left;font-family:inherit;color:inherit}
.wiz-panel-head:hover{background:rgba(212,184,96,0.05)}
.wiz-panel-head-left{display:flex;align-items:center;gap:11px;min-width:0}
.wiz-panel-num{width:24px;height:24px;flex-shrink:0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:var(--font-mono);background:rgba(212,184,96,0.16);color:#ecd489}
.wiz-panel-title{font-size:14.5px;font-weight:700;color:var(--color-text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis}
.wiz-panel-head-right{display:flex;align-items:center;gap:12px;flex-shrink:0}
.wiz-panel-status{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 10px;border-radius:10px;white-space:nowrap}
.wiz-panel-status--done{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz-panel-status--todo{background:var(--color-bg);color:var(--color-text-tertiary);border:1px solid var(--color-border)}
.wiz-panel-status--progress{background:rgba(212,184,96,0.16);color:#ecd489}
.wiz-panel-status--info{background:rgba(80,150,225,0.16);color:#a4ccf6}
.wiz-panel-status--muted{background:var(--color-bg-subtle,#211d15);color:var(--color-text-tertiary)}
.wiz-panel-chev{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
.wiz-panel.is-open .wiz-panel-chev{transform:rotate(180deg)}
.wiz-panel-body{padding:0 18px 18px;border-top:1px solid rgba(212,184,96,0.16)}
.wiz-panel-desc{font-size:12.5px;line-height:1.6;color:var(--color-text-secondary);margin:14px 0 2px;max-width:78ch}
.wiz-panel-content{margin-top:14px}
.wiz-panel-content>.wiz-collapsible-section:last-child,.wiz-panel-content>*:last-child{margin-bottom:0}
/* Section intro line used at the top of a panel's content (replaces scattered coloured summary boxes) */
.wiz-panel-lead{font-size:12.5px;line-height:1.6;color:var(--color-text-secondary);margin:0 0 14px;max-width:78ch}
/* "⚙ Step N" chip naming the workflow step that meets a requirement */
.wiz-wf-step{font-size:10.5px;font-weight:600;background:rgba(212,184,96,0.16);color:#ecd489;border-radius:5px;padding:2px 8px;white-space:nowrap;margin-left:auto}
`);

  return { el, sectionLabel, loadRecord, saveRecord, copyToClipboard, injectStyles, buildTabStrip, buildCollapsible, buildStepPanel, buildDeliverablesList, buildStepHeader, buildAttestation, buildSaveBlock, glossify, fetchAll, ARTICLES, ARTICLES_BY_ID, loadArticles, artLabel, fmtStdRef, STD_REF_PREFIX, SR_CONTROLS, SR_BY_STEP, loadSrControls, srControlsForStep };
})();
