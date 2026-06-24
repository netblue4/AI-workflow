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

  // ---- Collapsible section --------------------------------------------
  // opts: { title, subtitle?, sectionClass?, headerClass?, bodyClass?, chevronClass?, body? }
  function buildCollapsible(opts) {
    const section = document.createElement('div');
    section.className = opts.sectionClass || 'wiz-collapsible-section';

    const header = document.createElement('div');
    header.className = opts.headerClass || 'wiz-collapsible-header';

    const hLeft = document.createElement('div');
    hLeft.className = 'wiz-collapsible-header-left';
    const titleEl = el('p', 'section-label', { style: 'margin-bottom:2px', textContent: opts.title });
    hLeft.appendChild(titleEl);
    if (opts.subtitle) {
      const subEl = document.createElement('p');
      subEl.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0';
      subEl.textContent = opts.subtitle;
      hLeft.appendChild(subEl);
    }

    const hRight = document.createElement('div');
    hRight.className = 'wiz-collapsible-header-right';
    const chevron = document.createElement('span');
    chevron.className = opts.chevronClass || 'wiz-collapsible-chevron';
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
    { pk_AI_Article_ID: 'ART-001', article_name: 'Article 13: Transparency and Provision of Information to Deployers' },
    { pk_AI_Article_ID: 'ART-002', article_name: 'Article 14: Human Oversight' },
    { pk_AI_Article_ID: 'ART-003', article_name: 'Article 15: Accuracy, Robustness and Cybersecurity' },
    { pk_AI_Article_ID: 'ART-004', article_name: 'Article 10: Data and Data Governance' },
    { pk_AI_Article_ID: 'ART-005', article_name: 'Article 12: Record-Keeping' },
    { pk_AI_Article_ID: 'ART-006', article_name: 'Article 17: Quality Management System' },
    { pk_AI_Article_ID: 'ART-007', article_name: 'Article 9: Risk Management System' },
    { pk_AI_Article_ID: 'ART-008', article_name: 'Article 11: Technical Documentation' },
    { pk_AI_Article_ID: 'ART-009', article_name: 'Article 25: Substantial Modification' },
    { pk_AI_Article_ID: 'ART-010', article_name: 'Article 26: Deployer Obligations' },
    { pk_AI_Article_ID: 'ART-011', article_name: 'Article 43: Conformity Assessment' },
    { pk_AI_Article_ID: 'ART-012', article_name: 'Article 50: Transparency Obligations for Certain AI Systems' },
    { pk_AI_Article_ID: 'ART-013', article_name: 'Article 72: Post-Market Monitoring' },
    { pk_AI_Article_ID: 'ART-014', article_name: 'Article 5: Prohibited AI Practices' },
    { pk_AI_Article_ID: 'ART-015', article_name: 'Article 6: Classification of High-Risk AI Systems' },
    { pk_AI_Article_ID: 'ART-016', article_name: 'Article 16: Obligations for Providers of High-Risk AI Systems' },
  ];
  const ARTICLES_BY_ID = new Map(ARTICLES.map(a => [a.pk_AI_Article_ID, a]));

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
`);
  injectStyles('wiz-collapsible-styles', `
.wiz-collapsible-section{border:1px solid var(--color-border);border-radius:var(--radius-md,6px);overflow:hidden;margin-bottom:20px}
.wiz-collapsible-header{padding:12px 16px;background:var(--color-bg);cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:12px}
.wiz-collapsible-header:hover{background:var(--color-surface)}
.wiz-collapsible-header-left{flex:1}
.wiz-collapsible-header-left .section-label{margin-bottom:0}
.wiz-collapsible-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.wiz-collapsible-body{padding:14px 16px;border-top:1px solid var(--color-border)}
.wiz-gate-chevron{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
`);

  return { el, sectionLabel, loadRecord, saveRecord, copyToClipboard, injectStyles, buildTabStrip, buildCollapsible, buildDeliverablesList, fetchAll, ARTICLES, ARTICLES_BY_ID };
})();
