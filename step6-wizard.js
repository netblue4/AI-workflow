/* Step 6 — Control Identification
   Reads selected risks from record['step-5'].legal_assessment.
   Risk team uses Step Wizard tab to select controls per individual risk.
   Compliance team uses AI Act Compliance View tab to fill HS gaps.
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _tblData = null, _record = null;
  let _riskData = []; // [{ risk_id, display_name, risk_type, risk_source, risk_description, controls }]
  let _gsRiskData = []; // applicable Group Standard risks + controls (Group Standards tab)
  let _tcByRC   = null; // fk_Risk_Control_ID → test control (R→T pairing)

  const _state = {
    riskSelected: {},       // risk team picks (Step Wizard tab)
    complianceSelected: {}, // compliance team additions (Compliance View tab)
    hsNotApplicable: {},    // standard_ref → { reason, date } — N/A decisions
    gsSelected: {}          // Group Standard control picks (pk_Risk_Control_ID → bool)
  };

  // ---- Public API ---------------------------------------------
  window.mountStep6Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _tblData    = null;
    _record     = null;
    _riskData   = [];
    _tcByRC     = null;
    _state.riskSelected = {};
    _state.complianceSelected = {};
    _state.hsNotApplicable = {};
    _state.gsSelected = {};

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(WizUtils.buildStepHeader(_step, _colorKey, _phaseTitle));
    shell.appendChild(_buildTabStrip());
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _loadData(pw);
  };

  // ---- Data loading -------------------------------------------
  async function _loadData(pw) {
    const [risks, controls, tasks, hs, testControls] = await WizUtils.fetchAll([
      'tbl_Risks.json',
      'tbl_Risk_Controls.json',
      'tbl_Control_Task_Code.json',
      'tbl_Harmonised_Standards.json',
      'tbl_Test_Controls.json',
    ]);
    if (!risks || !controls || !tasks || !hs || !testControls) {
      pw.innerHTML = `<p style="padding:24px;color:#ec6a68">Could not load risk data files.</p>`;
      return;
    }
    _tblData = { risks, controls, tasks, hs, testControls };
    _tcByRC  = new Map(testControls.filter(tc => tc.fk_Risk_Control_ID).map(tc => [tc.fk_Risk_Control_ID, tc]));

    _record = WizUtils.loadRecord();

    _riskData = _buildRiskControlData();
    _gsRiskData = _buildGroupStandardControlData();

    // Restore prior control selections
    const saved9 = _record?.['step-6'];
    if (saved9?.risk_controls) {
      saved9.risk_controls.forEach(c => {
        if (c.selected) _state.riskSelected[c.control_id] = true;
      });
    } else {
      // Default: select all controls
      _riskData.forEach(r =>
        r.controls.forEach(c => { _state.riskSelected[c.pk_Risk_Control_ID] = true; })
      );
    }
    // Framework_Statement controls are always applicable — the assessor cannot
    // mark them N/A, so force-select them regardless of any prior saved state.
    _riskData.forEach(r =>
      r.controls.forEach(c => {
        if (c.control_source === 'Framework_Statement') _state.riskSelected[c.pk_Risk_Control_ID] = true;
      })
    );
    if (saved9?.compliance_additions) {
      saved9.compliance_additions.forEach(c => {
        if (c.selected) _state.complianceSelected[c.control_id] = true;
      });
    }
    if (saved9?.hs_not_applicable) {
      Object.assign(_state.hsNotApplicable, saved9.hs_not_applicable);
    }
    if (saved9?.group_standard_controls?.controls) {
      saved9.group_standard_controls.controls.forEach(c => {
        if (c.selected) _state.gsSelected[c.control_id] = true;
      });
    } else {
      // Default: select all controls for applicable Group Standard risks
      _gsRiskData.forEach(r =>
        r.controls.forEach(c => { _state.gsSelected[c.pk_Risk_Control_ID] = true; })
      );
    }

    _renderPanes(pw);
  }

  // ---- Build individual risk data from tbl_* data -------------
  function _buildRiskControlData() {
    if (!_tblData) return [];
    const saved8        = _record?.['step-5'];
    const legalSelected = (saved8?.legal_assessment?.risks || []).filter(r => r.selected);
    if (!legalSelected.length) return [];

    const tblRiskByName = new Map(_tblData.risks.map(r => [r.risk_name, r]));

    // Build controls-by-risk map
    const ctrlsByRisk = new Map(); // fk_Risk_ID → [ctrl, ...]
    for (const ctrl of _tblData.controls) {
      if (!ctrlsByRisk.has(ctrl.fk_Risk_ID)) ctrlsByRisk.set(ctrl.fk_Risk_ID, []);
      ctrlsByRisk.get(ctrl.fk_Risk_ID).push(ctrl);
    }

    // Build tasks-by-control map, sorted by task_number
    const tasksByCtrl = new Map(); // fk_Risk_Control_ID → [task, ...]
    for (const task of _tblData.tasks) {
      if (!tasksByCtrl.has(task.fk_Risk_Control_ID)) tasksByCtrl.set(task.fk_Risk_Control_ID, []);
      tasksByCtrl.get(task.fk_Risk_Control_ID).push(task);
    }
    tasksByCtrl.forEach(ts => ts.sort((a, b) => a.task_number - b.task_number));

    const seenRiskIds = new Set();
    const result = [];

    // Process legal (EU AI Act) risks
    legalSelected.forEach(r8 => {
      const tblRisk = tblRiskByName.get(r8.risk_name);
      if (!tblRisk) return;
      if (seenRiskIds.has(tblRisk.pk_Risk_ID)) return;
      seenRiskIds.add(tblRisk.pk_Risk_ID);
      const controls = (ctrlsByRisk.get(tblRisk.pk_Risk_ID) || []).map(ctrl => ({
        ...ctrl,
        tasks: tasksByCtrl.get(ctrl.pk_Risk_Control_ID) || []
      }));
      result.push({
        risk_id:           tblRisk.pk_Risk_ID,
        display_name:      tblRisk.risk_name,
        fk_AI_Article_ID:  tblRisk.fk_AI_Article_ID || '',
        risk_type:         'legal',
        risk_source:       'EU_AI_Act',
        risk_description:  tblRisk.risk_description || '',
        controls
      });
    });

    return result;
  }

  // ---- Build applicable Group Standard risks + their controls -
  function _buildGroupStandardControlData() {
    if (!_tblData) return [];
    const gsa = _record?.['step-5']?.group_standard_assessment;
    const selected = (gsa?.risks || []).filter(r => r.selected);
    if (!selected.length) return [];

    const tblRiskById = new Map(_tblData.risks.map(r => [r.pk_Risk_ID, r]));
    const ctrlsByRisk = new Map();
    for (const ctrl of _tblData.controls) {
      if (!ctrlsByRisk.has(ctrl.fk_Risk_ID)) ctrlsByRisk.set(ctrl.fk_Risk_ID, []);
      ctrlsByRisk.get(ctrl.fk_Risk_ID).push(ctrl);
    }

    return selected.map(r5 => {
      const tblRisk = tblRiskById.get(r5.risk_id);
      if (!tblRisk) return null;
      return {
        risk_id:           tblRisk.pk_Risk_ID,
        display_name:      tblRisk.risk_name,
        groupstandard_ref: tblRisk.groupstandard_ref || r5.groupstandard_ref || '',
        risk_type:         'group_standard',
        risk_source:       'Group_Standard',
        risk_description:  tblRisk.risk_description || '',
        controls:          (ctrlsByRisk.get(tblRisk.pk_Risk_ID) || [])
      };
    }).filter(Boolean);
  }

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    return WizUtils.buildTabStrip([
      ['wizard', 'Legal/Regulatory Controls'],
      ['dpia', 'DPIA Controls'],
      ['groupstd', 'Group Standards Controls'],
      ['compliance', 'AI Act Compliance Controls'],
      ['reference', 'Reference'],
      ['framework', 'Framework Mapping']
    ], _switchTab);
  }

  function _switchTab(id) {
    _container.querySelectorAll('.wiz-tab').forEach(t =>
      t.classList.toggle('wiz-tab--active', t.dataset.tab === id));
    _container.querySelectorAll('.wiz-pane').forEach(p =>
      p.classList.toggle('wiz-pane--hidden', p.dataset.pane !== id));
    // Rebuild panes on every switch so they reflect current state
    if (id === 'reference') {
      const refPane = _container.querySelector('[data-pane="reference"]');
      if (refPane) { refPane.innerHTML = ''; refPane.appendChild(_buildReferencePane()); }
    }
    if (id === 'compliance') {
      const cmpPane = _container.querySelector('[data-pane="compliance"]');
      if (cmpPane) { cmpPane.innerHTML = ''; cmpPane.appendChild(_buildCompliancePane()); }
    }
    if (id === 'groupstd') {
      const gsPane = _container.querySelector('[data-pane="groupstd"]');
      if (gsPane) { gsPane.innerHTML = ''; gsPane.appendChild(_buildGroupStandardsCompliancePane()); }
    }
    if (id === 'dpia') {
      const dpPane = _container.querySelector('[data-pane="dpia"]');
      if (dpPane) { dpPane.innerHTML = ''; dpPane.appendChild(_buildDpiaControlsPane()); }
    }
    if (id === 'framework') {
      const fwPane = _container.querySelector('[data-pane="framework"]');
      if (fwPane && typeof createFrameworkMapping === 'function') {
        fwPane.innerHTML = '';
        fwPane.appendChild(createFrameworkMapping(null, null, null));
      }
    }
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const wz  = _el('div', 'wiz-pane');                  wz.dataset.pane = 'wizard';
    const dp  = _el('div', 'wiz-pane wiz-pane--hidden'); dp.dataset.pane  = 'dpia';
    const cmp = _el('div', 'wiz-pane wiz-pane--hidden'); cmp.dataset.pane = 'compliance';
    const gs  = _el('div', 'wiz-pane wiz-pane--hidden'); gs.dataset.pane  = 'groupstd';
    const ref = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane = 'reference';
    const fw  = _el('div', 'wiz-pane wiz-pane--hidden'); fw.dataset.pane  = 'framework';
    wz.appendChild(_buildWizardPane());
    dp.appendChild(_buildDpiaControlsPane());
    cmp.appendChild(_buildCompliancePane());
    gs.appendChild(_buildGroupStandardsCompliancePane());
    ref.appendChild(_buildReferencePane());
    if (typeof createFrameworkMapping === 'function') fw.appendChild(createFrameworkMapping(null, null, null));
    pw.appendChild(wz); pw.appendChild(dp); pw.appendChild(cmp); pw.appendChild(gs); pw.appendChild(ref); pw.appendChild(fw);
  }

  // ---- Wizard pane --------------------------------------------
  function _buildWizardPane() {
    const card = _el('div', 'step-detail-card');

    // Source card — step 5 summary (input context at the top of content)
    card.appendChild(_sectionLabel('Input Source'));
    card.appendChild(_buildSourceCard());

    if (_riskData.length === 0) {
      const warn = _el('div', 'wiz9-warn');
      warn.innerHTML = '<strong>No risks selected in Step 5.</strong> Complete the Risk Identification (Step 5) and confirm at least one risk before returning to this step.';
      card.appendChild(warn);
      return card;
    }

    card.appendChild(_sectionLabel('Control Selection'));

    const intro = _el('p', 'wiz9-intro');
    intro.innerHTML = `Review controls grouped by individual risk. <strong>Each risk must have at least one control selected</strong> before saving.`;
    card.appendChild(intro);

    // Validation summary
    card.appendChild(_buildValidationBanner());

    // Risk lists grouped by type
    const techRisks  = _riskData.filter(r => r.risk_type === 'technical');
    const legalRisks = _riskData.filter(r => r.risk_type === 'legal');

    if (techRisks.length > 0) {
      card.appendChild(_sectionLabel(`Technical Risks (${techRisks.length})`));
      const tl = _el('div', 'wiz9-risk-list');
      techRisks.forEach((r, i) => tl.appendChild(_buildRiskAccordion(r, i)));
      card.appendChild(tl);
    }
    if (legalRisks.length > 0) {
      card.appendChild(_sectionLabel(`Legal / EU AI Act Risks (${legalRisks.length})`));
      const ll = _el('div', 'wiz9-risk-list');
      legalRisks.forEach((r, i) => ll.appendChild(_buildRiskAccordion(r, i)));
      card.appendChild(ll);
    }
    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'wiz9-results'));
    return card;
  }

  // ---- Source card --------------------------------------------
  function _buildSourceCard() {
    const card = _el('div', 'wiz9-source-card');
    const step8 = _record?.['step-5'];
    if (!step8) {
      const w = _el('div', 'wiz9-info');
      w.innerHTML = '<strong>Step 5 (Risk Identification) not yet completed.</strong> Complete and save the risk identification first.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz9-source-label'); lbl.textContent = 'Step 5 — Risk Identification'; card.appendChild(lbl);
    const grid = _el('div', 'wiz9-source-grid');
    const cell = (l, v, mod) => {
      const c = _el('div', 'wiz9-source-cell');
      const lEl = _el('span', 'wiz9-cell-label'); lEl.textContent = l; c.appendChild(lEl);
      const vEl = _el('span', mod ? `wiz9-cell-value wiz9-cell-value--${mod}` : 'wiz9-cell-value');
      vEl.textContent = v || '—'; c.appendChild(vEl); grid.appendChild(c);
    };
    const legal = step8.legal_assessment;
    const legalCount = legal?.selected_count ?? (legal?.risks || []).filter(r => r.selected).length;
    cell('Risks confirmed',           String(legalCount),         'ok');
    cell('Individual risks identified', String(_riskData.length), 'num');
    cell('Assessment date',           legal?.assessment_date || '—');
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
      ok.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All ${_riskData.length} risk${_riskData.length !== 1 ? 's' : ''} have at least one control selected.`;
      el.appendChild(ok);
    } else {
      const err = _el('div', 'wiz9-val-err');
      err.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <strong>${uncovered.length} risk${uncovered.length !== 1 ? 's' : ''}</strong> still need${uncovered.length === 1 ? 's' : ''} a control selected: ${uncovered.map(r => r.display_name).join(', ')}.`;
      el.appendChild(err);
    }
  }

  function _selectedCountForRisk(risk) {
    return risk.controls.filter(c => !!_state.riskSelected[c.pk_Risk_Control_ID]).length;
  }

  // ---- Risk accordion (individual risk) -----------------------
  function _buildRiskAccordion(risk, idx) {
    const sec = _el('div', 'wiz9-risk-sec');
    sec.dataset.riskId = risk.risk_id;

    const hdr = _el('div', 'wiz9-risk-hdr');

    // Left: risk heading
    const left = _el('div', 'wiz9-risk-hdr-left');

    const riskIcon = _el('span', 'wiz-item-icon');
    riskIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    left.appendChild(riskIcon);

    const rName = _el('span', 'wiz-item-name');
    rName.textContent = risk.display_name;
    left.appendChild(rName);

    if (risk.fk_AI_Article_ID) {
      left.appendChild(_el('span', 'wiz-art-tag', { textContent: WizUtils.artLabel(risk.fk_AI_Article_ID) }));
    }

    hdr.appendChild(left);

    // Right: selection count + select-all/none + chevron
    const right = _el('div', 'wiz9-risk-hdr-right');

    const selAll   = document.createElement('button'); selAll.className   = 'wiz9-sel-btn'; selAll.textContent   = 'Select all';
    const deselAll = document.createElement('button'); deselAll.className = 'wiz9-sel-btn'; deselAll.textContent = 'Deselect all';
    selAll.addEventListener('click', e => {
      e.stopPropagation();
      risk.controls.filter(c => c.control_source !== 'Framework_Statement').forEach(c => { _state.riskSelected[c.pk_Risk_Control_ID] = true; });
      _syncRisk(sec, risk);
    });
    deselAll.addEventListener('click', e => {
      e.stopPropagation();
      risk.controls.filter(c => c.control_source !== 'Framework_Statement').forEach(c => { _state.riskSelected[c.pk_Risk_Control_ID] = false; });
      _syncRisk(sec, risk);
    });
    right.appendChild(selAll); right.appendChild(deselAll);

    const selBadge = _el('span', 'wiz-item-badge');
    selBadge.id = `wiz9-rb-${_safeId(risk.risk_id)}`;
    right.appendChild(selBadge);

    const chevron = _el('span', 'wiz9-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)';
    right.appendChild(chevron);
    hdr.appendChild(right);
    sec.appendChild(hdr);

    // Body (collapsed by default, first risk open)
    const body = _el('div', 'wiz9-risk-body wiz9-collapsed');

    // Risk description
    if (risk.risk_description) {
      const desc = _el('p', 'wiz9-risk-desc');
      desc.textContent = risk.risk_description;
      body.appendChild(desc);
    }

    // Controls label + list
    const fsCtrls  = risk.controls.filter(c => c.control_source === 'Framework_Statement');
    const selCtrls = risk.controls.filter(c => c.control_source !== 'Framework_Statement');

    if (selCtrls.length > 0) {
      const ctrlLbl = _el('p', 'wiz9-ctrl-section-label');
      ctrlLbl.textContent = `Controls (${selCtrls.length})`;
      body.appendChild(ctrlLbl);
      selCtrls.forEach(ctrl => body.appendChild(_buildControlCard(risk, ctrl)));
    } else if (fsCtrls.length === 0) {
      const none = _el('p', 'wiz9-intro');
      none.textContent = 'No controls available for this risk.';
      body.appendChild(none);
    }

    if (fsCtrls.length > 0) {
      const fsLbl = _el('p', 'wiz9-ctrl-section-label wiz9-ctrl-section-label--fs');
      fsLbl.textContent = `Framework Self-Certifications (${fsCtrls.length})`;
      body.appendChild(fsLbl);
      fsCtrls.forEach(ctrl => {
        const card = _el('div', 'wiz9-ctrl-card wiz9-fs-ctrl-card');
        const hdr  = _el('div', 'wiz9-ctrl-hdr');
        const icon = _el('span', 'wiz9-ctrl-icon');
        icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
        hdr.appendChild(icon);
        const badge = _el('span', 'wiz9-src-badge wiz9-fs-src-badge'); badge.textContent = 'Self-certified';
        hdr.appendChild(badge);
        hdr.appendChild(_el('span', 'wiz9-ctrl-name', { textContent: ctrl.jkName }));
        if (ctrl.fk_Harmonised_Standard_IDs) hdr.appendChild(_el('span', 'wiz9-standard-ref', { textContent: WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs) }));
        card.appendChild(hdr);
        if (ctrl.jkObjective) {
          const obj = _el('p', 'wiz9-ctrl-obj'); obj.textContent = ctrl.jkObjective; card.appendChild(obj);
        }
        body.appendChild(card);
      });
    }

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
    secEl.querySelectorAll('.wiz9-ctrl-cb[data-key]').forEach(cb => {
      cb.checked = !!_state.riskSelected[cb.dataset.key];
    });
    _updateRiskBadge(secEl, risk);
    _updateValidationBanner();
    _updateCountBadge();
  }

  function _updateRiskBadge(secEl, risk) {
    // Count all controls including Framework_Statement self-certifications —
    // FS controls are always selected, so they should be reflected in the tally.
    const total = risk.controls.length;
    const sel   = risk.controls.filter(c => !!_state.riskSelected[c.pk_Risk_Control_ID]).length;
    const badge = secEl.querySelector(`#wiz9-rb-${_safeId(risk.risk_id)}`);
    if (!badge) return;
    badge.textContent = `${sel} / ${total}`;
    badge.className = sel === 0
      ? 'wiz-item-badge wiz-item-badge--none'
      : sel === total
        ? 'wiz-item-badge wiz-item-badge--ok'
        : 'wiz-item-badge wiz-item-badge--partial';
  }

  // ---- Control card -------------------------------------------
  function _buildControlCard(risk, ctrl) {
    const card = _el('div', 'wiz9-ctrl-card');

    // Header: checkbox + source badge + name + standard_ref + maturity
    const hdr = _el('div', 'wiz9-ctrl-hdr');
    const cb  = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wiz9-ctrl-cb';
    cb.dataset.key = ctrl.pk_Risk_Control_ID;
    cb.checked = !!_state.riskSelected[ctrl.pk_Risk_Control_ID];
    cb.addEventListener('change', e => {
      _state.riskSelected[ctrl.pk_Risk_Control_ID] = e.target.checked;
      const sec = _container.querySelector(`.wiz9-risk-sec[data-risk-id="${CSS.escape(risk.risk_id)}"]`);
      if (sec) _updateRiskBadge(sec, risk);
      _updateValidationBanner();
      _updateCountBadge();
    });
    hdr.appendChild(cb);

    const ctrlIcon = _el('span', 'wiz9-ctrl-icon');
    ctrlIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    hdr.appendChild(ctrlIcon);

    // Source badge
    const src = ctrl.control_source || ctrl._source || '';
    const srcBadge = _el('span', 'wiz9-src-badge wiz9-src-badge--eu');
    srcBadge.textContent = src || 'EU AI Act';
    hdr.appendChild(srcBadge);

    const cName = _el('span', 'wiz9-ctrl-name'); cName.textContent = ctrl.jkName; hdr.appendChild(cName);

    if (ctrl.fk_Harmonised_Standard_IDs) {
      const stdRef = _el('span', 'wiz9-standard-ref');
      stdRef.textContent = WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs);
      hdr.appendChild(stdRef);
    }

    if (ctrl.jkMaturity) {
      const mat = _el('span', 'wiz9-maturity-badge');
      mat.textContent = ctrl.jkMaturity;
      hdr.appendChild(mat);
    }

    // R→T pairing chip
    const tc = _tcByRC?.get(ctrl.pk_Risk_Control_ID);
    if (tc) {
      const tcBadge = _el('span', 'wiz9-test-pair-badge');
      tcBadge.textContent = `🧪 ${tc.control_ref}`;
      tcBadge.title = tc.jkName || '';
      hdr.appendChild(tcBadge);
    }

    card.appendChild(hdr);

    // Control objective
    if (ctrl.jkObjective) {
      const obj = _el('p', 'wiz9-ctrl-obj');
      obj.textContent = ctrl.jkObjective;
      card.appendChild(obj);
    }

    return card;
  }

  // ================================================================
  // ---- Group Standards Compliance — controls for GS risks --------
  // ================================================================
  function _buildGroupStandardsCompliancePane() {
    const card = _el('div', 'step-detail-card');
    const ey = _el('p', `step-detail-eyebrow color-${_colorKey}`); ey.textContent = _phaseTitle; card.appendChild(ey);
    const title = _el('h2', 'step-detail-title'); title.textContent = 'Controls for Group Standards Compliance'; card.appendChild(title);
    card.appendChild(_el('p', 'step-detail-summary', { textContent: 'Select the controls that treat each applicable Group Standard risk (derived from the Acceptable Use of AI Tools Standard).' }));

    if (_gsRiskData.length === 0) {
      const warn = _el('div', 'wiz9-warn');
      warn.innerHTML = '<strong>No applicable Group Standard risks.</strong> In Step 5 → Group Standards Risks, mark at least one risk as applicable and save.';
      card.appendChild(warn);
      return card;
    }

    card.appendChild(_sectionLabel(`Group Standard Risks (${_gsRiskData.length})`));
    card.appendChild(_el('p', 'wiz9-intro', { innerHTML: 'Review controls grouped by risk and select those relevant to this use case. The assessor decides which monitoring controls apply.' }));

    const list = _el('div', 'wiz9-risk-list');
    _gsRiskData.forEach((r, i) => list.appendChild(_buildGsRiskAccordion(r, i)));
    card.appendChild(list);

    const actRow = _el('div', 'wiz-action-row');
    const saveBtn = _el('button', 'wiz-btn-primary');
    saveBtn.textContent = 'Save Group Standards Controls ✓';
    saveBtn.addEventListener('click', _handleGroupStandardsSave);
    actRow.appendChild(saveBtn);
    card.appendChild(actRow);
    card.appendChild(_el('div', 'wiz9-results', { id: 'gs-results' }));
    return card;
  }

  function _buildGsRiskAccordion(risk, idx) {
    const sec = _el('div', 'wiz9-risk-sec');
    sec.dataset.riskId = risk.risk_id;

    const hdr = _el('div', 'wiz9-risk-hdr');
    const left = _el('div', 'wiz9-risk-hdr-left');
    left.appendChild(_el('span', 'wiz-art-tag', { textContent: risk.groupstandard_ref || 'Group Standard' }));
    left.appendChild(_el('span', 'wiz9-risk-name', { textContent: risk.display_name }));
    hdr.appendChild(left);

    const right = _el('div', 'wiz9-risk-hdr-right');
    const badge = _el('span', 'wiz-item-badge'); badge.id = `gs-rb-${_safeId(risk.risk_id)}`;
    right.appendChild(badge);
    const chevron = _el('span', 'wiz9-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = idx === 0 ? '' : 'rotate(-90deg)';
    right.appendChild(chevron);
    hdr.appendChild(right);
    sec.appendChild(hdr);

    const body = _el('div', 'wiz9-risk-body' + (idx === 0 ? '' : ' wiz9-collapsed'));
    if (risk.risk_description) body.appendChild(_el('p', 'wiz9-risk-desc', { textContent: risk.risk_description }));
    if (risk.controls.length) {
      body.appendChild(_el('p', 'wiz9-ctrl-section-label', { textContent: `Controls (${risk.controls.length})` }));
      risk.controls.forEach(c => body.appendChild(_buildGsControlCard(risk, c)));
    } else {
      body.appendChild(_el('p', 'wiz9-intro', { textContent: 'No controls available for this risk.' }));
    }
    sec.appendChild(body);

    hdr.addEventListener('click', e => {
      if (e.target.closest('.wiz9-ctrl-cb')) return;
      const collapsed = body.classList.toggle('wiz9-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });

    _updateGsBadge(sec, risk);
    return sec;
  }

  function _buildGsControlCard(risk, ctrl) {
    const card = _el('div', 'wiz9-ctrl-card');
    const hdr = _el('div', 'wiz9-ctrl-hdr');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wiz9-ctrl-cb';
    cb.dataset.key = ctrl.pk_Risk_Control_ID;
    cb.checked = !!_state.gsSelected[ctrl.pk_Risk_Control_ID];
    cb.addEventListener('change', e => {
      _state.gsSelected[ctrl.pk_Risk_Control_ID] = e.target.checked;
      const sec = _container.querySelector(`.wiz9-risk-sec[data-risk-id="${CSS.escape(risk.risk_id)}"]`);
      if (sec) _updateGsBadge(sec, risk);
    });
    hdr.appendChild(cb);

    const icon = _el('span', 'wiz9-ctrl-icon');
    icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    hdr.appendChild(icon);

    hdr.appendChild(_el('span', 'wiz9-src-badge wiz9-src-badge--gs', { textContent: 'Group Standard' }));
    hdr.appendChild(_el('span', 'wiz9-ctrl-name', { textContent: ctrl.jkName }));
    if (ctrl.fk_Harmonised_Standard_IDs) hdr.appendChild(_el('span', 'wiz9-standard-ref', { textContent: WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs) }));
    card.appendChild(hdr);

    if (ctrl.jkObjective) card.appendChild(_el('p', 'wiz9-ctrl-obj', { textContent: ctrl.jkObjective }));
    return card;
  }

  function _updateGsBadge(secEl, risk) {
    const total = risk.controls.length;
    const sel = risk.controls.filter(c => !!_state.gsSelected[c.pk_Risk_Control_ID]).length;
    const badge = secEl.querySelector(`#gs-rb-${_safeId(risk.risk_id)}`);
    if (!badge) return;
    badge.textContent = `${sel} / ${total}`;
    badge.className = sel === 0 ? 'wiz-item-badge wiz-item-badge--none'
      : sel === total ? 'wiz-item-badge wiz-item-badge--ok'
      : 'wiz-item-badge wiz-item-badge--partial';
  }

  function _handleGroupStandardsSave() {
    const today = new Date().toISOString().slice(0, 10);
    if (!_record) _record = {};
    if (!_record._meta) _record._meta = { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    const existing = _record['step-6'] || { step_id: 'step-6', step_title: 'Control identification' };
    existing.group_standard_controls = _buildGroupStandardControlsOutput(today);
    _record['step-6'] = existing;
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Group Standards controls saved ✓');
    const results = _container.querySelector('#gs-results');
    if (results) {
      const n = existing.group_standard_controls.selected_count;
      results.innerHTML = `<div class="wiz9-info">✓ Saved — <strong>${n}</strong> Group Standard control${n !== 1 ? 's' : ''} selected.</div>`;
    }
  }

  function _buildGroupStandardControlsOutput(today) {
    const controls = [];
    _gsRiskData.forEach(r => {
      r.controls.forEach(c => {
        controls.push({
          control_id:     c.pk_Risk_Control_ID,
          control_name:   c.jkName,
          control_source: c.control_source || 'Group_Standard',
          fk_Harmonised_Standard_IDs: c.fk_Harmonised_Standard_IDs || '',
          risk_id:        r.risk_id,
          selected:       !!_state.gsSelected[c.pk_Risk_Control_ID]
        });
      });
    });
    return {
      assessment_date: today || new Date().toISOString().slice(0, 10),
      total_risks:     _gsRiskData.length,
      selected_count:  controls.filter(c => c.selected).length,
      controls
    };
  }

  // ---- Task + Code Sample section -----------------------------
  function _buildTaskCodeSection(tasks) {
    const count = tasks.length;

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

    tasks.forEach(taskObj => {
      const pair = _el('div', 'wiz9-pair');

      // Task
      const taskWrap = _el('div', 'wiz9-task-wrap');
      const taskNumBadge = _el('span', 'wiz9-task-num');
      taskNumBadge.textContent = `Task ${taskObj.task_number}`;
      taskWrap.appendChild(taskNumBadge);
      const taskBody = _el('p', 'wiz9-task-text');
      taskBody.textContent = _stripLeadingNum(taskObj.task);
      taskWrap.appendChild(taskBody);
      pair.appendChild(taskWrap);

      // Code sample
      if (taskObj.sample) {
        const codeWrap  = _el('div', 'wiz9-code-wrap');
        const codeBadge = _el('span', 'wiz9-code-badge');
        codeBadge.textContent = `Code Sample ${taskObj.task_number}`;
        codeWrap.appendChild(codeBadge);
        const pre  = document.createElement('pre');
        pre.className = 'wiz9-code-block';
        const code = document.createElement('code');
        code.textContent = _extractCode(taskObj.sample);
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

  // ---- Compliance Additions section (wizard tab) --------------
  function _buildComplianceAdditionsSection() {
    const wrap = _el('div', 'wiz9-comp-adds-wrap');
    wrap.id = 'wiz9-comp-adds';

    const hdr = _el('div', 'wiz9-comp-adds-hdr');
    const icon = _el('span', 'wiz9-comp-adds-icon'); icon.textContent = '⚖';
    hdr.appendChild(icon);
    const titleWrap = _el('div', 'wiz9-comp-adds-title-wrap');
    titleWrap.appendChild(_el('span', 'wiz9-comp-adds-title', { textContent: 'Compliance Additions' }));
    titleWrap.appendChild(_el('span', 'wiz9-comp-adds-sub', { textContent: 'Controls added by the compliance team to cover HS requirements not addressed by the risk selections above.' }));
    hdr.appendChild(titleWrap);
    wrap.appendChild(hdr);

    const body = _el('div', 'wiz9-comp-adds-body');
    const adds = Object.keys(_state.complianceSelected).filter(id => _state.complianceSelected[id]);

    if (adds.length === 0) {
      const emp = _el('p', 'wiz9-comp-adds-empty');
      emp.textContent = 'No compliance additions yet. Use the AI Act Compliance View tab to add controls for uncovered HS requirements.';
      body.appendChild(emp);
    } else {
      adds.forEach(ctrlId => {
        const ctrl = (_tblData.controls || []).find(c => c.pk_Risk_Control_ID === ctrlId);
        if (!ctrl) return;
        const row = _el('div', 'wiz9-comp-add-item');
        const dot = _el('span', 'wiz9-cmp-ctrl-dot wiz9-cmp-ctrl-dot--hs'); row.appendChild(dot);
        row.appendChild(_el('span', 'wiz9-cmp-ctrl-id',   { textContent: ctrl.pk_Risk_Control_ID }));
        row.appendChild(_el('span', 'wiz9-cmp-ctrl-name', { textContent: ctrl.jkName || '' }));
        if (ctrl.fk_Harmonised_Standard_IDs) row.appendChild(_el('span', 'wiz9-standard-ref', { textContent: WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs) }));
        const compBadge = _el('span', 'wiz9-comp-adds-badge'); compBadge.textContent = 'Compliance'; row.appendChild(compBadge);
        body.appendChild(row);
      });
    }
    wrap.appendChild(body);
    return wrap;
  }

  // ---- DPIA Additions section (wizard tab) --------------------
  function _buildDpiaControlsPane() {
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('p', `step-detail-eyebrow color-${_colorKey}`, { textContent: _phaseTitle }));
    card.appendChild(_el('h2', 'step-detail-title', { textContent: 'DPIA Controls' }));
    card.appendChild(_el('p', 'step-detail-summary', { textContent: 'Technical security measures committed in the DPIA (Step 4). These are carried forward automatically into the control register.' }));
    card.appendChild(_buildDpiaAdditionsSection());
    return card;
  }

  function _buildDpiaAdditionsSection() {
    const wrap = _el('div', 'wiz9-dpia-adds-wrap');

    const body = _el('div', 'wiz9-dpia-adds-body');
    const step4 = _record?.['step-4'];
    const measures = step4?.data_types_identified?.security_measures || [];

    if (!step4) {
      const emp = _el('p', 'wiz9-dpia-adds-empty');
      emp.textContent = 'Step 4 (DPIA) not yet completed. Complete and save the DPIA first.';
      body.appendChild(emp);
    } else if (measures.length === 0) {
      const emp = _el('p', 'wiz9-dpia-adds-empty');
      emp.textContent = 'No technical security measures were recorded in the DPIA.';
      body.appendChild(emp);
    } else {
      measures.forEach(m => {
        const row = _el('div', 'wiz9-dpia-add-item');
        const dot = _el('span', 'wiz9-dpia-dot'); row.appendChild(dot);
        const name = _el('span', 'wiz9-dpia-add-name'); name.textContent = m; row.appendChild(name);
        const badge = _el('span', 'wiz9-dpia-badge'); badge.textContent = 'DPIA'; row.appendChild(badge);
        body.appendChild(row);
      });
    }

    wrap.appendChild(body);
    return wrap;
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
    const total   = _riskData.length;
    const covered = _riskData.filter(r => _selectedCountForRisk(r) > 0).length;
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
        `.wiz9-risk-sec[data-risk-id="${CSS.escape(uncovered[0].risk_id)}"]`
      );
      if (firstSec) {
        firstSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        firstSec.classList.add('wiz9-risk-sec--error');
        setTimeout(() => firstSec.classList.remove('wiz9-risk-sec--error'), 2500);
      }
      return;
    }

    const rec9 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-6'] = rec9;
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 9 saved ✓');
    _renderResults(rec9);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};

    // risk team's selections
    const risk_controls = [];
    _riskData.forEach(r => {
      r.controls.forEach(c => {
        risk_controls.push({
          control_id:     c.pk_Risk_Control_ID,
          control_name:   c.jkName,
          control_source: c.control_source || c._source || '',
          fk_Harmonised_Standard_IDs: c.fk_Harmonised_Standard_IDs || '',
          risk_id:        r.risk_id,
          selected:       !!_state.riskSelected[c.pk_Risk_Control_ID]
        });
      });
    });

    // compliance additions
    const complianceAdditions = Object.keys(_state.complianceSelected)
      .filter(id => _state.complianceSelected[id])
      .map(id => {
        const ctrl = (_tblData.controls || []).find(c => c.pk_Risk_Control_ID === id);
        return { control_id: id, control_name: ctrl?.jkName || '', fk_Harmonised_Standard_IDs: ctrl?.fk_Harmonised_Standard_IDs || '', selected: true};
      });

    // DPIA controls from Step 4
    const dpiaControls = (_record?.['step-4']?.data_types_identified?.security_measures || [])
      .map(m => ({ control_name: m, source: 'DPIA_Step4' }));

    // counts
    const selectedCount   = risk_controls.filter(c => c.selected).length;
    const complianceCount = complianceAdditions.length;
    const dpiaCount       = dpiaControls.length;

    return {
      step_id: 'step-6', step_title: 'Control identification',
      assessment_date: today,
      assessed_by:  meta.assessed_by || '',
      use_case_id:  meta.use_case_id || '',
      total_risks:              _riskData.length,
      risks_controlled:         _riskData.filter(r => _selectedCountForRisk(r) > 0).length,
      total_controls_available: risk_controls.length,
      selected_controls:        selectedCount,
      compliance_additions_count: complianceCount,
      dpia_controls_count:      dpiaCount,
      risk_controls,
      compliance_additions: complianceAdditions,
      dpia_controls:        dpiaControls,
      // Preserve the Group Standards selections so this save does not wipe them
      group_standard_controls: _buildGroupStandardControlsOutput(today)
    };
  }

  function _renderResults(rec9) {
    const area = _container.querySelector('.wiz9-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'wiz9-result-card');
    const h = _el('h3', 'wiz9-result-title'); h.textContent = 'Control Selection Saved'; card.appendChild(h);
    const stats = _el('div', 'wiz9-result-stats');
    [
      [rec9.total_risks,                  'Total risks'],
      [rec9.risks_controlled,             'Risks controlled'],
      [rec9.selected_controls,            'Controls selected'],
      [rec9.dpia_controls_count,          'DPIA controls'],
      [rec9.compliance_additions_count,   'Compliance additions']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num); s.appendChild(n);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl; s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);
    const note = _el('p', 'wiz9-result-note');
    note.innerHTML = `Control selection saved. <strong>${rec9.selected_controls} control${rec9.selected_controls !== 1 ? 's' : ''}</strong> selected across <strong>${rec9.risks_controlled} risk${rec9.risks_controlled !== 1 ? 's' : ''}</strong>` +
      (rec9.compliance_additions_count > 0 ? ` plus <strong>${rec9.compliance_additions_count} compliance addition${rec9.compliance_additions_count !== 1 ? 's' : ''}</strong>` : '') +
      `. This feeds into the Approval Gate (Step 11) submission pack.`;
    card.appendChild(note);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane (rebuilds on tab switch — always reflects current selections) ---
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');
    const title = _el('h2', 'step-detail-title'); title.textContent = 'Control Catalogue Reference'; card.appendChild(title);

    if (_riskData.length === 0) {
      const p = _el('p', 'wiz9-intro'); p.textContent = 'No risks selected in Step 5.'; card.appendChild(p);
      return card;
    }

    // Live selection summary
    const totalCtrls = _riskData.reduce((n, r) => n + r.controls.length, 0);
    const selCtrls   = _riskData.reduce((n, r) => n + r.controls.filter(c => !!_state.riskSelected[c.pk_Risk_Control_ID]).length, 0);
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

      // Risk header with source badges + live count
      const hdr = _el('div', 'wiz9-ref-risk-hdr');
      const rn  = _el('span', 'wiz9-ref-risk-name'); rn.textContent = risk.display_name; hdr.appendChild(rn);
      const eb  = _el('span', 'wiz9-src-badge wiz9-src-badge--eu'); eb.textContent = 'EU AI Act'; hdr.appendChild(eb);
      const rb = _el('span', selCount === 0
        ? 'wiz-item-badge wiz-item-badge--none'
        : selCount === risk.controls.length
          ? 'wiz-item-badge wiz-item-badge--ok'
          : 'wiz-item-badge wiz-item-badge--partial');
      rb.textContent = `${selCount} / ${risk.controls.length}`;
      hdr.appendChild(rb);
      sec.appendChild(hdr);

      risk.controls.forEach(ctrl => {
        const isSelected = !!_state.riskSelected[ctrl.pk_Risk_Control_ID];

        const cc = _el('div', isSelected ? 'wiz9-ref-ctrl' : 'wiz9-ref-ctrl wiz9-ref-ctrl--deselected');
        const ch = _el('div', 'wiz9-ref-ctrl-hdr');

        // Selection indicator
        const selInd = _el('span', isSelected ? 'wiz9-ref-sel-ind wiz9-ref-sel-ind--on' : 'wiz9-ref-sel-ind wiz9-ref-sel-ind--off');
        selInd.textContent = isSelected ? '✓' : '✗';
        ch.appendChild(selInd);

        const ci = _el('span', 'wiz9-ctrl-icon');
        ci.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
        ch.appendChild(ci);

        // Source badge
        const src = ctrl.control_source || ctrl._source || '';
        const srcBadge = _el('span', 'wiz9-src-badge wiz9-src-badge--eu');
        srcBadge.textContent = src || 'EU AI Act';
        ch.appendChild(srcBadge);

        const cn = _el('span', 'wiz9-ref-ctrl-name'); cn.textContent = ctrl.jkName; ch.appendChild(cn);
        if (ctrl.fk_Harmonised_Standard_IDs) {
          const stdRef = _el('span', 'wiz9-standard-ref'); stdRef.textContent = WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs); ch.appendChild(stdRef);
        }
        cc.appendChild(ch);

        // Only expand tasks for selected controls
        if (isSelected) {
          if (ctrl.jkObjective) {
            const obj = _el('p', 'wiz9-ctrl-obj'); obj.textContent = ctrl.jkObjective; cc.appendChild(obj);
          }
          (ctrl.tasks || []).forEach(taskObj => {
            if (!taskObj.task && !taskObj.sample) return;   // architecture-specific detail removed
            const pair = _el('div', 'wiz9-ref-pair');
            const tn = _el('span', 'wiz9-task-num'); tn.textContent = `Task ${taskObj.task_number}`; pair.appendChild(tn);
            if (taskObj.task) { const tt = _el('p', 'wiz9-task-text'); tt.textContent = _stripLeadingNum(taskObj.task); pair.appendChild(tt); }
            if (taskObj.sample) {
              const cb2 = _el('span', 'wiz9-code-badge'); cb2.textContent = `Code ${taskObj.task_number}`; pair.appendChild(cb2);
              const pre = document.createElement('pre'); pre.className = 'wiz9-code-block';
              const code = document.createElement('code'); code.textContent = _extractCode(taskObj.sample);
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

  // ================================================================
  // ---- AI Act Compliance View ---------------------------------
  // ================================================================

  function _buildCompliancePane() {
    const wrap = _el('div', 'wiz9-cmp-wrap');

    // Header
    const hdr = _el('div', 'wiz9-cmp-header');
    hdr.appendChild(_el('h3', 'wiz9-cmp-title', { textContent: 'AI Act Compliance View' }));
    const sub = _el('p', 'wiz9-cmp-subtitle');
    sub.textContent = 'Full traceability: EU AI Act article → harmonised standard requirements → risks → controls → tests.';
    hdr.appendChild(sub);
    const desc = _el('p', 'wiz9-cmp-desc');
    desc.textContent = 'This view shows how the risks and controls identified for your AI system map to each EU AI Act harmonised standard (HS) requirement. A ✓ Covered status means at least one selected control satisfies the requirement. A ⚠ Gap means the requirement is unmet — you can add a control from the list below it, or mark it Not Applicable with a justification if the requirement does not apply to your system.';
    hdr.appendChild(desc);

    const step3 = _record?.['step-3'];
    if (!step3) {
      const note = _el('div', 'wiz9-cmp-pending-note');
      note.innerHTML = '<strong>Classification not yet complete.</strong> Complete Step 3 to see relevance determinations. All articles, risks, controls and tests are shown below.';
      hdr.appendChild(note);
    } else {
      const outcome = step3.axis_b?.ai_act_outcome;
      const role    = step3.axis_b?.organisation_role;
      const statusDiv = _el('div', 'wiz9-cmp-status-row');
      statusDiv.innerHTML =
        `<span class="wiz9-cmp-badge wiz9-cmp-badge--${outcome === 'HIGH_RISK' ? 'applicable' : outcome === 'PROHIBITED' ? 'blocked' : 'na'}">${outcome || 'Unknown'}</span>` +
        (role ? `<span class="wiz9-cmp-obl">${role === 'provider' ? 'Provider (builder)' : 'Deployer (subscriber)'}</span>` : '');
      hdr.appendChild(statusDiv);
    }
    wrap.appendChild(hdr);

    // Save bar
    const saveBar = _el('div', 'wiz9-cmp-save-bar');
    const compCount = Object.values(_state.complianceSelected).filter(Boolean).length;
    const naCount   = Object.keys(_state.hsNotApplicable).length;
    const saveSummary = _el('span', 'wiz9-cmp-save-summary');
    saveSummary.textContent = (compCount > 0 || naCount > 0)
      ? [compCount > 0 ? `${compCount} addition${compCount !== 1 ? 's' : ''}` : '',
         naCount   > 0 ? `${naCount} N/A decision${naCount !== 1 ? 's' : ''}` : '']
        .filter(Boolean).join(', ') + ' pending save'
      : 'No changes to save';
    saveBar.appendChild(saveSummary);
    const saveBtn = _el('button', 'wiz9-cmp-save-btn'); saveBtn.textContent = 'Save Compliance Additions';
    saveBtn.addEventListener('click', _handleComplianceSave);
    saveBar.appendChild(saveBtn);
    wrap.insertBefore(saveBar, wrap.children[1]); // after header

    const ix = _buildCmpIndexes();
    WizUtils.ARTICLES.forEach(art => wrap.appendChild(_buildCmpArticleRow(art, ix)));
    return wrap;
  }

  // ---- Compliance save ----------------------------------------
  function _handleComplianceSave() {
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();

    const today = new Date().toISOString().slice(0, 10);
    const existing = _record['step-6'] || {};

    const complianceAdditions = Object.keys(_state.complianceSelected)
      .filter(id => _state.complianceSelected[id])
      .map(id => {
        const ctrl = (_tblData.controls || []).find(c => c.pk_Risk_Control_ID === id);
        return { control_id: id, control_name: ctrl?.jkName || '', fk_Harmonised_Standard_IDs: ctrl?.fk_Harmonised_Standard_IDs || '', selected: true};
      });

    _record['step-6'] = {
      ...existing,
      assessment_date: existing.assessment_date || today,
      compliance_additions_count: complianceAdditions.length,
      compliance_additions: complianceAdditions,
      hs_not_applicable: { ..._state.hsNotApplicable }
    };

    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Compliance additions saved ✓');

    // Refresh wizard tab compliance section
    const addsEl = _container.querySelector('#wiz9-comp-adds');
    if (addsEl) { const fresh = _buildComplianceAdditionsSection(); addsEl.replaceWith(fresh); }

    // Rebuild compliance pane to update save bar
    const cmpPane = _container.querySelector('[data-pane="compliance"]');
    if (cmpPane) { cmpPane.innerHTML = ''; cmpPane.appendChild(_buildCompliancePane()); }
  }

  // ---- N/A inline form ----------------------------------------
  function _showNaForm(item, ref, existingReason) {
    const existing = item.querySelector('.wiz9-cmp-na-form');
    if (existing) existing.remove();

    const form = _el('div', 'wiz9-cmp-na-form');

    const lbl = _el('label', 'wiz9-cmp-na-form-lbl');
    lbl.textContent = 'Justification for Not Applicable:';
    form.appendChild(lbl);

    const ta = document.createElement('textarea');
    ta.className = 'wiz9-cmp-na-textarea';
    ta.placeholder = 'e.g. This system does not generate synthetic media — Art.50(4) does not apply.';
    ta.value = existingReason;
    ta.rows = 2;
    form.appendChild(ta);

    const btnRow = _el('div', 'wiz9-cmp-na-form-btns');

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'wiz9-cmp-na-confirm-btn';
    confirmBtn.textContent = existingReason ? 'Update' : 'Confirm N/A';
    confirmBtn.addEventListener('click', () => {
      const reason = ta.value.trim();
      if (!reason) { ta.style.borderColor = '#ec6a68'; ta.focus(); return; }
      _state.hsNotApplicable[ref] = { reason, date: new Date().toISOString().slice(0, 10) };
      _rebuildCmpPane();
    });
    btnRow.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'wiz9-cmp-na-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => form.remove());
    btnRow.appendChild(cancelBtn);

    if (existingReason) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'wiz9-cmp-na-clear-btn';
      clearBtn.textContent = 'Remove N/A';
      clearBtn.addEventListener('click', () => {
        delete _state.hsNotApplicable[ref];
        _rebuildCmpPane();
      });
      btnRow.appendChild(clearBtn);
    }

    form.appendChild(btnRow);
    item.appendChild(form);
    ta.focus();
  }

  function _rebuildCmpPane() {
    const cmpPane = _container.querySelector('[data-pane="compliance"]');
    if (cmpPane) { cmpPane.innerHTML = ''; cmpPane.appendChild(_buildCompliancePane()); }
  }

  // Pre-build lookup maps for O(1) access during render
  function _buildCmpIndexes() {
    const d = _tblData;

    const hsByArticle = new Map();
    (d.hs || []).forEach(h => {
      if (!hsByArticle.has(h.fk_AI_Article_ID)) hsByArticle.set(h.fk_AI_Article_ID, []);
      hsByArticle.get(h.fk_AI_Article_ID).push(h);
    });

    const risksByArticle = new Map();
    (d.risks || []).forEach(r => {
      if (!risksByArticle.has(r.fk_AI_Article_ID)) risksByArticle.set(r.fk_AI_Article_ID, []);
      risksByArticle.get(r.fk_AI_Article_ID).push(r);
    });

    const ctrlsByRisk = new Map();
    (d.controls || []).forEach(c => {
      if (!ctrlsByRisk.has(c.fk_Risk_ID)) ctrlsByRisk.set(c.fk_Risk_ID, []);
      ctrlsByRisk.get(c.fk_Risk_ID).push(c);
    });

    // Index controls by each individual standard_ref so we can find which controls
    // implement a given HS requirement
    const ctrlsByRef = new Map();
    (d.controls || []).forEach(c => {
      (c.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean).forEach(ref => {
        if (!ctrlsByRef.has(ref)) ctrlsByRef.set(ref, []);
        ctrlsByRef.get(ref).push(c);
      });
    });

    const tasksByCtrl = new Map();
    (d.tasks || []).forEach(t => {
      if (!tasksByCtrl.has(t.fk_Risk_Control_ID)) tasksByCtrl.set(t.fk_Risk_Control_ID, []);
      tasksByCtrl.get(t.fk_Risk_Control_ID).push(t);
    });
    tasksByCtrl.forEach(ts => ts.sort((a, b) => a.task_number - b.task_number));

    // Index test controls by each individual standard_ref in their comma-separated list
    const testCtrlByRef = new Map();
    (d.testControls || []).forEach(tc => {
      (tc.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean).forEach(ref => {
        if (!testCtrlByRef.has(ref)) testCtrlByRef.set(ref, []);
        testCtrlByRef.get(ref).push(tc);
      });
    });

    // Test control by risk control — direct R→T FK
    const testCtrlByRC = new Map();
    (d.testControls || []).forEach(tc => {
      if (tc.fk_Risk_Control_ID) testCtrlByRC.set(tc.fk_Risk_Control_ID, tc);
    });

    return { hsByArticle, risksByArticle, ctrlsByRisk, ctrlsByRef, tasksByCtrl, testCtrlByRef, testCtrlByRC };
  }

  // Derive relevance of an article from the step-3 record
  function _cmpRelevance(article) {
    const step3 = _record?.['step-3'];
    if (!step3) return { status: 'pending', label: 'Pending', reason: 'Complete Step 3 classification to see relevance.' };

    const outcome = step3.axis_b?.ai_act_outcome;
    if (outcome === 'PROHIBITED')  return { status: 'blocked', label: 'Prohibited',    reason: 'System is prohibited — no obligations apply.' };
    if (outcome === 'OUT_OF_SCOPE') return { status: 'na',      label: 'Out of scope', reason: 'System is out of scope for the EU AI Act.' };

    const m = article.article_name.match(/^(Article \d+[a-zA-Z]*)/);
    if (!m) return { status: 'pending', label: '—', reason: '' };
    const num = m[1];

    const applicable = step3.axis_b?.applicable_articles || [];
    const found = applicable.find(a => a.article_number === num);

    if (found) {
      const isSubMod    = step3.axis_b?.substantial_modification_applies;
      const isOverride  = step3.axis_b?.art25_override;
      let trigger = found.trigger_reason || '';
      if (isSubMod && isOverride && ['Article 9','Article 10','Article 11','Article 12','Article 13','Article 14','Article 15','Article 17','Article 43','Article 72'].includes(num))
        trigger = (trigger ? trigger + ' ' : '') + '(Substantial modification detected — legal counsel override applied; proceeding as Deployer but provider obligations apply.)';
      else if (isSubMod && !isOverride && ['Article 9','Article 10','Article 11','Article 12','Article 13','Article 14','Article 15','Article 17','Article 43','Article 72'].includes(num))
        trigger = (trigger ? trigger + ' ' : '') + '(Added because a substantial modification was identified in Step 3 — your organisation is acting as Provider for this system.)';
      return {
        status:           'applicable',
        label:            'Applicable',
        obligation_type:  (found.obligation_type || '').replace(/_/g, ' '),
        trigger_reason:   trigger
      };
    }

    // Explain why not triggered
    const role = step3.axis_b?.organisation_role;
    let reason = `Not triggered by ${outcome || 'current'} classification.`;
    if (num === 'Article 26' && role === 'provider')
      reason = 'Not applicable — Provider role (Art. 26 applies to Deployers only).';
    else if (num === 'Article 25' && !step3.axis_b?.substantial_modification_applies)
      reason = 'Not triggered — no substantial modification identified in Step 3.';
    else if (num === 'Article 50' && !step3.axis_b?.transparency_obligations_apply)
      reason = 'Not triggered — system does not interact directly with humans or generate synthetic content.';
    else if (['Article 9','Article 10','Article 11','Article 15','Article 17','Article 43','Article 72'].includes(num) && role === 'deployer' && !step3.axis_b?.substantial_modification_applies)
      reason = 'Not directly applicable — Deployer role. These are Provider obligations; verify your Provider complies.';

    return { status: 'na', label: 'Not applicable', reason };
  }

  function _buildCmpArticleRow(article, ix) {
    const rel   = _cmpRelevance(article);
    const hs    = ix.hsByArticle.get(article.pk_AI_Article_ID)    || [];
    const risks = ix.risksByArticle.get(article.pk_AI_Article_ID) || [];

    // Count unique selected controls (risk + compliance) covering this article's HS refs
    const selCtrlIds = new Set();
    hs.forEach(h => {
      (ix.ctrlsByRef.get(h.standard_ref) || []).forEach(c => {
        if (_state.riskSelected[c.pk_Risk_Control_ID] || _state.complianceSelected[c.pk_Risk_Control_ID])
          selCtrlIds.add(c.pk_Risk_Control_ID);
      });
    });

    // Count unique tests covering this article's HS refs
    const testIds = new Set();
    hs.forEach(h => {
      (ix.testCtrlByRef.get(h.standard_ref) || []).forEach(tc => {
        testIds.add(tc.pk_Test_Control_ID || tc.control_ref || tc.jkName);
      });
    });

    const row = _el('div', 'wiz9-cmp-article');

    // ── Header (always visible) ──────────────────────────────────
    const hdr = _el('div', 'wiz9-cmp-art-hdr');

    const left = _el('div', 'wiz9-cmp-art-left');
    left.appendChild(_el('span', 'wiz9-cmp-art-id',   { textContent: article.pk_AI_Article_ID }));
    left.appendChild(_el('span', 'wiz9-cmp-art-name', { textContent: article.article_name }));

    // Move obligation type to left so right side can be a strict grid
    if (rel.obligation_type) left.appendChild(_el('span', 'wiz9-cmp-obl', { textContent: rel.obligation_type }));

    const right = _el('div', 'wiz9-cmp-art-right');
    right.appendChild(_el('span', `wiz9-cmp-badge wiz9-cmp-badge--${rel.status}`, { textContent: rel.label }));

    // Always render all 4 count badges — invisible when zero so columns stay aligned
    const _mkCount = (n, cls, singular, plural) => {
      const s = _el('span', `wiz9-cmp-count ${cls}`);
      s.textContent = `${n} ${n === 1 ? singular : plural}`;
      if (n === 0) s.style.visibility = 'hidden';
      return s;
    };
    right.appendChild(_mkCount(hs.length,       'wiz9-cmp-count--hs',   'HS',   'HS'));
    right.appendChild(_mkCount(risks.length,     'wiz9-cmp-count--risk', 'Risk', 'Risks'));
    right.appendChild(_mkCount(selCtrlIds.size,  'wiz9-cmp-count--ctrl', 'Ctrl', 'Ctrls'));
    right.appendChild(_mkCount(testIds.size,     'wiz9-cmp-count--test', 'Test', 'Tests'));
    const chev = _el('span', 'wiz9-cmp-chevron', { textContent: '▸' });
    right.appendChild(chev);

    hdr.append(left, right);
    row.appendChild(hdr);

    // ── Body (lazy — built on first open) ────────────────────────
    const body = _el('div', 'wiz9-cmp-art-body');
    body.style.display = 'none';
    let built = false;

    const toggle = () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      chev.textContent = open ? '▸' : '▾';
      if (!open && !built) {
        built = true;
        _populateCmpBody(body, article, rel, hs, risks, ix);
      }
    };
    hdr.addEventListener('click', toggle);
    hdr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    hdr.setAttribute('tabindex', '0');

    row.appendChild(body);
    return row;
  }

  function _populateCmpBody(body, article, rel, hs, risks, ix) {
    const { ctrlsByRisk, ctrlsByRef, tasksByCtrl, testCtrlByRef, testCtrlByRC } = ix;

    // Relevance reason
    const reasonText = rel.trigger_reason || rel.reason;
    if (reasonText) {
      const rd = _el('div', `wiz9-cmp-reason wiz9-cmp-reason--${rel.status}`);
      rd.textContent = reasonText;
      body.appendChild(rd);
    }

    // ══ VIEW 1: Compliance — AI Act → HS Requirements → Controls & Tests ══════
    const v1Wrap = _el('div', 'wiz9-cmp-view-wrap');

    const v1Header = _el('div', 'wiz9-cmp-view-hdr wiz9-cmp-view-hdr--compliance');
    const v1Icon = _el('span', 'wiz9-cmp-view-icon'); v1Icon.textContent = '⚖';
    v1Header.appendChild(v1Icon);
    const v1Title = _el('div', 'wiz9-cmp-view-title-wrap');
    v1Title.appendChild(_el('span', 'wiz9-cmp-view-title', { textContent: 'Compliance View' }));
    v1Title.appendChild(_el('span', 'wiz9-cmp-view-sub', { textContent: 'AI Act obligation → HS requirement → controls that implement it → tests that verify it' }));
    v1Header.appendChild(v1Title);
    v1Wrap.appendChild(v1Header);

    if (hs.length === 0) {
      v1Wrap.appendChild(_el('p', 'wiz9-cmp-empty wiz9-cmp-empty--indent', { textContent: 'No harmonised standard requirements mapped to this article.' }));
    } else {
      const hsList = _el('div', 'wiz9-cmp-hs-list');
      hs.forEach(h => {
        const item = _el('div', 'wiz9-cmp-hs-item');

        // HS ref + name + description
        const refRow = _el('div', 'wiz9-cmp-hs-ref-row');
        refRow.appendChild(_el('span', 'wiz9-cmp-ref-tag', { textContent: WizUtils.fmtStdRef(h.standard_ref) }));
        const txt = _el('div', 'wiz9-cmp-hs-txt');
        txt.appendChild(_el('span', 'wiz9-cmp-hs-name', { textContent: h.standard_name }));
        txt.appendChild(_el('span', 'wiz9-cmp-hs-desc', { textContent: h.standard_text }));
        refRow.appendChild(txt);
        item.appendChild(refRow);

        // Coverage detection — Framework_Statement controls are auto-satisfied
        const allCtrls = (ctrlsByRef.get(h.standard_ref) || [])
          .filter((c, i, a) => a.findIndex(x => x.pk_Risk_Control_ID === c.pk_Risk_Control_ID) === i);

        const fsCtrls        = allCtrls.filter(c => c.control_source === 'Framework_Statement');
        const actionCtrls    = allCtrls.filter(c => c.control_source !== 'Framework_Statement');
        const riskCtrls      = actionCtrls.filter(c => !!_state.riskSelected[c.pk_Risk_Control_ID]);
        const compCtrls      = actionCtrls.filter(c => !!_state.complianceSelected[c.pk_Risk_Control_ID]);
        const availableCtrls = actionCtrls.filter(c => !_state.riskSelected[c.pk_Risk_Control_ID] && !_state.complianceSelected[c.pk_Risk_Control_ID]);
        const isCovered      = riskCtrls.length > 0 || compCtrls.length > 0 || fsCtrls.length > 0;

        // Gap / N/A / Self-certified badge
        if (!isCovered) {
          const naEntry = _state.hsNotApplicable[h.standard_ref];
          if (naEntry) {
            const naBadge = _el('span', 'wiz9-cmp-na-badge'); naBadge.textContent = '⊘ Not Applicable';
            refRow.appendChild(naBadge);
            const editBtn = _el('button', 'wiz9-cmp-na-btn wiz9-cmp-na-btn--edit'); editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => _showNaForm(item, h.standard_ref, naEntry.reason));
            refRow.appendChild(editBtn);
            const reasonNote = _el('div', 'wiz9-cmp-na-reason'); reasonNote.textContent = naEntry.reason;
            item.appendChild(reasonNote);
          } else {
            const gapBadge = _el('span', 'wiz9-cmp-gap-badge'); gapBadge.textContent = '⚠ Gap';
            refRow.appendChild(gapBadge);
            const naBtn = _el('button', 'wiz9-cmp-na-btn'); naBtn.textContent = 'Mark N/A';
            naBtn.addEventListener('click', () => _showNaForm(item, h.standard_ref, ''));
            refRow.appendChild(naBtn);
          }
        } else if (fsCtrls.length > 0 && riskCtrls.length === 0 && compCtrls.length === 0) {
          const certBadge = _el('span', 'wiz9-cmp-self-cert-badge'); certBadge.textContent = '✓ Self-certified';
          refRow.appendChild(certBadge);
        }

        // Coverage area
        const implArea = _el('div', 'wiz9-cmp-hs-impl');

        if (riskCtrls.length > 0) {
          implArea.appendChild(_el('p', 'wiz9-cmp-sub-lbl', { textContent: `Risk Controls (${riskCtrls.length})` }));
          riskCtrls.forEach(ctrl => {
            const cRow = _buildCmpCtrlRow(ctrl, tasksByCtrl, false);
            implArea.appendChild(cRow);
          });
        }

        if (compCtrls.length > 0) {
          implArea.appendChild(_el('p', 'wiz9-cmp-sub-lbl wiz9-cmp-sub-lbl--comp', { textContent: `Compliance Additions (${compCtrls.length})` }));
          compCtrls.forEach(ctrl => {
            const cRow = _buildCmpCtrlRow(ctrl, tasksByCtrl, true); // true = show remove btn
            implArea.appendChild(cRow);
          });
        }

        if (availableCtrls.length > 0) {
          implArea.appendChild(_el('p', 'wiz9-cmp-sub-lbl wiz9-cmp-sub-lbl--avail', { textContent: `Available to add (${availableCtrls.length})` }));
          availableCtrls.forEach(ctrl => {
            const aRow = _el('div', 'wiz9-cmp-avail-row');
            const addBtn = _el('button', 'wiz9-cmp-add-btn'); addBtn.textContent = '+ Add';
            addBtn.addEventListener('click', () => {
              _state.complianceSelected[ctrl.pk_Risk_Control_ID] = true;
              // rebuild compliance pane
              const cmpPane = _container.querySelector('[data-pane="compliance"]');
              if (cmpPane) { cmpPane.innerHTML = ''; cmpPane.appendChild(_buildCompliancePane()); }
            });
            aRow.appendChild(addBtn);
            aRow.appendChild(_el('span', 'wiz9-cmp-ctrl-dot wiz9-cmp-ctrl-dot--hs'));
            aRow.appendChild(_el('span', 'wiz9-cmp-ctrl-id',   { textContent: ctrl.pk_Risk_Control_ID }));
            aRow.appendChild(_el('span', 'wiz9-cmp-ctrl-name', { textContent: ctrl.jkName || '' }));
            if (ctrl.fk_Harmonised_Standard_IDs) aRow.appendChild(_el('span', 'wiz9-standard-ref', { textContent: WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs) }));
            implArea.appendChild(aRow);
          });
        }

        if (fsCtrls.length > 0) {
          implArea.appendChild(_el('p', 'wiz9-cmp-sub-lbl wiz9-cmp-sub-lbl--fs', { textContent: `Framework Self-Certifications (${fsCtrls.length})` }));
          fsCtrls.forEach(ctrl => {
            const fsRow = _el('div', 'wiz9-cmp-fs-row');
            fsRow.appendChild(_el('span', 'wiz9-cmp-ctrl-dot wiz9-cmp-ctrl-dot--fs'));
            fsRow.appendChild(_el('span', 'wiz9-cmp-self-cert-badge wiz9-cmp-self-cert-badge--sm', { textContent: 'Self-certified' }));
            fsRow.appendChild(_el('span', 'wiz9-cmp-ctrl-id',   { textContent: ctrl.pk_Risk_Control_ID }));
            fsRow.appendChild(_el('span', 'wiz9-cmp-ctrl-name', { textContent: ctrl.jkName || '' }));
            implArea.appendChild(fsRow);
            if (ctrl.jkObjective) {
              const stmt = _el('div', 'wiz9-cmp-fs-stmt');
              stmt.textContent = ctrl.jkObjective;
              implArea.appendChild(stmt);
            }
          });
        }

        // Tests for this HS
        const tests = testCtrlByRef.get(h.standard_ref) || [];
        if (tests.length > 0) {
          implArea.appendChild(_el('p', 'wiz9-cmp-sub-lbl', { textContent: `Tests (${tests.length})` }));
          const trow = _el('div', 'wiz9-cmp-test-row');
          trow.appendChild(_el('span', 'wiz9-cmp-test-icon', { textContent: '🧪' }));
          const tlist = _el('div', 'wiz9-cmp-test-chips');
          tests.forEach(tc => {
            const chip = _el('span', 'wiz9-cmp-test-chip', { textContent: tc.jkName || tc.control_ref });
            chip.title = tc.jkText || '';
            tlist.appendChild(chip);
          });
          trow.appendChild(tlist);
          implArea.appendChild(trow);
        }

        item.appendChild(implArea);
        hsList.appendChild(item);
      });
      v1Wrap.appendChild(hsList);
    }
    body.appendChild(v1Wrap);

    // ══ VIEW 2: Risk Reduction — Risks → Controls & Tests ═════════════════════
    const v2Wrap = _el('div', 'wiz9-cmp-view-wrap wiz9-cmp-view-wrap--risk');

    const v2Header = _el('div', 'wiz9-cmp-view-hdr wiz9-cmp-view-hdr--risk');
    const v2Icon = _el('span', 'wiz9-cmp-view-icon'); v2Icon.textContent = '🛡';
    v2Header.appendChild(v2Icon);
    const v2Title = _el('div', 'wiz9-cmp-view-title-wrap');
    v2Title.appendChild(_el('span', 'wiz9-cmp-view-title', { textContent: 'Risk Reduction View' }));
    v2Title.appendChild(_el('span', 'wiz9-cmp-view-sub', { textContent: 'Risk identified → controls that mitigate it → tests that verify those controls work' }));
    v2Header.appendChild(v2Title);
    v2Wrap.appendChild(v2Header);

    if (risks.length === 0) {
      v2Wrap.appendChild(_el('p', 'wiz9-cmp-empty wiz9-cmp-empty--indent', { textContent: 'No risks mapped to this article.' }));
    } else {
      risks.forEach(risk => {
        const rItem = _el('div', 'wiz9-cmp-risk-item');

        // Risk header
        const rHdr = _el('div', 'wiz9-cmp-risk-hdr');
        rHdr.appendChild(_el('span', 'wiz9-cmp-risk-id', { textContent: risk.pk_Risk_ID }));
        const rsrc = _el('span', 'wiz9-cmp-src-tag wiz9-cmp-src-tag--legal');
        rsrc.textContent = 'Legal';
        rHdr.appendChild(rsrc);
        rHdr.appendChild(_el('span', 'wiz9-cmp-risk-name', { textContent: risk.risk_name }));
        rItem.appendChild(rHdr);

        // Controls that mitigate this risk
        const controls = ctrlsByRisk.get(risk.pk_Risk_ID) || [];
        if (controls.length > 0) {
          const ctrlWrap = _el('div', 'wiz9-cmp-ctrl-wrap');
          ctrlWrap.appendChild(_el('p', 'wiz9-cmp-sub-lbl', { textContent: `Controls (${controls.length})` }));
          controls.forEach(ctrl => {
            const cRow = _el('div', 'wiz9-cmp-ctrl-row');
            const _srcKey = ctrl.control_source === 'Framework_Statement' ? 'fs' : 'hs';
            const srcDot = _el('span', `wiz9-cmp-ctrl-dot wiz9-cmp-ctrl-dot--${_srcKey}`);
            cRow.appendChild(srcDot);
            cRow.appendChild(_el('span', 'wiz9-cmp-ctrl-id', { textContent: ctrl.pk_Risk_Control_ID }));
            cRow.appendChild(_el('span', 'wiz9-cmp-ctrl-name', { textContent: ctrl.jkName || '' }));
            const tasks = tasksByCtrl.get(ctrl.pk_Risk_Control_ID) || [];
            if (tasks.length > 0) {
              const tw = _el('div', 'wiz9-cmp-task-chips');
              tw.appendChild(_el('span', 'wiz9-cmp-test-icon', { textContent: '📋' }));
              tasks.slice(0, 4).forEach(t => {
                tw.appendChild(_el('span', 'wiz9-cmp-task-chip', { textContent: `T${t.task_number}`, title: t.task || '' }));
              });
              if (tasks.length > 4) tw.appendChild(_el('span', 'wiz9-cmp-task-chip', { textContent: `+${tasks.length - 4}` }));
              cRow.appendChild(tw);
            }
            // R→T pairing: show linked test control inline
            const tc = testCtrlByRC.get(ctrl.pk_Risk_Control_ID);
            if (tc) {
              const tcChip = _el('div', 'wiz9-cmp-task-chips');
              tcChip.appendChild(_el('span', 'wiz9-cmp-test-icon', { textContent: '🧪' }));
              tcChip.appendChild(_el('span', 'wiz9-cmp-test-chip', { textContent: tc.control_ref, title: tc.jkName || '' }));
              cRow.appendChild(tcChip);
            }
            ctrlWrap.appendChild(cRow);
          });
          rItem.appendChild(ctrlWrap);
        }

        v2Wrap.appendChild(rItem);
      });
    }
    body.appendChild(v2Wrap);
  }

  // ---- Compliance ctrl row helper -----------------------------
  function _buildCmpCtrlRow(ctrl, tasksByCtrl, showRemove) {
    const cRow = _el('div', 'wiz9-cmp-ctrl-row');
    const src = ctrl.control_source === 'Framework_Statement' ? 'fs' : 'hs';
    cRow.appendChild(_el('span', `wiz9-cmp-ctrl-dot wiz9-cmp-ctrl-dot--${src}`));
    cRow.appendChild(_el('span', 'wiz9-cmp-ctrl-id',   { textContent: ctrl.pk_Risk_Control_ID }));
    cRow.appendChild(_el('span', 'wiz9-cmp-ctrl-name', { textContent: ctrl.jkName || '' }));
    const tasks = (tasksByCtrl || new Map()).get(ctrl.pk_Risk_Control_ID) || [];
    if (tasks.length > 0) {
      const tw = _el('div', 'wiz9-cmp-task-chips');
      tw.appendChild(_el('span', 'wiz9-cmp-test-icon', { textContent: '📋' }));
      tasks.slice(0, 4).forEach(t => {
        tw.appendChild(_el('span', 'wiz9-cmp-task-chip', { textContent: `T${t.task_number}`, title: t.task || '' }));
      });
      if (tasks.length > 4) tw.appendChild(_el('span', 'wiz9-cmp-task-chip', { textContent: `+${tasks.length - 4}` }));
      cRow.appendChild(tw);
    }
    if (showRemove) {
      const rmBtn = _el('button', 'wiz9-cmp-remove-btn'); rmBtn.textContent = '✕ Remove';
      rmBtn.addEventListener('click', () => {
        _state.complianceSelected[ctrl.pk_Risk_Control_ID] = false;
        const cmpPane = _container.querySelector('[data-pane="compliance"]');
        if (cmpPane) { cmpPane.innerHTML = ''; cmpPane.appendChild(_buildCompliancePane()); }
        // also refresh compliance adds in wizard tab
        const addsEl = _container.querySelector('#wiz9-comp-adds');
        if (addsEl) { const fresh = _buildComplianceAdditionsSection(); addsEl.replaceWith(fresh); }
      });
      cRow.appendChild(rmBtn);
    }
    return cRow;
  }

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    WizUtils.injectStyles('wiz9-styles', `
.wiz8-stat{display:flex;flex-direction:column;gap:2px}
.wiz8-stat-num{font-size:24px;font-weight:700;color:#8cebb0;line-height:1}
.wiz8-stat-lbl{font-size:10px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
/* Source card */
.wiz9-source-card{background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz9-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#8cebb0;margin:0 0 10px}
.wiz9-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.wiz9-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz9-cell-label{font-size:11px;color:var(--color-text-tertiary);font-weight:500}
.wiz9-cell-value{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz9-cell-value--num{font-size:18px;font-weight:700;color:#8ce3c6}
.wiz9-cell-value--high{font-size:14px;font-weight:700;color:#fba4a3}
.wiz9-cell-value--ok{font-size:14px;font-weight:700;color:#8cebb0}

/* Info / warn */
.wiz9-warn{background:rgba(212,184,96,0.12);border:1px solid rgba(212,184,96,0.40);border-radius:6px;padding:12px 16px;font-size:13px;color:#ecd489;margin-bottom:12px}
.wiz9-info{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:6px;padding:12px 16px;font-size:13px;color:#a4ccf6}
.wiz9-intro{font-size:13px;color:var(--color-text-secondary);margin:0 0 12px;line-height:1.6}

/* Validation banner */
.wiz9-val-wrap{margin-bottom:14px}
.wiz9-val-ok{display:flex;align-items:center;gap:7px;background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:6px;padding:9px 14px;font-size:13px;color:#8cebb0;font-weight:500}
.wiz9-val-err{display:flex;align-items:flex-start;gap:7px;background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:6px;padding:9px 14px;font-size:13px;color:#f3ab8a;line-height:1.55}

/* Risk accordion */
.wiz9-risk-list{display:flex;flex-direction:column;gap:10px}
.wiz9-risk-sec{border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.wiz9-risk-sec--error{animation:wiz9-shake .4s ease;border-color:rgba(226,90,88,0.50)!important}
@keyframes wiz9-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.wiz9-risk-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none;gap:10px}
.wiz9-risk-hdr:hover{background:var(--color-bg-hover,#262219)}
.wiz9-risk-hdr-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.wiz9-risk-icon{display:flex;color:#ec6a68;flex-shrink:0}
.wiz9-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz9-cat-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz9-rel-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz9-rel-badge--high{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz9-rel-badge--medium{background:#262219;color:#b1a992}
.wiz9-risk-hdr-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz9-sel-btn{font-size:11px;font-weight:500;color:var(--teal-600,#8ce3c6);background:none;border:1px solid rgba(93,202,165,0.45);border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.wiz9-sel-btn:hover{background:rgba(93,202,165,0.10)}
.wiz9-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz9-risk-body{padding:16px;display:flex;flex-direction:column;gap:12px}
.wiz9-collapsed{display:none}

/* Risk body */
.wiz9-risk-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0;padding:10px 12px;background:#211d15;border-radius:5px;border-left:3px solid var(--color-border)}
.wiz9-ctrl-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:0}
.wiz9-ctrl-section-label--eu{color:#a4ccf6}

/* EU AI Act risk descriptions */
.wiz9-eu-risks-wrap{display:flex;flex-direction:column;gap:8px}
.wiz9-eu-risk-desc{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:5px;padding:10px 12px;border-left:3px solid #3b82f6}
.wiz9-eu-risk-label{font-size:11px;font-weight:700;color:#a4ccf6;display:block;margin-bottom:4px}
.wiz9-eu-risk-text{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* Source badges */
.wiz9-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;letter-spacing:.03em}
.wiz9-src-badge--eu{background:rgba(80,150,225,0.16);color:#a4ccf6}
.wiz9-src-badge--gs{background:rgba(80,150,225,0.12);color:#bfb8ff}

/* Legal risk names in cluster header */
.wiz9-legal-risk-names{font-size:11px;color:var(--color-text-tertiary);font-style:italic;min-width:0;overflow:hidden;text-overflow:ellipsis}

/* Standard reference badge */
.wiz9-standard-ref{font-size:10px;font-weight:600;background:rgba(138,130,235,0.16);color:#bfb8ff;padding:2px 7px;border-radius:4px;white-space:nowrap;word-break:break-all}

/* Control card */
.wiz9-ctrl-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:14px 16px}
.wiz9-ctrl-hdr{display:flex;align-items:center;gap:7px;margin-bottom:10px;flex-wrap:wrap}
.wiz9-ctrl-cb{flex-shrink:0;accent-color:var(--teal-600,#8ce3c6);width:15px;height:15px;cursor:pointer}
.wiz9-ctrl-icon{display:flex;color:#bfb8ff;flex-shrink:0}
.wiz9-ctrl-name{font-size:13px;font-weight:700;color:var(--color-text-primary);flex:1;min-width:120px}
.wiz9-rcn-badge{font-size:10px;font-weight:600;background:rgba(138,130,235,0.16);color:#bfb8ff;padding:2px 7px;border-radius:4px;white-space:nowrap;word-break:break-all}
.wiz9-maturity-badge{font-size:10px;font-weight:600;background:rgba(52,199,120,0.16);color:#8cebb0;padding:2px 7px;border-radius:4px;white-space:nowrap}
.wiz9-test-pair-badge{font-size:10px;font-weight:600;background:rgba(212,184,96,0.16);color:#ecd489;padding:2px 7px;border-radius:4px;white-space:nowrap;cursor:default}
.wiz9-ctrl-obj{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0 0 10px}
.wiz9-evidence-wrap{font-size:11px;color:var(--color-text-tertiary);margin-bottom:10px}
.wiz9-evidence-label{font-weight:600}
.wiz9-evidence-text{font-style:italic}

/* Task / Code section */
.wiz9-tasks-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-top:4px}
.wiz9-tasks-hdr{display:flex;align-items:center;gap:7px;padding:8px 12px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none}
.wiz9-tasks-hdr:hover{background:var(--color-bg-hover,#262219)}
.wiz9-tasks-icon{display:flex;color:#bfb8ff;flex-shrink:0}
.wiz9-tasks-lbl{font-size:12px;font-weight:600;color:#bfb8ff;flex:1}
.wiz9-tasks-chv{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz9-tasks-body{padding:14px;display:flex;flex-direction:column;gap:20px;background:#211d15}

/* Task / Code pair */
.wiz9-pair{display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:var(--color-surface);border:1px solid rgba(138,130,235,0.16);border-radius:6px}
.wiz9-task-wrap{display:flex;flex-direction:column;gap:5px}
.wiz9-task-num{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#bfb8ff;background:rgba(138,130,235,0.16);padding:2px 8px;border-radius:4px;display:inline-block;width:fit-content}
.wiz9-task-text{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0}
.wiz9-code-wrap{display:flex;flex-direction:column;gap:5px}
.wiz9-code-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8cebb0;background:rgba(52,199,120,0.16);padding:2px 8px;border-radius:4px;display:inline-block;width:fit-content}
.wiz9-code-block{background:#1e293b;color:#2e2a1f;font-size:11px;line-height:1.6;padding:12px 14px;border-radius:6px;overflow-x:auto;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;white-space:pre}
.wiz9-code-block code{background:none;padding:0;font-size:inherit;color:inherit;font-family:inherit}

/* Count / action */
.wiz9-count-badge{font-size:13px;font-weight:600;padding:4px 12px;border-radius:10px}
.wiz9-count-badge--ok{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-count-badge--warn{background:rgba(226,90,88,0.16);color:#fba4a3}

/* Results */
.wiz9-results{margin-top:16px}
.wiz9-result-card{background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:8px;padding:20px}
.wiz9-result-title{font-size:14px;font-weight:700;color:#8cebb0;margin:0 0 14px}
.wiz9-result-stats{display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap}
.wiz9-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* Reference pane */
.wiz9-ref-summary{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.wiz9-ref-sum-badge{font-size:12px;font-weight:700;padding:4px 12px;border-radius:10px}
.wiz9-ref-sum-badge--ok{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-ref-sum-badge--warn{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz9-ref-uncovered{font-size:12px;font-weight:600;color:#fba4a3;background:rgba(226,90,88,0.12);padding:3px 10px;border-radius:6px}
.wiz9-ref-hint{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0 0 20px;line-height:1.5}
.wiz9-ref-risk-sec{margin-bottom:28px}
.wiz9-ref-risk-hdr{display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:2px solid var(--color-border);margin-bottom:12px;flex-wrap:wrap}
.wiz9-ref-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz9-ref-ctrl{margin-bottom:10px;padding-left:12px;border-left:3px solid #a5b4fc}
.wiz9-ref-ctrl--deselected{border-left-color:#2e2a1f;opacity:.55}
.wiz9-ref-ctrl-hdr{display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap}
.wiz9-ref-ctrl-name{font-size:12px;font-weight:700;color:#bfb8ff}
.wiz9-ref-sel-ind{font-size:11px;font-weight:800;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.wiz9-ref-sel-ind--on{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-ref-sel-ind--off{background:#262219;color:#8b8574}
.wiz9-ref-ctrl-skip{font-size:11px;color:#8b8574;font-style:italic;margin:0 0 4px}
.wiz9-ref-pair{margin-bottom:12px;padding:8px 10px;background:#211d15;border:1px solid rgba(138,130,235,0.16);border-radius:5px;display:flex;flex-direction:column;gap:6px}

/* ── AI Act Compliance View ─────────────────────────────────── */
.wiz9-cmp-wrap{padding:0 0 40px}
.wiz9-cmp-header{padding:20px 24px 16px;border-bottom:1px solid var(--color-border)}
.wiz9-cmp-title{font-size:16px;font-weight:600;color:var(--color-text-primary);margin:0 0 6px}
.wiz9-cmp-subtitle{font-size:12px;color:var(--color-text-secondary);margin:0 0 6px;line-height:1.5}
.wiz9-cmp-desc{font-size:12px;color:var(--color-text-secondary);margin:0 0 10px;line-height:1.6;padding:10px 14px;background:var(--color-bg-subtle,#211d15);border:1px solid var(--color-border);border-radius:6px}
.wiz9-cmp-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wiz9-cmp-pending-note{background:rgba(212,184,96,0.12);border:1px solid rgba(212,184,96,0.40);border-radius:6px;padding:10px 14px;font-size:12px;color:#ecd489;margin-top:8px}

/* Article accordion */
.wiz9-cmp-article{border-bottom:1px solid var(--color-border)}
.wiz9-cmp-article:last-child{border-bottom:none}
.wiz9-cmp-art-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;cursor:pointer;user-select:none;background:var(--color-surface,#fff);transition:background .15s}
.wiz9-cmp-art-hdr:hover{background:var(--color-bg,#211d15)}
.wiz9-cmp-art-left{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0}
.wiz9-cmp-art-id{font-size:10px;font-weight:700;font-family:monospace;color:var(--color-text-tertiary);white-space:nowrap}
.wiz9-cmp-art-name{font-size:13px;font-weight:500;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wiz9-cmp-art-right{display:grid;grid-template-columns:116px 44px 58px 52px 60px 18px;align-items:center;gap:6px;flex-shrink:0}
.wiz9-cmp-chevron{font-size:12px;color:var(--color-text-tertiary);text-align:center}
.wiz9-cmp-count{font-size:10px;font-weight:500;padding:2px 6px;border-radius:4px;white-space:nowrap;text-align:center}
.wiz9-cmp-count--hs{background:rgba(138,130,235,0.16);color:#bfb8ff}
.wiz9-cmp-count--risk{background:rgba(226,90,88,0.16);color:#fba4a3}

/* Relevance badges */
.wiz9-cmp-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;text-transform:uppercase;letter-spacing:.03em}
.wiz9-cmp-badge--applicable{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-cmp-badge--na{background:#262219;color:#b1a992}
.wiz9-cmp-badge--pending{background:rgba(212,184,96,0.16);color:#ecd489}
.wiz9-cmp-badge--blocked{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz9-cmp-obl{font-size:10px;color:var(--color-text-tertiary);font-style:italic;white-space:nowrap}

/* Article body */
.wiz9-cmp-art-body{padding:0 24px 20px;background:var(--color-bg,#211d15)}
.wiz9-cmp-reason{font-size:12px;line-height:1.55;padding:8px 12px;border-radius:5px;margin:10px 0}
.wiz9-cmp-reason--applicable{background:rgba(52,199,120,0.10);color:#8cebb0;border-left:3px solid #46c17f}
.wiz9-cmp-reason--na{background:#211d15;color:#b1a992;border-left:3px solid rgba(240,232,208,0.30)}
.wiz9-cmp-reason--pending{background:rgba(212,184,96,0.12);color:#ecd489;border-left:3px solid #e0b94a}
.wiz9-cmp-reason--blocked{background:rgba(226,90,88,0.12);color:#fba4a3;border-left:3px solid #ec6a68}

/* View wrappers — the two views within each article body */
.wiz9-cmp-view-wrap{margin-top:14px;border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.wiz9-cmp-view-wrap--risk{margin-top:10px}
.wiz9-cmp-view-hdr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--color-border)}
.wiz9-cmp-view-hdr--compliance{background:rgba(80,150,225,0.12)}
.wiz9-cmp-view-hdr--risk{background:rgba(226,90,88,0.12)}
.wiz9-cmp-view-icon{font-size:14px;flex-shrink:0;margin-top:1px}
.wiz9-cmp-view-title-wrap{display:flex;flex-direction:column;gap:2px}
.wiz9-cmp-view-title{font-size:12px;font-weight:700;color:var(--color-text-primary)}
.wiz9-cmp-view-sub{font-size:11px;color:var(--color-text-secondary);line-height:1.4}

/* Empty state */
.wiz9-cmp-empty{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:4px 0}
.wiz9-cmp-empty--indent{padding:10px 14px}

/* HS list inside compliance view */
.wiz9-cmp-hs-list{display:flex;flex-direction:column;gap:0;padding:4px 0}
.wiz9-cmp-hs-item{padding:10px 14px;border-bottom:1px solid rgba(138,130,235,0.16)}
.wiz9-cmp-hs-item:last-child{border-bottom:none}
.wiz9-cmp-hs-ref-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}
.wiz9-cmp-ref-tag{font-size:10px;font-weight:600;font-family:monospace;padding:2px 6px;background:rgba(138,130,235,0.12);border:1px solid rgba(138,130,235,0.40);border-radius:3px;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-hs-txt{display:flex;flex-direction:column;gap:1px}
.wiz9-cmp-hs-name{font-size:12px;font-weight:600;color:var(--color-text-primary)}
.wiz9-cmp-hs-desc{font-size:11px;color:var(--color-text-secondary);line-height:1.45}

/* Controls + tests area inside each HS item */
.wiz9-cmp-hs-impl{padding:6px 0 2px 12px;border-left:2px solid rgba(138,130,235,0.40);margin-left:4px;display:flex;flex-direction:column;gap:4px}

/* Shared sub-label */
.wiz9-cmp-sub-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:4px 0 3px}

/* Test rows */
.wiz9-cmp-test-row{display:flex;align-items:flex-start;gap:6px;padding-top:2px}
.wiz9-cmp-test-icon{font-size:11px;flex-shrink:0;margin-top:2px}
.wiz9-cmp-test-chips{display:flex;flex-wrap:wrap;gap:4px}
.wiz9-cmp-test-chip{font-size:10px;font-weight:500;padding:2px 7px;border-radius:4px;background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);color:#8cebb0;cursor:default;white-space:nowrap}
.wiz9-cmp-test-chip:hover{background:rgba(52,199,120,0.16)}

/* Risk items (inside risk view wrapper) */
.wiz9-cmp-risk-item{padding:10px 14px;border-bottom:1px solid rgba(226,90,88,0.40)}
.wiz9-cmp-risk-item:last-child{border-bottom:none}
.wiz9-cmp-risk-hdr{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.wiz9-cmp-risk-id{font-size:10px;font-weight:700;font-family:monospace;color:var(--color-text-tertiary)}
.wiz9-cmp-src-tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px}
.wiz9-cmp-src-tag--legal{background:rgba(138,130,235,0.16);color:#bfb8ff}
.wiz9-cmp-risk-name{font-size:12px;font-weight:600;color:var(--color-text-primary)}

/* Controls */
.wiz9-cmp-ctrl-wrap{margin-bottom:8px}
.wiz9-cmp-ctrl-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;background:#211d15;margin-bottom:3px;flex-wrap:wrap}
.wiz9-cmp-ctrl-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.wiz9-cmp-ctrl-dot--hs{background:#bfb8ff}
.wiz9-cmp-ctrl-dot--fs{background:#8b5cf6}
.wiz9-cmp-ctrl-id{font-size:10px;font-weight:600;font-family:monospace;color:var(--color-text-tertiary);white-space:nowrap}
.wiz9-cmp-ctrl-name{font-size:11px;color:var(--color-text-secondary);flex:1;min-width:0}
.wiz9-cmp-task-chips{display:flex;align-items:center;gap:3px;flex-wrap:wrap}
.wiz9-cmp-task-chip{font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(138,130,235,0.16);color:#bfb8ff;white-space:nowrap;cursor:default}

/* Test plans */
.wiz9-cmp-tp-wrap{border-top:1px solid rgba(226,90,88,0.40);padding-top:8px}
.wiz9-cmp-tp-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;flex-wrap:wrap}
.wiz9-cmp-tp-name{font-size:11px;color:var(--color-text-secondary);flex:1;min-width:0}

/* Risk type section labels in wizard tab */
.section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--color-border)}

/* Compliance additions section in wizard tab */
.wiz9-comp-adds-wrap{margin-top:24px;border:1px solid rgba(138,130,235,0.40);border-radius:8px;overflow:hidden}
.wiz9-comp-adds-hdr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(80,150,225,0.12);border-bottom:1px solid rgba(138,130,235,0.40)}
.wiz9-comp-adds-icon{font-size:14px;flex-shrink:0}
.wiz9-comp-adds-title-wrap{display:flex;flex-direction:column;gap:2px}
.wiz9-comp-adds-title{font-size:12px;font-weight:700;color:#bfb8ff}
.wiz9-comp-adds-sub{font-size:11px;color:var(--color-text-secondary);line-height:1.4}
.wiz9-comp-adds-body{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.wiz9-comp-adds-empty{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0}
.wiz9-comp-add-item{display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(138,130,235,0.10);border-radius:5px;flex-wrap:wrap}
.wiz9-comp-adds-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(138,130,235,0.16);color:#bfb8ff;white-space:nowrap}

/* DPIA additions section in wizard tab */
.wiz9-dpia-adds-wrap{margin-top:24px;border:1px solid rgba(93,202,165,0.45);border-radius:8px;overflow:hidden}
.wiz9-dpia-adds-hdr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(93,202,165,0.10);border-bottom:1px solid rgba(93,202,165,0.45)}
.wiz9-dpia-adds-icon{flex-shrink:0;color:#8ce3c6;margin-top:1px}
.wiz9-dpia-adds-title-wrap{display:flex;flex-direction:column;gap:2px}
.wiz9-dpia-adds-title{font-size:12px;font-weight:700;color:#8ce3c6}
.wiz9-dpia-adds-sub{font-size:11px;color:var(--color-text-secondary);line-height:1.4}
.wiz9-dpia-adds-body{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.wiz9-dpia-adds-empty{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0}
.wiz9-dpia-add-item{display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(93,202,165,0.10);border-radius:5px;flex-wrap:wrap}
.wiz9-dpia-dot{width:7px;height:7px;border-radius:50%;background:#d4b860;flex-shrink:0}
.wiz9-dpia-add-name{font-size:12px;color:var(--color-text-primary);flex:1}
.wiz9-dpia-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(93,202,165,0.16);color:#8ce3c6;white-space:nowrap}

.wiz9-cmp-count--ctrl{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-cmp-count--test{background:rgba(212,184,96,0.16);color:#ecd489}

/* Gap / N/A badges on HS items */
.wiz9-cmp-gap-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);color:#c2410c;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-na-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:#262219;border:1px solid rgba(240,232,208,0.30);color:#b1a992;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-na-btn{font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;border:1px solid rgba(240,232,208,0.30);background:#211d15;color:#b1a992;cursor:pointer;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-na-btn:hover{background:#262219}
.wiz9-cmp-na-btn--edit{color:#8ce3c6;border-color:rgba(93,202,165,0.45);background:rgba(93,202,165,0.10)}
.wiz9-cmp-na-btn--edit:hover{background:rgba(93,202,165,0.16)}
.wiz9-cmp-na-reason{font-size:11px;color:#b1a992;font-style:italic;padding:4px 8px 6px;border-left:2px solid rgba(240,232,208,0.30);margin:4px 0 2px}
.wiz9-cmp-na-form{margin:8px 0 4px;padding:10px 12px;background:#211d15;border:1px solid #2e2a1f;border-radius:6px;display:flex;flex-direction:column;gap:8px}
.wiz9-cmp-na-form-lbl{font-size:11px;font-weight:600;color:#b1a992;text-transform:uppercase;letter-spacing:.04em}
.wiz9-cmp-na-textarea{font-size:12px;color:#1e293b;border:1px solid rgba(240,232,208,0.30);border-radius:4px;padding:6px 8px;resize:vertical;font-family:inherit;line-height:1.4;width:100%;box-sizing:border-box}
.wiz9-cmp-na-textarea:focus{outline:none;border-color:#8ce3c6}
.wiz9-cmp-na-form-btns{display:flex;gap:6px;flex-wrap:wrap}
.wiz9-cmp-na-confirm-btn{font-size:12px;font-weight:600;padding:5px 12px;border-radius:4px;border:none;background:#8ce3c6;color:#241d08;cursor:pointer}
.wiz9-cmp-na-confirm-btn:hover{background:#8ce3c6}
.wiz9-cmp-na-cancel-btn{font-size:12px;font-weight:500;padding:5px 12px;border-radius:4px;border:1px solid #2e2a1f;background:var(--color-surface);color:#b1a992;cursor:pointer}
.wiz9-cmp-na-cancel-btn:hover{background:#211d15}
.wiz9-cmp-na-clear-btn{font-size:12px;font-weight:500;padding:5px 12px;border-radius:4px;border:1px solid rgba(226,90,88,0.50);background:var(--color-surface);color:#ec6a68;cursor:pointer;margin-left:auto}
.wiz9-cmp-na-clear-btn:hover{background:rgba(226,90,88,0.12)}

/* Sub-label variants */
.wiz9-cmp-sub-lbl--comp{color:#bfb8ff}
.wiz9-cmp-sub-lbl--avail{color:#c2410c}
.wiz9-cmp-sub-lbl--fs{color:#bfb8ff}
.wiz9-cmp-self-cert-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(138,130,235,0.16);color:#bfb8ff;border:1px solid #c4b5fd;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-self-cert-badge--sm{font-size:10px;padding:1px 6px}
.wiz9-cmp-fs-row{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:4px;background:rgba(138,130,235,0.10);margin-bottom:3px;flex-wrap:wrap}
.wiz9-cmp-fs-stmt{font-size:12px;color:#bfb8ff;background:rgba(138,130,235,0.10);border:1px solid rgba(138,130,235,0.40);border-radius:5px;padding:8px 12px;margin:2px 0 8px 16px;line-height:1.55}
.wiz9-fs-ctrl-card{border-color:rgba(138,130,235,0.40)!important;background:rgba(138,130,235,0.10)!important}
.wiz9-fs-src-badge{background:rgba(138,130,235,0.16)!important;color:#bfb8ff!important;border:1px solid #c4b5fd!important}
.wiz9-ctrl-section-label--fs{color:#bfb8ff}

/* Available controls row (compliance team adds) */
.wiz9-cmp-avail-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);margin-bottom:3px;flex-wrap:wrap}
.wiz9-cmp-add-btn{font-size:11px;font-weight:600;color:#241d08;background:#bfb8ff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-add-btn:hover{background:#bfb8ff}

/* Remove button on compliance additions */
.wiz9-cmp-remove-btn{font-size:10px;font-weight:600;color:#fba4a3;background:none;border:1px solid rgba(226,90,88,0.50);border-radius:4px;padding:2px 6px;cursor:pointer;white-space:nowrap;margin-left:auto;flex-shrink:0}
.wiz9-cmp-remove-btn:hover{background:rgba(226,90,88,0.12)}

/* Compliance save bar */
.wiz9-cmp-save-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:rgba(138,130,235,0.10);border-bottom:1px solid rgba(138,130,235,0.40);flex-wrap:wrap}
.wiz9-cmp-save-summary{font-size:12px;color:#bfb8ff;font-weight:500}
.wiz9-cmp-save-btn{padding:7px 16px;background:#bfb8ff;color:#241d08;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.wiz9-cmp-save-btn:hover{background:#bfb8ff}
    `);
  }

  function _safeId(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
  }

})();
