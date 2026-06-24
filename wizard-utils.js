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

  return { el, sectionLabel, loadRecord, saveRecord, copyToClipboard, injectStyles, buildTabStrip, buildCollapsible, buildDeliverablesList };
})();
