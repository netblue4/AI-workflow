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
    if (opts.icon) {
      const iconEl = el('span', 'wiz-item-icon');
      iconEl.innerHTML = opts.icon === true ? _RISK_ICON : opts.icon;
      hLeft.appendChild(iconEl);
    }
    hLeft.appendChild(el('span', 'wiz-item-name', { textContent: opts.title }));

    const hRight = document.createElement('div');
    hRight.className = 'wiz-collapsible-header-right';
    if (opts.artId) {
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

  // ---- EU AI Act articles (replaces tbl_AI_Articles.json) -----------
  const ARTICLES = [
    { pk_AI_Article_ID: 'ART-001', article_name: 'Article 13: Transparency and Provision of Information to Deployers', short_name: 'Transparency' },
    { pk_AI_Article_ID: 'ART-002', article_name: 'Article 14: Human Oversight', short_name: 'Human Oversight' },
    { pk_AI_Article_ID: 'ART-003', article_name: 'Article 15: Accuracy, Robustness and Cybersecurity', short_name: 'Accuracy & Robustness' },
    { pk_AI_Article_ID: 'ART-004', article_name: 'Article 10: Data and Data Governance', short_name: 'Data Governance' },
    { pk_AI_Article_ID: 'ART-005', article_name: 'Article 12: Record-Keeping', short_name: 'Record-Keeping' },
    { pk_AI_Article_ID: 'ART-006', article_name: 'Article 17: Quality Management System', short_name: 'Quality Management' },
    { pk_AI_Article_ID: 'ART-007', article_name: 'Article 9: Risk Management System', short_name: 'Risk Management' },
    { pk_AI_Article_ID: 'ART-008', article_name: 'Article 11: Technical Documentation', short_name: 'Technical Documentation' },
    { pk_AI_Article_ID: 'ART-009', article_name: 'Article 25: Substantial Modification', short_name: 'Substantial Modification' },
    { pk_AI_Article_ID: 'ART-010', article_name: 'Article 26: Deployer Obligations', short_name: 'Deployer Obligations' },
    { pk_AI_Article_ID: 'ART-011', article_name: 'Article 43: Conformity Assessment', short_name: 'Conformity Assessment' },
    { pk_AI_Article_ID: 'ART-012', article_name: 'Article 50: Transparency Obligations for Certain AI Systems', short_name: 'AI Transparency' },
    { pk_AI_Article_ID: 'ART-013', article_name: 'Article 72: Post-Market Monitoring', short_name: 'Post-Market Monitoring' },
    { pk_AI_Article_ID: 'ART-014', article_name: 'Article 5: Prohibited AI Practices', short_name: 'Prohibited Practices' },
    { pk_AI_Article_ID: 'ART-015', article_name: 'Article 6: Classification of High-Risk AI Systems', short_name: 'High-Risk Classification' },
    { pk_AI_Article_ID: 'ART-016', article_name: 'Article 16: Obligations for Providers of High-Risk AI Systems', short_name: 'Provider Obligations' },
  ];
  const ARTICLES_BY_ID = new Map(ARTICLES.map(a => [a.pk_AI_Article_ID, a]));

  function artLabel(artId) {
    const art = ARTICLES_BY_ID.get(artId);
    if (!art) return '';
    const m = art.article_name.match(/^(Article \d+[a-zA-Z]*)/);
    return m ? `${m[1]} · ${art.short_name}` : art.short_name;
  }

  // ---- Step completion ------------------------------------------------
  // A step counts as complete when it has a saved record. Step 5 is special:
  // its record exists before the legal assessment is finished, so we key off
  // the completion flag instead.
  function isStepComplete(stepId, record) {
    const rec = record || loadRecord();
    if (stepId === 'step-5') return !!(rec && rec['step-5'] && rec['step-5'].legal_assessment && rec['step-5'].legal_assessment.completed);
    return !!(rec && rec[stepId]);
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
.wiz-tab-strip{display:flex;gap:4px;padding:16px 24px 0;border-bottom:1px solid var(--color-border);background:var(--color-bg);flex-shrink:0}
.wiz-tab{padding:8px 16px;font-size:13px;font-weight:500;border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;color:var(--color-text-secondary);margin-bottom:-1px;transition:color .15s,border-color .15s}
.wiz-tab--active{color:var(--teal-600,#0d9488);border-bottom-color:var(--teal-600,#0d9488)}
.wiz-pane-wrap{flex:1;overflow-y:auto}
.wiz-pane{min-height:100%}
.wiz-pane--hidden{display:none}
.wiz-action-row{display:flex;align-items:center;justify-content:space-between;padding:16px 0;border-top:1px solid var(--color-border);margin-top:24px;gap:12px;flex-wrap:wrap}
.wiz-btn-primary{padding:9px 20px;background:var(--teal-600,#0d9488);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.wiz-btn-primary:hover{background:var(--teal-700,#0f766e)}
.wiz-btn-secondary{padding:9px 20px;background:transparent;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-weight:500;cursor:pointer}
.wiz-btn-secondary:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz-attest{border:1px solid var(--color-border,#e2e8f0);border-radius:var(--radius-md,8px);padding:16px 18px;margin:20px 24px;background:var(--color-bg-subtle,#f8fafc)}
.wiz-attest--done{border-color:#86efac;background:#f0fdf4}
.wiz-attest-title{font-size:13px;font-weight:700;color:var(--color-text-primary);margin-bottom:12px}
.wiz-attest-check{display:flex;align-items:flex-start;gap:10px;font-size:13px;color:var(--color-text-primary);cursor:pointer;line-height:1.5;margin-bottom:14px}
.wiz-attest-check input{margin-top:2px;width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--teal-600,#0d9488)}
.wiz-attest-field{display:flex;flex-direction:column;gap:4px;margin-bottom:14px;max-width:340px}
.wiz-attest-label{font-size:11px;font-weight:600;color:var(--color-text-secondary)}
.wiz-attest-input{padding:8px 11px;border:1px solid var(--color-border-mid,#cbd5e1);border-radius:6px;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface,#fff)}
.wiz-attest-footer{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.wiz-attest-status{font-size:12px;font-weight:600}
.wiz-attest-status--ok{color:#15803d}
.wiz-attest-status--err{color:#b91c1c}
`);
  injectStyles('wiz-collapsible-styles', `
.wiz-collapsible-section{border:1px solid var(--color-border);border-radius:var(--radius-md,6px);overflow:hidden;margin-bottom:20px}
.wiz-collapsible-header{padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:10px}
.wiz-collapsible-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz-collapsible-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.wiz-collapsible-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.wiz-collapsible-body{padding:14px 16px;border-top:1px solid var(--color-border)}
.wiz-item-icon{display:flex;color:#ef4444;flex-shrink:0}
.wiz-item-name{font-size:13px;font-weight:700;color:var(--color-text-primary);min-width:0}
.wiz-art-tag{font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:#dbeafe;color:#1e40af;white-space:nowrap;flex-shrink:0;letter-spacing:.02em}
.wiz-item-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center;flex-shrink:0}
.wiz-item-badge--ok{background:#dcfce7;color:#15803d}
.wiz-item-badge--partial{background:#fef3c7;color:#b45309}
.wiz-item-badge--none{background:#fee2e2;color:#b91c1c}
.wiz-item-badge--na{background:var(--color-bg-subtle,#f1f5f9);color:var(--color-text-tertiary)}
.wiz-item-badge--info{background:#dbeafe;color:#1e40af}
.wiz-gate-chevron{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
`);

  return { el, sectionLabel, loadRecord, saveRecord, copyToClipboard, injectStyles, buildTabStrip, buildCollapsible, buildDeliverablesList, buildAttestation, fetchAll, ARTICLES, ARTICLES_BY_ID, artLabel, fmtStdRef, STD_REF_PREFIX, isStepComplete };
})();
