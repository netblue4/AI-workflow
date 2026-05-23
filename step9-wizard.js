/* Step 10 — Content Verification Testing
   Reads selected risks from record['step-8'].
   For each risk, shows its technical controls with jkTask / jkCodeSample pairs.
   Developer selects which controls are relevant to their architecture.
   Rule: every risk must have at least one control selected before save.
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _framework = null, _record = null;
  let _riskData = []; // [{risk_name, risk_description, category, relevance, controls:[...]}]

  const _state = {
    selected: {} // key = `${riskName}|||${controlName}` → boolean
  };

  // ---- Public API ---------------------------------------------
  window.mountStep9Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _framework  = null;
    _record     = null;
    _riskData   = [];
    _state.selected = {};

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(_buildTabStrip());
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _loadData(pw);
  };

  // ---- Data loading -------------------------------------------
  async function _loadData(pw) {
    try {
      const res = await fetch('ai_Risk_Control_Framework.json');
      if (!res.ok) throw new Error('fetch failed');
      _framework = await res.json();
    } catch (_) {
      pw.innerHTML = `<p style="padding:24px;color:#dc2626">Could not load ai_Risk_Control_Framework.json</p>`;
      return;
    }

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

    _riskData = _buildRiskControlData();

    // Restore prior selections
    const saved10 = _record?.['step-9'];
    if (saved10?.risks) {
      saved10.risks.forEach(r => {
        (r.controls || []).forEach(c => {
          if (c.selected) _state.selected[_selKey(r.risk_name, c.control_name)] = true;
        });
      });
    } else {
      // Default: select all controls
      _riskData.forEach(r =>
        r.controls.forEach(c => { _state.selected[_selKey(r.risk_name, c.jkName)] = true; })
      );
    }

    _renderPanes(pw);
  }

  function _selKey(riskName, ctrlName) {
    return `${riskName}|||${ctrlName}`;
  }

  // ---- Build risk → control data from framework ---------------
  function _buildRiskControlData() {
    const step8Risks = (_record?.['step-8']?.risks || []).filter(r => r.selected);
    if (!step8Risks.length) return [];

    // Build risk map from framework (deduplicate controls by jkName)
    const fwMap = new Map(); // riskName → {RiskDescription, controls:[]}
    const allItems = Object.values(_framework).reduce(
      (acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []
    );
    for (const item of allItems) {
      for (const field of (item.Fields || [])) {
        if (field.jkType !== 'risk') continue;
        if (!fwMap.has(field.jkName)) {
          fwMap.set(field.jkName, { RiskDescription: field.RiskDescription || '', controls: [] });
        }
        const entry = fwMap.get(field.jkName);
        for (const ctrl of (field.controls || [])) {
          if (!entry.controls.find(c => c.jkName === ctrl.jkName)) {
            entry.controls.push(ctrl);
          }
        }
      }
    }

    return step8Risks.map(r8 => {
      const fw = fwMap.get(r8.risk_name) || { RiskDescription: '', controls: [] };
      return {
        risk_name:        r8.risk_name,
        risk_description: r8.risk_description || fw.RiskDescription,
        category:         r8.category  || null,
        relevance:        r8.relevance || 'medium',
        controls:         fw.controls
      };
    });
  }

  // ---- Category colour palette --------------------------------
  const _CAT_COLORS = {
    amber:   { bg: '#fef3c7', text: '#92400e' },
    rose:    { bg: '#ffe4e6', text: '#9f1239' },
    teal:    { bg: '#ccfbf1', text: '#115e59' },
    slate:   { bg: '#f1f5f9', text: '#334155' },
    red:     { bg: '#fee2e2', text: '#b91c1c' },
    purple:  { bg: '#ede9fe', text: '#6d28d9' },
    indigo:  { bg: '#e0e7ff', text: '#4338ca' },
    orange:  { bg: '#ffedd5', text: '#9a3412' },
    green:   { bg: '#dcfce7', text: '#166534' },
    blue:    { bg: '#dbeafe', text: '#1e40af' }
  };

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    const strip = _el('div', 'wiz-tab-strip');
    [['wizard', 'Step Wizard'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
      const btn = document.createElement('button');
      btn.className = `wiz-tab${i === 0 ? ' wiz-tab--active' : ''}`;
      btn.dataset.tab = id; btn.textContent = lbl;
      btn.addEventListener('click', () => _switchTab(id));
      strip.appendChild(btn);
    });
    return strip;
  }

  function _switchTab(id) {
    _container.querySelectorAll('.wiz-tab').forEach(t =>
      t.classList.toggle('wiz-tab--active', t.dataset.tab === id));
    _container.querySelectorAll('.wiz-pane').forEach(p =>
      p.classList.toggle('wiz-pane--hidden', p.dataset.pane !== id));
    // Rebuild reference pane on every switch so it reflects current selections
    if (id === 'reference') {
      const refPane = _container.querySelector('[data-pane="reference"]');
      if (refPane) { refPane.innerHTML = ''; refPane.appendChild(_buildReferencePane()); }
    }
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const wz  = _el('div', 'wiz-pane');             wz.dataset.pane  = 'wizard';
    const ref = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane = 'reference';
    wz.appendChild(_buildWizardPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(wz); pw.appendChild(ref);
  }

  // ---- Wizard pane --------------------------------------------
  function _buildWizardPane() {
    const card = _el('div', 'step-detail-card');

    const ey = _el('p', `step-detail-eyebrow color-${_colorKey}`);
    ey.textContent = _phaseTitle; card.appendChild(ey);

    const title = _el('h2', 'step-detail-title');
    title.textContent = `Step ${_step.number} — ${_step.title}`; card.appendChild(title);

    const meta = _el('div', 'step-detail-meta');
    (_step.owners || []).forEach(o => {
      const t = _el('span', 'owner-tag'); t.textContent = o; meta.appendChild(t);
    });
    card.appendChild(meta);

    const summ = _el('p', 'step-detail-summary');
    summ.textContent = _step.summary || ''; card.appendChild(summ);

    // Source card — step 8 summary
    card.appendChild(_sectionLabel('Input Source'));
    card.appendChild(_buildSourceCard());

    if (_riskData.length === 0) {
      const warn = _el('div', 'wiz9-warn');
      warn.innerHTML = '<strong>No risks selected in Step 8.</strong> Complete the Risk Assessment (Step 8) and confirm at least one risk before returning to this step.';
      card.appendChild(warn);
      return card;
    }

    card.appendChild(_sectionLabel('Technical Control Selection'));

    const intro = _el('p', 'wiz9-intro');
    intro.innerHTML = `Select the technical controls relevant to your system architecture. <strong>Each risk must have at least one control selected</strong> before saving.`;
    card.appendChild(intro);

    // Validation summary
    card.appendChild(_buildValidationBanner());

    // Risk list
    const riskList = _el('div', 'wiz9-risk-list');
    _riskData.forEach((risk, idx) => riskList.appendChild(_buildRiskAccordion(risk, idx)));
    card.appendChild(riskList);

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'wiz9-results'));
    return card;
  }

  // ---- Source card --------------------------------------------
  function _buildSourceCard() {
    const card = _el('div', 'wiz9-source-card');
    const step8 = _record?.['step-8'];
    if (!step8) {
      const w = _el('div', 'wiz9-info');
      w.innerHTML = '<strong>Step 8 (Risk Assessment) not yet completed.</strong> Complete and save the risk assessment first.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz9-source-label'); lbl.textContent = 'Step 8 — Risk Assessment'; card.appendChild(lbl);
    const grid = _el('div', 'wiz9-source-grid');
    const cell = (l, v, mod) => {
      const c = _el('div', 'wiz9-source-cell');
      const lEl = _el('span', 'wiz9-cell-label'); lEl.textContent = l; c.appendChild(lEl);
      const vEl = _el('span', mod ? `wiz9-cell-value wiz9-cell-value--${mod}` : 'wiz9-cell-value');
      vEl.textContent = v || '—'; c.appendChild(vEl); grid.appendChild(c);
    };
    cell('Total risks assessed', String(step8.total_risks || 0));
    cell('Risks selected',       String(step8.selected_risks || 0), 'num');
    cell('HIGH-relevance',       String(step8.high_relevance_selected || 0), 'high');
    cell('Assessment date',      step8.assessment_date || '—');
    card.appendChild(grid); return card;
  }

  // ---- Validation banner --------------------------------------
  function _buildValidationBanner() {
    const wrap = _el('div', 'wiz9-val-wrap');
    wrap.id = 'wiz9-val-banner';
    _updateValidationBanner(wrap);
    return wrap;
  }

  function _updateValidationBanner(wrap) {
    const el = wrap || _container.querySelector('#wiz9-val-banner');
    if (!el) return;
    const uncovered = _riskData.filter(r => _selectedCountForRisk(r) === 0);
    el.innerHTML = '';
    if (uncovered.length === 0) {
      const ok = _el('div', 'wiz9-val-ok');
      ok.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All ${_riskData.length} risks have at least one control selected.`;
      el.appendChild(ok);
    } else {
      const err = _el('div', 'wiz9-val-err');
      err.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <strong>${uncovered.length} risk${uncovered.length !== 1 ? 's' : ''}</strong> still need${uncovered.length === 1 ? 's' : ''} a control selected: ${uncovered.map(r => r.risk_name).join(', ')}.`;
      el.appendChild(err);
    }
  }

  function _selectedCountForRisk(risk) {
    return risk.controls.filter(c => _state.selected[_selKey(risk.risk_name, c.jkName)]).length;
  }

  // ---- Risk accordion -----------------------------------------
  function _buildRiskAccordion(risk, idx) {
    const sec = _el('div', 'wiz9-risk-sec');
    sec.dataset.riskName = risk.risk_name;

    const hdr = _el('div', 'wiz9-risk-hdr');

    // Left: risk name + badges
    const left = _el('div', 'wiz9-risk-hdr-left');

    const riskIcon = _el('span', 'wiz9-risk-icon');
    riskIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    left.appendChild(riskIcon);

    const rName = _el('span', 'wiz9-risk-name'); rName.textContent = risk.risk_name; left.appendChild(rName);

    // Category tag
    if (risk.category) {
      const catTag = _el('span', 'wiz9-cat-tag');
      catTag.textContent = risk.category;
      // Read colour from guidance if available, else use teal
      catTag.style.cssText = 'background:#ccfbf1;color:#115e59'; // teal default
      left.appendChild(catTag);
    }

    // Relevance badge
    if (risk.relevance && risk.relevance !== 'unassessed') {
      const relBadge = _el('span', `wiz9-rel-badge wiz9-rel-badge--${risk.relevance}`);
      relBadge.textContent = risk.relevance === 'high' ? '▲ HIGH' : '◆ MEDIUM';
      left.appendChild(relBadge);
    }

    hdr.appendChild(left);

    // Right: selection count + select-all/none + chevron
    const right = _el('div', 'wiz9-risk-hdr-right');

    const selAll  = document.createElement('button'); selAll.className  = 'wiz9-sel-btn'; selAll.textContent  = 'Select all';
    const deselAll = document.createElement('button'); deselAll.className = 'wiz9-sel-btn'; deselAll.textContent = 'Deselect all';
    selAll.addEventListener('click', e => {
      e.stopPropagation();
      risk.controls.forEach(c => { _state.selected[_selKey(risk.risk_name, c.jkName)] = true; });
      _syncRisk(sec, risk);
    });
    deselAll.addEventListener('click', e => {
      e.stopPropagation();
      risk.controls.forEach(c => { _state.selected[_selKey(risk.risk_name, c.jkName)] = false; });
      _syncRisk(sec, risk);
    });
    right.appendChild(selAll); right.appendChild(deselAll);

    const selBadge = _el('span', 'wiz9-risk-sel-badge');
    selBadge.id = `wiz9-rb-${_safeId(risk.risk_name)}`;
    right.appendChild(selBadge);

    const chevron = _el('span', 'wiz9-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)';
    right.appendChild(chevron);
    hdr.appendChild(right);
    sec.appendChild(hdr);

    // Body (collapsed by default, first risk open)
    const body = _el('div', `wiz9-risk-body${idx === 0 ? '' : ' wiz9-collapsed'}`);

    // Risk description
    if (risk.risk_description) {
      const desc = _el('p', 'wiz9-risk-desc');
      desc.textContent = risk.risk_description;
      body.appendChild(desc);
    }

    // Controls
    const ctrlLabel = _el('p', 'wiz9-ctrl-section-label');
    ctrlLabel.textContent = `Technical controls (${risk.controls.length})`;
    body.appendChild(ctrlLabel);

    risk.controls.forEach(ctrl => body.appendChild(_buildControlCard(risk, ctrl)));
    sec.appendChild(body);

    hdr.addEventListener('click', () => {
      const collapsed = body.classList.toggle('wiz9-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });

    // Initial badge
    _updateRiskBadge(sec, risk);
    return sec;
  }

  function _syncRisk(secEl, risk) {
    // Sync checkboxes
    risk.controls.forEach(ctrl => {
      const key = _selKey(risk.risk_name, ctrl.jkName);
      const cbs = secEl.querySelectorAll(`.wiz9-ctrl-cb[data-key="${CSS.escape(key)}"]`);
      cbs.forEach(cb => { cb.checked = !!_state.selected[key]; });
    });
    _updateRiskBadge(secEl, risk);
    _updateValidationBanner();
    _updateCountBadge();
  }

  function _updateRiskBadge(secEl, risk) {
    const total = risk.controls.length;
    const sel   = _selectedCountForRisk(risk);
    const badge = secEl.querySelector(`#wiz9-rb-${_safeId(risk.risk_name)}`);
    if (!badge) return;
    badge.textContent = `${sel} / ${total}`;
    badge.className = sel === 0
      ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--none'
      : sel === total
        ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--all'
        : 'wiz9-risk-sel-badge wiz9-risk-sel-badge--partial';
  }

  // ---- Control card -------------------------------------------
  function _buildControlCard(risk, ctrl) {
    const key = _selKey(risk.risk_name, ctrl.jkName);
    const card = _el('div', 'wiz9-ctrl-card');

    // Header: checkbox + name + RCN
    const hdr = _el('div', 'wiz9-ctrl-hdr');
    const cb  = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wiz9-ctrl-cb';
    cb.dataset.key = key;
    cb.checked = !!_state.selected[key];
    cb.addEventListener('change', e => {
      _state.selected[key] = e.target.checked;
      const sec = _container.querySelector(`.wiz9-risk-sec[data-risk-name="${CSS.escape(risk.risk_name)}"]`);
      if (sec) _updateRiskBadge(sec, risk);
      _updateValidationBanner();
      _updateCountBadge();
    });
    hdr.appendChild(cb);

    const ctrlIcon = _el('span', 'wiz9-ctrl-icon');
    ctrlIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    hdr.appendChild(ctrlIcon);

    const cName = _el('span', 'wiz9-ctrl-name'); cName.textContent = ctrl.jkName; hdr.appendChild(cName);

    if (ctrl.requirement_control_number) {
      const rcn = _el('span', 'wiz9-rcn-badge');
      rcn.textContent = ctrl.requirement_control_number;
      hdr.appendChild(rcn);
    }

    if (ctrl.jkMaturity) {
      const mat = _el('span', 'wiz9-maturity-badge');
      mat.textContent = ctrl.jkMaturity;
      hdr.appendChild(mat);
    }

    card.appendChild(hdr);

    // Control objective / text
    if (ctrl.jkObjective || ctrl.jkText) {
      const obj = _el('p', 'wiz9-ctrl-obj');
      obj.textContent = ctrl.jkObjective || ctrl.jkText;
      card.appendChild(obj);
    }

    // Implementation evidence (if present)
    if (ctrl.jkImplementationEvidence) {
      const evWrap = _el('div', 'wiz9-evidence-wrap');
      const evLabel = _el('span', 'wiz9-evidence-label'); evLabel.textContent = 'Implementation evidence: ';
      const evText  = _el('span', 'wiz9-evidence-text');  evText.textContent  = ctrl.jkImplementationEvidence;
      evWrap.appendChild(evLabel); evWrap.appendChild(evText);
      card.appendChild(evWrap);
    }

    // Task / Code pairs (collapsible)
    if ((ctrl.jkTask || []).length > 0) {
      card.appendChild(_buildTaskCodeSection(ctrl));
    }

    return card;
  }

  // ---- Task + Code Sample pairs -------------------------------
  function _buildTaskCodeSection(ctrl) {
    const tasks   = ctrl.jkTask       || [];
    const samples = ctrl.jkCodeSample || [];
    const count   = tasks.length;

    const wrap = _el('div', 'wiz9-tasks-wrap');
    const hdr  = _el('div', 'wiz9-tasks-hdr');

    const icon = _el('span', 'wiz9-tasks-icon');
    icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
    hdr.appendChild(icon);

    const lbl = _el('span', 'wiz9-tasks-lbl');
    lbl.textContent = `Implementation Tasks (${count})`;
    hdr.appendChild(lbl);

    const chv = _el('span', 'wiz9-tasks-chv');
    chv.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chv.style.transform = 'rotate(-90deg)';
    hdr.appendChild(chv);
    wrap.appendChild(hdr);

    const body = _el('div', 'wiz9-tasks-body wiz9-collapsed');

    tasks.forEach((taskText, i) => {
      const pair = _el('div', 'wiz9-pair');

      // Task
      const taskWrap = _el('div', 'wiz9-task-wrap');
      const taskNumBadge = _el('span', 'wiz9-task-num'); taskNumBadge.textContent = `Task ${i + 1}`; taskWrap.appendChild(taskNumBadge);
      const taskBody = _el('p', 'wiz9-task-text');
      taskBody.textContent = _stripLeadingNum(taskText);
      taskWrap.appendChild(taskBody);
      pair.appendChild(taskWrap);

      // Code sample
      const sampleText = samples[i] || '';
      if (sampleText) {
        const codeWrap = _el('div', 'wiz9-code-wrap');
        const codeBadge = _el('span', 'wiz9-code-badge'); codeBadge.textContent = `Code Sample ${i + 1}`; codeWrap.appendChild(codeBadge);

        const pre  = document.createElement('pre');
        pre.className = 'wiz9-code-block';
        const code = document.createElement('code');
        code.textContent = _extractCode(sampleText);
        pre.appendChild(code);
        codeWrap.appendChild(pre);
        pair.appendChild(codeWrap);
      }

      body.appendChild(pair);
    });

    wrap.appendChild(body);

    hdr.addEventListener('click', () => {
      const col = body.classList.toggle('wiz9-collapsed');
      chv.style.transform = col ? 'rotate(-90deg)' : '';
    });

    return wrap;
  }

  // ---- Text helpers -------------------------------------------
  function _stripLeadingNum(text) {
    // "1. Some text" → "Some text"
    return String(text).replace(/^\d+\.\s*/, '').trim();
  }

  function _extractCode(sampleText) {
    // Strip leading "N.\n" or "N. "
    const stripped = String(sampleText).replace(/^\d+\.\s*\n?/, '');
    // Extract code from ``` fences
    const match = stripped.match(/```(?:\w+)?\n?([\s\S]*?)```/);
    return match ? match[1].trimEnd() : stripped.trim();
  }

  // ---- Action row + save --------------------------------------
  function _buildActionRow() {
    const row   = _el('div', 'wiz-action-row');
    const left  = _el('div');
    const badge = _el('span', 'wiz9-count-badge');
    badge.id = 'wiz9-count-badge';
    _updateCountBadgeEl(badge);
    left.appendChild(badge); row.appendChild(left);

    const right = _el('div');
    const btn = document.createElement('button');
    btn.className = 'wiz-btn-primary'; btn.textContent = 'Save Control Selection';
    btn.addEventListener('click', _handleSave);
    right.appendChild(btn); row.appendChild(right);
    return row;
  }

  function _updateCountBadge() {
    const el = _container.querySelector('#wiz9-count-badge');
    if (el) _updateCountBadgeEl(el);
  }

  function _updateCountBadgeEl(el) {
    const total    = _riskData.length;
    const covered  = _riskData.filter(r => _selectedCountForRisk(r) > 0).length;
    el.textContent = `${covered} / ${total} risks controlled`;
    el.className   = covered === total
      ? 'wiz9-count-badge wiz9-count-badge--ok'
      : 'wiz9-count-badge wiz9-count-badge--warn';
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    // Validate: every risk must have ≥1 control selected
    const uncovered = _riskData.filter(r => _selectedCountForRisk(r) === 0);
    if (uncovered.length > 0) {
      _updateValidationBanner();
      const firstSec = _container.querySelector(
        `.wiz9-risk-sec[data-risk-name="${CSS.escape(uncovered[0].risk_name)}"]`
      );
      if (firstSec) {
        firstSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        firstSec.classList.add('wiz9-risk-sec--error');
        setTimeout(() => firstSec.classList.remove('wiz9-risk-sec--error'), 2500);
      }
      return;
    }

    const rec10 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-9'] = rec10;
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 10 saved ✓');
    _renderResults(rec10);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};

    const risks = _riskData.map(r => ({
      risk_name:   r.risk_name,
      category:    r.category,
      relevance:   r.relevance,
      controls: r.controls.map(c => ({
        control_name:   c.jkName,
        control_number: c.control_number || '',
        rcn:            c.requirement_control_number || '',
        task_count:     (c.jkTask || []).length,
        selected:       !!_state.selected[_selKey(r.risk_name, c.jkName)]
      }))
    }));

    const totalControls   = risks.reduce((n, r) => n + r.controls.length, 0);
    const selectedCtrls   = risks.reduce((n, r) => n + r.controls.filter(c => c.selected).length, 0);

    return {
      step_id: 'step-9', step_title: 'Control identification and disclosure design',
      assessment_date: today,
      assessed_by:  meta.assessed_by || '',
      use_case_id:  meta.use_case_id || '',
      total_risks:            risks.length,
      risks_fully_controlled: risks.filter(r => r.controls.some(c => c.selected)).length,
      total_controls:         totalControls,
      selected_controls:      selectedCtrls,
      risks
    };
  }

  function _renderResults(rec10) {
    const area = _container.querySelector('.wiz9-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'wiz9-result-card');
    const h = _el('h3', 'wiz9-result-title'); h.textContent = 'Control Selection Saved'; card.appendChild(h);
    const stats = _el('div', 'wiz9-result-stats');
    [
      [rec10.total_risks,            'Risks addressed'],
      [rec10.risks_fully_controlled, 'Risks controlled'],
      [rec10.selected_controls,      'Controls selected'],
      [rec10.total_controls - rec10.selected_controls, 'Controls excluded']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num); s.appendChild(n);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl; s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);
    const note = _el('p', 'wiz9-result-note');
    note.innerHTML = `Control selection saved. <strong>${rec10.selected_controls} control${rec10.selected_controls !== 1 ? 's' : ''}</strong> selected across <strong>${rec10.risks_fully_controlled} risk${rec10.risks_fully_controlled !== 1 ? 's' : ''}</strong>. This feeds into the Approval Gate (Step 11) submission pack.`;
    card.appendChild(note);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane (rebuilds on tab switch — always reflects current selections) ---
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');
    const title = _el('h2', 'step-detail-title'); title.textContent = 'Control Catalogue Reference'; card.appendChild(title);

    if (_riskData.length === 0) {
      const p = _el('p', 'wiz9-intro'); p.textContent = 'No risks selected in Step 8.'; card.appendChild(p);
      return card;
    }

    // Live selection summary
    const totalCtrls = _riskData.reduce((n, r) => n + r.controls.length, 0);
    const selCtrls   = _riskData.reduce((n, r) => n + r.controls.filter(c => !!_state.selected[_selKey(r.risk_name, c.jkName)]).length, 0);
    const uncovered  = _riskData.filter(r => _selectedCountForRisk(r) === 0).length;

    const summary = _el('div', 'wiz9-ref-summary');
    const sumBadge = _el('span', selCtrls === totalCtrls ? 'wiz9-ref-sum-badge wiz9-ref-sum-badge--ok' : 'wiz9-ref-sum-badge wiz9-ref-sum-badge--warn');
    sumBadge.textContent = `${selCtrls} / ${totalCtrls} controls selected`;
    summary.appendChild(sumBadge);
    if (uncovered > 0) {
      const unc = _el('span', 'wiz9-ref-uncovered');
      unc.textContent = `${uncovered} risk${uncovered !== 1 ? 's' : ''} without a control`;
      summary.appendChild(unc);
    }
    const hint = _el('p', 'wiz9-ref-hint');
    hint.textContent = 'This view reflects your current selections in the Step Wizard tab. Selected controls are shown in full; deselected controls are greyed out.';
    card.appendChild(summary);
    card.appendChild(hint);

    _riskData.forEach(risk => {
      const selCount = _selectedCountForRisk(risk);
      const sec = _el('div', 'wiz9-ref-risk-sec');

      // Risk header with live count
      const hdr = _el('div', 'wiz9-ref-risk-hdr');
      const rn  = _el('span', 'wiz9-ref-risk-name'); rn.textContent = risk.risk_name; hdr.appendChild(rn);
      if (risk.category) {
        const ct = _el('span', 'wiz9-cat-tag'); ct.textContent = risk.category;
        ct.style.cssText = 'background:#ccfbf1;color:#115e59'; hdr.appendChild(ct);
      }
      const rb = _el('span', selCount === 0
        ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--none'
        : selCount === risk.controls.length
          ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--all'
          : 'wiz9-risk-sel-badge wiz9-risk-sel-badge--partial');
      rb.textContent = `${selCount} / ${risk.controls.length}`;
      hdr.appendChild(rb);
      sec.appendChild(hdr);

      risk.controls.forEach(ctrl => {
        const key      = _selKey(risk.risk_name, ctrl.jkName);
        const isSelected = !!_state.selected[key];

        const cc = _el('div', isSelected ? 'wiz9-ref-ctrl' : 'wiz9-ref-ctrl wiz9-ref-ctrl--deselected');
        const ch = _el('div', 'wiz9-ref-ctrl-hdr');

        // Selection indicator
        const selInd = _el('span', isSelected ? 'wiz9-ref-sel-ind wiz9-ref-sel-ind--on' : 'wiz9-ref-sel-ind wiz9-ref-sel-ind--off');
        selInd.textContent = isSelected ? '✓' : '✗';
        ch.appendChild(selInd);

        const ci = _el('span', 'wiz9-ctrl-icon');
        ci.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
        ch.appendChild(ci);

        const cn = _el('span', 'wiz9-ref-ctrl-name'); cn.textContent = ctrl.jkName; ch.appendChild(cn);
        if (ctrl.requirement_control_number) {
          const rcn = _el('span', 'wiz9-rcn-badge'); rcn.textContent = ctrl.requirement_control_number; ch.appendChild(rcn);
        }
        cc.appendChild(ch);

        // Only expand tasks/code for selected controls
        if (isSelected) {
          if (ctrl.jkObjective || ctrl.jkText) {
            const obj = _el('p', 'wiz9-ctrl-obj'); obj.textContent = ctrl.jkObjective || ctrl.jkText; cc.appendChild(obj);
          }
          const tasks = ctrl.jkTask || [], samples = ctrl.jkCodeSample || [];
          tasks.forEach((t, i) => {
            const pair = _el('div', 'wiz9-ref-pair');
            const tn = _el('span', 'wiz9-task-num'); tn.textContent = `Task ${i + 1}`; pair.appendChild(tn);
            const tt = _el('p', 'wiz9-task-text'); tt.textContent = _stripLeadingNum(t); pair.appendChild(tt);
            if (samples[i]) {
              const cb2 = _el('span', 'wiz9-code-badge'); cb2.textContent = `Code ${i + 1}`; pair.appendChild(cb2);
              const pre = document.createElement('pre'); pre.className = 'wiz9-code-block';
              const code = document.createElement('code'); code.textContent = _extractCode(samples[i]);
              pre.appendChild(code); pair.appendChild(pre);
            }
            cc.appendChild(pair);
          });
        } else {
          const skip = _el('p', 'wiz9-ref-ctrl-skip');
          skip.textContent = 'Not selected — deselected in Step Wizard.';
          cc.appendChild(skip);
        }

        sec.appendChild(cc);
      });
      card.appendChild(sec);
    });

    return card;
  }

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    // Inject shared wiz-* base classes if not already present (e.g. when step-8 hasn't run)
    if (!document.getElementById('wiz-shared-styles')) {
      const shared = document.createElement('style');
      shared.id = 'wiz-shared-styles';
      shared.textContent = `
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
.wiz8-stat{display:flex;flex-direction:column;gap:2px}
.wiz8-stat-num{font-size:24px;font-weight:700;color:#15803d;line-height:1}
.wiz8-stat-lbl{font-size:10px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
`;
      document.head.appendChild(shared);
    }

    if (document.getElementById('wiz9-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz9-styles';
    s.textContent = `
/* Source card */
.wiz9-source-card{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz9-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#166534;margin:0 0 10px}
.wiz9-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.wiz9-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz9-cell-label{font-size:11px;color:var(--color-text-tertiary);font-weight:500}
.wiz9-cell-value{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz9-cell-value--num{font-size:18px;font-weight:700;color:#0d9488}
.wiz9-cell-value--high{font-size:14px;font-weight:700;color:#b91c1c}

/* Info / warn */
.wiz9-warn{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:12px 16px;font-size:13px;color:#92400e;margin-bottom:12px}
.wiz9-info{background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:12px 16px;font-size:13px;color:#075985}
.wiz9-intro{font-size:13px;color:var(--color-text-secondary);margin:0 0 12px;line-height:1.6}

/* Validation banner */
.wiz9-val-wrap{margin-bottom:14px}
.wiz9-val-ok{display:flex;align-items:center;gap:7px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:9px 14px;font-size:13px;color:#15803d;font-weight:500}
.wiz9-val-err{display:flex;align-items:flex-start;gap:7px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:9px 14px;font-size:13px;color:#9a3412;line-height:1.55}

/* Risk accordion */
.wiz9-risk-list{display:flex;flex-direction:column;gap:10px}
.wiz9-risk-sec{border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.wiz9-risk-sec--error{animation:wiz9-shake .4s ease;border-color:#fca5a5!important}
@keyframes wiz9-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.wiz9-risk-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none;gap:10px}
.wiz9-risk-hdr:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz9-risk-hdr-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.wiz9-risk-icon{display:flex;color:#ef4444;flex-shrink:0}
.wiz9-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz9-cat-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz9-rel-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz9-rel-badge--high{background:#fee2e2;color:#b91c1c}
.wiz9-rel-badge--medium{background:#f1f5f9;color:#475569}
.wiz9-risk-hdr-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz9-sel-btn{font-size:11px;font-weight:500;color:var(--teal-600,#0d9488);background:none;border:1px solid #99f6e4;border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.wiz9-sel-btn:hover{background:#f0fdfa}
.wiz9-risk-sel-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center}
.wiz9-risk-sel-badge--all{background:#dcfce7;color:#15803d}
.wiz9-risk-sel-badge--partial{background:#fef3c7;color:#b45309}
.wiz9-risk-sel-badge--none{background:#fee2e2;color:#b91c1c}
.wiz9-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz9-risk-body{padding:16px;display:flex;flex-direction:column;gap:12px}
.wiz9-collapsed{display:none}

/* Risk body */
.wiz9-risk-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0;padding:10px 12px;background:#fafafa;border-radius:5px;border-left:3px solid var(--color-border)}
.wiz9-ctrl-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:0}

/* Control card */
.wiz9-ctrl-card{background:#fff;border:1px solid var(--color-border);border-radius:8px;padding:14px 16px}
.wiz9-ctrl-hdr{display:flex;align-items:center;gap:7px;margin-bottom:10px;flex-wrap:wrap}
.wiz9-ctrl-cb{flex-shrink:0;accent-color:var(--teal-600,#0d9488);width:15px;height:15px;cursor:pointer}
.wiz9-ctrl-icon{display:flex;color:#6366f1;flex-shrink:0}
.wiz9-ctrl-name{font-size:13px;font-weight:700;color:var(--color-text-primary);flex:1;min-width:120px}
.wiz9-rcn-badge{font-size:10px;font-weight:600;background:#e0e7ff;color:#4338ca;padding:2px 7px;border-radius:4px;white-space:nowrap;word-break:break-all}
.wiz9-maturity-badge{font-size:10px;font-weight:600;background:#dcfce7;color:#15803d;padding:2px 7px;border-radius:4px;white-space:nowrap}
.wiz9-ctrl-obj{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0 0 10px}
.wiz9-evidence-wrap{font-size:11px;color:var(--color-text-tertiary);margin-bottom:10px}
.wiz9-evidence-label{font-weight:600}
.wiz9-evidence-text{font-style:italic}

/* Task / Code section */
.wiz9-tasks-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-top:4px}
.wiz9-tasks-hdr{display:flex;align-items:center;gap:7px;padding:8px 12px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none}
.wiz9-tasks-hdr:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz9-tasks-icon{display:flex;color:#6366f1;flex-shrink:0}
.wiz9-tasks-lbl{font-size:12px;font-weight:600;color:#4338ca;flex:1}
.wiz9-tasks-chv{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz9-tasks-body{padding:14px;display:flex;flex-direction:column;gap:20px;background:#fafbff}

/* Task / Code pair */
.wiz9-pair{display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:#fff;border:1px solid #e0e7ff;border-radius:6px}
.wiz9-task-wrap{display:flex;flex-direction:column;gap:5px}
.wiz9-task-num{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4338ca;background:#e0e7ff;padding:2px 8px;border-radius:4px;display:inline-block;width:fit-content}
.wiz9-task-text{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0}
.wiz9-code-wrap{display:flex;flex-direction:column;gap:5px}
.wiz9-code-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#15803d;background:#dcfce7;padding:2px 8px;border-radius:4px;display:inline-block;width:fit-content}
.wiz9-code-block{background:#1e293b;color:#e2e8f0;font-size:11px;line-height:1.6;padding:12px 14px;border-radius:6px;overflow-x:auto;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;white-space:pre}
.wiz9-code-block code{background:none;padding:0;font-size:inherit;color:inherit;font-family:inherit}

/* Count / action */
.wiz9-count-badge{font-size:13px;font-weight:600;padding:4px 12px;border-radius:10px}
.wiz9-count-badge--ok{background:#dcfce7;color:#15803d}
.wiz9-count-badge--warn{background:#fee2e2;color:#b91c1c}

/* Results */
.wiz9-results{margin-top:16px}
.wiz9-result-card{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px}
.wiz9-result-title{font-size:14px;font-weight:700;color:#15803d;margin:0 0 14px}
.wiz9-result-stats{display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap}
.wiz9-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* Reference pane */
.wiz9-ref-summary{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.wiz9-ref-sum-badge{font-size:12px;font-weight:700;padding:4px 12px;border-radius:10px}
.wiz9-ref-sum-badge--ok{background:#dcfce7;color:#15803d}
.wiz9-ref-sum-badge--warn{background:#fee2e2;color:#b91c1c}
.wiz9-ref-uncovered{font-size:12px;font-weight:600;color:#b91c1c;background:#fff1f2;padding:3px 10px;border-radius:6px}
.wiz9-ref-hint{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0 0 20px;line-height:1.5}
.wiz9-ref-risk-sec{margin-bottom:28px}
.wiz9-ref-risk-hdr{display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:2px solid var(--color-border);margin-bottom:12px;flex-wrap:wrap}
.wiz9-ref-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz9-ref-ctrl{margin-bottom:10px;padding-left:12px;border-left:3px solid #a5b4fc}
.wiz9-ref-ctrl--deselected{border-left-color:#e2e8f0;opacity:.55}
.wiz9-ref-ctrl-hdr{display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap}
.wiz9-ref-ctrl-name{font-size:12px;font-weight:700;color:#4338ca}
.wiz9-ref-sel-ind{font-size:11px;font-weight:800;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.wiz9-ref-sel-ind--on{background:#dcfce7;color:#15803d}
.wiz9-ref-sel-ind--off{background:#f1f5f9;color:#94a3b8}
.wiz9-ref-ctrl-skip{font-size:11px;color:#94a3b8;font-style:italic;margin:0 0 4px}
.wiz9-ref-pair{margin-bottom:12px;padding:8px 10px;background:#fafbff;border:1px solid #e0e7ff;border-radius:5px;display:flex;flex-direction:column;gap:6px}
`;
    document.head.appendChild(s);
  }

  // ---- Utilities ----------------------------------------------
  function _el(tag, cls) {
    const el = document.createElement(tag); if (cls) el.className = cls; return el;
  }
  function _sectionLabel(text) {
    const p = _el('p', 'section-label'); p.textContent = text; return p;
  }
  function _safeId(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
  }

})();
