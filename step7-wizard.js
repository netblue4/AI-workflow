(function () {
  'use strict';

  // ---- Module state -----------------------------------------
  let _step = null;
  let _colorKey = null;
  let _phaseTitle = null;
  let _container = null;
  let _framework = null;
  let _record = null;
  let _step3Data = null;
  let _filteredStepItems = []; // [{stepName, objectives, risks:[{jkName,RiskDescription,controls:[...]}]}]

  const _state = {
    assessed_by: '',
    use_case_id: '',
    selected_controls: {} // control_number → boolean
  };

  // ---- Public API -------------------------------------------
  window.mountStep7Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container = container;
    _step = step;
    _colorKey = colorKey;
    _phaseTitle = phaseTitle;

    // Reset on fresh mount
    _state.assessed_by = '';
    _state.use_case_id = '';
    _state.selected_controls = {};
    _framework = null;
    _record = null;
    _step3Data = null;
    _filteredStepItems = [];

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(_buildTabStrip());
    const paneWrap = _el('div', 'wiz-pane-wrap');
    shell.appendChild(paneWrap);

    container.innerHTML = '';
    container.appendChild(shell);

    _loadData(paneWrap);
  };

  // ---- Data loading -----------------------------------------
  async function _loadData(paneWrap) {
    try {
      const res = await fetch('ai_Risk_Control_Framework.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _framework = await res.json();
    } catch (e) {
      paneWrap.innerHTML = `<p style="padding:24px 28px;color:var(--danger-600,#dc2626)">Could not load ai_Risk_Control_Framework.json: ${e.message}</p>`;
      return;
    }

    try {
      const saved = sessionStorage.getItem('ai_workflow_system_record');
      if (saved) _record = JSON.parse(saved);
    } catch (_e) {}

    _step3Data = _record?.['step-3'] ?? null;

    // Restore prior step-7 selections
    const saved7 = _record?.['step-7'];
    if (saved7?.selected_risks) {
      _state.assessed_by = saved7.assessed_by || '';
      _state.use_case_id = saved7.use_case_id || '';
      saved7.selected_risks.forEach(risk =>
        risk.controls.forEach(c => {
          _state.selected_controls[c.control_number] = c.selected;
        })
      );
    }

    _filteredStepItems = _buildFilteredStepItems();

    // Default: select all controls if no prior state
    if (Object.keys(_state.selected_controls).length === 0) {
      _filteredStepItems.forEach(si =>
        si.risks.forEach(r =>
          r.controls.forEach(c => { _state.selected_controls[c.control_number] = true; })
        )
      );
    }

    _renderPanes(paneWrap);
  }

  // ---- Filter all sections for jkType==="risk" by applicable control numbers ---
  function _buildFilteredStepItems() {
    if (!_framework) return [];
    // Collect every step item from every top-level section — risks exist in multiple sections
    const buildSection = Object.values(_framework).reduce(
      (acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []
    );

    const applicable = _step3Data?.all_requirement_control_numbers
      ? new Set(_step3Data.all_requirement_control_numbers)
      : null;

    const result = [];

    for (const stepItem of buildSection) {
      const matchedRisks = [];

      for (const field of (stepItem.Fields || [])) {
        if (field.jkType !== 'risk') continue;

        // Filter controls: a control matches if ANY of its (comma-separated) rcns is applicable
        const matchedControls = (field.controls || []).filter(ctrl => {
          if (!applicable) return true; // no filter — show all
          const rcns = (ctrl.requirement_control_number || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
          return rcns.some(rcn => applicable.has(rcn));
        });

        if (matchedControls.length > 0) {
          matchedRisks.push({
            jkName: field.jkName,
            RiskDescription: field.RiskDescription || '',
            role: field.Role || '',
            controls: matchedControls
          });
        }
      }

      if (matchedRisks.length > 0) {
        result.push({
          stepName: stepItem.StepName,
          objectives: stepItem.Objectives || [],
          risks: matchedRisks
        });
      }
    }

    return result;
  }

  // ---- Tab strip --------------------------------------------
  function _buildTabStrip() {
    const strip = _el('div', 'wiz-tab-strip');
    [['wizard', 'Step Wizard'], ['reference', 'Reference']].forEach(([id, label], i) => {
      const btn = document.createElement('button');
      btn.className = `wiz-tab${i === 0 ? ' wiz-tab--active' : ''}`;
      btn.dataset.tab = id;
      btn.textContent = label;
      btn.addEventListener('click', () => _switchTab(id));
      strip.appendChild(btn);
    });
    return strip;
  }

  function _switchTab(tabId) {
    _container.querySelectorAll('.wiz-tab').forEach(t =>
      t.classList.toggle('wiz-tab--active', t.dataset.tab === tabId)
    );
    _container.querySelectorAll('.wiz-pane').forEach(p =>
      p.classList.toggle('wiz-pane--hidden', p.dataset.pane !== tabId)
    );
  }

  // ---- Pane rendering ---------------------------------------
  function _renderPanes(paneWrap) {
    paneWrap.innerHTML = '';

    const wizPane = _el('div', 'wiz-pane');
    wizPane.dataset.pane = 'wizard';
    wizPane.appendChild(_buildWizardPane());

    const refPane = _el('div', 'wiz-pane wiz-pane--hidden');
    refPane.dataset.pane = 'reference';
    refPane.appendChild(_buildReferencePane());

    paneWrap.appendChild(wizPane);
    paneWrap.appendChild(refPane);
  }

  // ---- Wizard pane ------------------------------------------
  function _buildWizardPane() {
    const card = _el('div', 'step-detail-card');

    // Header
    const ey = _el('p', `step-detail-eyebrow color-${_colorKey}`);
    ey.textContent = _phaseTitle;
    card.appendChild(ey);

    const title = _el('h2', 'step-detail-title');
    title.textContent = `Step ${_step.number} — ${_step.title}`;
    card.appendChild(title);

    const meta = _el('div', 'step-detail-meta');
    (_step.owners || []).forEach(o => {
      const tag = _el('span', 'owner-tag');
      tag.textContent = o;
      meta.appendChild(tag);
    });
    card.appendChild(meta);

    const summ = _el('p', 'step-detail-summary');
    summ.textContent = _step.summary || '';
    card.appendChild(summ);

    // Deliverables
    if (_step.deliverables?.length) {
      card.appendChild(_sectionLabel('Deliverables'));
      const dl = _el('ul', 'deliverables-list');
      _step.deliverables.forEach(d => {
        const li = _el('li', 'deliverable-item');
        li.textContent = d;
        dl.appendChild(li);
      });
      card.appendChild(dl);
    }

    // Risk assessment
    card.appendChild(_sectionLabel('Risk Assessment'));
    card.appendChild(_buildStep3SummaryCard());
    card.appendChild(_buildIdentitySection());

    const totalRisks = _filteredStepItems.reduce((s, si) => s + si.risks.length, 0);
    const totalControls = _filteredStepItems.reduce(
      (s, si) => s + si.risks.reduce((s2, r) => s2 + r.controls.length, 0), 0
    );

    if (totalRisks === 0 && _step3Data) {
      const notice = _el('p', 'wiz7-notice');
      notice.textContent = 'No applicable risks found for this classification.';
      card.appendChild(notice);
    } else {
      const instr = _el('p', 'wiz7-instruction');
      instr.innerHTML = `<strong>${totalRisks} risk${totalRisks !== 1 ? 's' : ''}</strong> and <strong>${totalControls} risk control${totalControls !== 1 ? 's' : ''}</strong> ${_step3Data ? 'are applicable based on the Step 3 classification' : '(all risks shown — complete Step 3 first for filtered view)'}. Review each risk and deselect controls that do not apply to your deployment.`;
      card.appendChild(instr);

      _filteredStepItems.forEach(si => card.appendChild(_buildStepNameSection(si)));
    }

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'wiz7-results'));

    return card;
  }

  // ---- Step 3 summary card ----------------------------------
  function _buildStep3SummaryCard() {
    const card = _el('div', 'wiz7-source-card');

    if (!_step3Data) {
      const w = _el('div', 'wiz7-warn');
      w.innerHTML = '<strong>Step 3 not yet completed.</strong> Complete Step 3 (System classification) to filter risks to only those applicable to your system. All risks are shown.';
      card.appendChild(w);
      return card;
    }

    const lbl = _el('p', 'wiz7-source-label');
    lbl.textContent = 'Source: Step 3 Classification';
    card.appendChild(lbl);

    const grid = _el('div', 'wiz7-source-grid');

    const addCell = (label, value, mod) => {
      const cell = _el('div', 'wiz7-source-cell');
      const l = _el('span', 'wiz7-cell-label');
      l.textContent = label;
      cell.appendChild(l);
      const v = _el('span', mod ? `wiz7-cell-value wiz7-cell-value--${mod}` : 'wiz7-cell-value');
      v.textContent = value || '—';
      cell.appendChild(v);
      grid.appendChild(cell);
    };

    addCell('AI Act Outcome', _step3Data.axis_b?.ai_act_outcome, 'badge');
    addCell('Governance Tier', _step3Data.axis_a?.tier_label || _step3Data.axis_a?.tier, null);
    addCell('Combined Outcome', _step3Data.combined_outcome?.outcome_label, null);
    addCell('Applicable Controls', String(_step3Data.all_requirement_control_numbers?.length ?? 0), 'num');

    card.appendChild(grid);
    return card;
  }

  // ---- Identity section ------------------------------------
  function _buildIdentitySection() {
    const row = _el('div', 'wiz7-identity-row');

    const addField = (label, key, placeholder) => {
      const wrap = _el('div', 'wiz7-field-wrap');
      const lbl = _el('label', 'wiz7-label');
      lbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'wiz7-input';
      inp.value = _state[key] || '';
      inp.placeholder = placeholder;
      inp.addEventListener('input', e => { _state[key] = e.target.value; });
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      row.appendChild(wrap);
    };

    addField('Assessed by', 'assessed_by', 'Name / role');
    addField('Use Case ID', 'use_case_id', _step3Data?.use_case_id || 'e.g. UC-2025-001');

    return row;
  }

  // ---- StepName accordion (top level) ----------------------
  function _buildStepNameSection(stepItem) {
    const totalControls = stepItem.risks.reduce((s, r) => s + r.controls.length, 0);
    const sec = _el('div', 'wiz7-stepname');

    // Header
    const header = _el('div', 'wiz7-stepname-header');

    const left = _el('div', 'wiz7-stepname-header-left');
    const nm = _el('span', 'wiz7-stepname-name');
    nm.textContent = stepItem.stepName;
    left.appendChild(nm);

    const riskBadge = _el('span', 'wiz7-badge-risks');
    riskBadge.textContent = `${stepItem.risks.length} risk${stepItem.risks.length !== 1 ? 's' : ''}`;
    left.appendChild(riskBadge);

    header.appendChild(left);

    const right = _el('div', 'wiz7-stepname-header-right');

    const selAll = document.createElement('button');
    selAll.className = 'wiz7-sel-btn';
    selAll.textContent = 'Select all';
    selAll.addEventListener('click', e => { e.stopPropagation(); _setStepItemSelection(stepItem, true); });
    right.appendChild(selAll);

    const deselAll = document.createElement('button');
    deselAll.className = 'wiz7-sel-btn';
    deselAll.textContent = 'Deselect all';
    deselAll.addEventListener('click', e => { e.stopPropagation(); _setStepItemSelection(stepItem, false); });
    right.appendChild(deselAll);

    // Selection count badge (updated live)
    const selCount = _el('span', 'wiz7-article-sel-count');
    right.appendChild(selCount);

    const chevron = _el('span', 'wiz7-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)'; // starts collapsed
    right.appendChild(chevron);

    header.appendChild(right);
    sec.appendChild(header);

    // Body — starts collapsed
    const body = _el('div', 'wiz7-stepname-body wiz7-collapsed');

    stepItem.risks.forEach(risk => body.appendChild(_buildRiskCard(risk)));

    sec.appendChild(body);

    // Set initial count badge
    _updateArticleBadge(sec);

    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('wiz7-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });

    return sec;
  }

  function _setStepItemSelection(stepItem, selected) {
    stepItem.risks.forEach(r =>
      r.controls.forEach(c => { _state.selected_controls[c.control_number] = selected; })
    );
    _syncCheckboxes();
  }

  // ---- Risk card -------------------------------------------
  function _buildRiskCard(risk) {
    const card = _el('div', 'wiz7-risk-card');

    // Risk header
    const riskHeader = _el('div', 'wiz7-risk-header');

    const riskIcon = _el('span', 'wiz7-risk-icon');
    riskIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    riskHeader.appendChild(riskIcon);

    const riskName = _el('span', 'wiz7-risk-name');
    riskName.textContent = risk.jkName;
    riskHeader.appendChild(riskName);

    if (risk.role) {
      const roleBadge = _el('span', 'wiz7-role-badge');
      roleBadge.textContent = risk.role;
      riskHeader.appendChild(roleBadge);
    }

    card.appendChild(riskHeader);

    // Risk description
    if (risk.RiskDescription) {
      const desc = _el('p', 'wiz7-risk-desc');
      desc.textContent = risk.RiskDescription;
      card.appendChild(desc);
    }

    // Controls label
    const ctrlLabel = _el('p', 'wiz7-ctrl-section-label');
    ctrlLabel.textContent = `Risk Controls (${risk.controls.length})`;
    card.appendChild(ctrlLabel);

    // Controls list
    const ctrlList = _el('div', 'wiz7-ctrl-list');
    risk.controls.forEach(c => ctrlList.appendChild(_buildRiskControlRow(c)));
    card.appendChild(ctrlList);

    return card;
  }

  // ---- Risk control row ------------------------------------
  function _buildRiskControlRow(ctrl) {
    const row = _el('div', 'wiz7-ctrl-row');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wiz7-ctrl-cb';
    cb.dataset.rcn = ctrl.control_number;
    cb.checked = !!_state.selected_controls[ctrl.control_number];
    cb.addEventListener('change', e => {
      _state.selected_controls[ctrl.control_number] = e.target.checked;
      _updateCountBadge();
      const stepnameEl = e.target.closest('.wiz7-stepname');
      if (stepnameEl) _updateArticleBadge(stepnameEl);
    });
    row.appendChild(cb);

    const content = _el('div', 'wiz7-ctrl-content');

    // Top: control number badge + mapped rcn badges + name
    const top = _el('div', 'wiz7-ctrl-top');

    const ctrlNumBadge = _el('span', 'wiz7-ctrl-num');
    ctrlNumBadge.textContent = ctrl.control_number;
    top.appendChild(ctrlNumBadge);

    // Mapped requirement_control_numbers as individual pills
    const rcns = (ctrl.requirement_control_number || '').split(',').map(s => s.trim()).filter(Boolean);
    rcns.forEach(rcn => {
      const b = _el('span', 'wiz7-rcn');
      b.textContent = rcn;
      top.appendChild(b);
    });

    const nm = _el('span', 'wiz7-ctrl-name');
    nm.textContent = ctrl.jkName;
    top.appendChild(nm);

    content.appendChild(top);

    const desc = _el('p', 'wiz7-ctrl-desc');
    desc.textContent = ctrl.jkText || '';
    content.appendChild(desc);

    row.appendChild(content);
    return row;
  }

  // ---- Sync helpers ----------------------------------------
  function _syncCheckboxes() {
    _container.querySelectorAll('.wiz7-ctrl-cb').forEach(cb => {
      const key = cb.dataset.rcn;
      if (key !== undefined) cb.checked = !!_state.selected_controls[key];
    });
    _updateCountBadge();
    _container.querySelectorAll('.wiz7-stepname').forEach(el => _updateArticleBadge(el));
  }

  function _updateCountBadge() {
    const sel = Object.values(_state.selected_controls).filter(Boolean).length;
    const tot = Object.keys(_state.selected_controls).length;
    const badge = _container.querySelector('#wiz7-count');
    if (badge) badge.textContent = `${sel} / ${tot} selected`;
  }

  function _updateArticleBadge(sectionEl) {
    const all = sectionEl.querySelectorAll('.wiz7-ctrl-cb');
    const checked = sectionEl.querySelectorAll('.wiz7-ctrl-cb:checked');
    const badge = sectionEl.querySelector('.wiz7-article-sel-count');
    if (!badge) return;
    const sel = checked.length;
    const tot = all.length;
    badge.textContent = `${sel} / ${tot}`;
    badge.className = sel === 0
      ? 'wiz7-article-sel-count wiz7-article-sel-count--none'
      : sel === tot
        ? 'wiz7-article-sel-count wiz7-article-sel-count--all'
        : 'wiz7-article-sel-count wiz7-article-sel-count--partial';
  }

  // ---- Action row ------------------------------------------
  function _buildActionRow() {
    const row = _el('div', 'wiz-action-row');

    const left = _el('div', 'wiz7-action-left');
    const countBadge = document.createElement('span');
    countBadge.id = 'wiz7-count';
    countBadge.className = 'wiz7-count-lg';
    const sel = Object.values(_state.selected_controls).filter(Boolean).length;
    const tot = Object.keys(_state.selected_controls).length;
    countBadge.textContent = `${sel} / ${tot} selected`;
    left.appendChild(countBadge);
    row.appendChild(left);

    const right = _el('div', 'wiz7-action-right');

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'wiz-btn-secondary';
    uploadBtn.textContent = 'Upload Record';
    uploadBtn.addEventListener('click', _handleUpload);
    right.appendChild(uploadBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'wiz-btn-primary';
    saveBtn.textContent = 'Save Risk Assessment';
    saveBtn.addEventListener('click', _handleSave);
    right.appendChild(saveBtn);

    row.appendChild(right);
    return row;
  }

  // ---- Save ------------------------------------------------
  function _handleSave() {
    const rec7 = _buildOutputRecord();

    if (!_record) {
      _record = {
        _meta: {
          schema_version: '1.0',
          title: 'AI Acceptable Use — System Authorisation Record',
          standard: 'ISO/IEC 42001-aligned',
          created: new Date().toISOString(),
          last_modified: new Date().toISOString(),
          use_case_id: _state.use_case_id || ''
        }
      };
    }

    _record._meta.last_modified = new Date().toISOString();
    if (_state.use_case_id) _record._meta.use_case_id = _state.use_case_id;
    _record['step-7'] = rec7;

    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_e) {}

    _downloadRecord();
    _renderResults(rec7);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);

    const selectedRisks = [];
    _filteredStepItems.forEach(si => {
      si.risks.forEach(risk => {
        const controls = risk.controls.map(c => ({
          control_number: c.control_number,
          requirement_control_number: c.requirement_control_number,
          control_name: c.jkName,
          control_description: c.jkText || '',
          selected: !!_state.selected_controls[c.control_number]
        }));

        selectedRisks.push({
          step_name: si.stepName,
          risk_name: risk.jkName,
          risk_description: risk.RiskDescription,
          total_controls: controls.length,
          selected_controls: controls.filter(c => c.selected).length,
          controls
        });
      });
    });

    const totalControls = selectedRisks.reduce((s, r) => s + r.total_controls, 0);
    const totalSelected = selectedRisks.reduce((s, r) => s + r.selected_controls, 0);

    return {
      step_id: 'step-7',
      step_title: 'Risk assessment',
      assessment_date: today,
      assessed_by: _state.assessed_by,
      use_case_id: _state.use_case_id || _step3Data?.use_case_id || '',
      source_classification: _step3Data ? {
        ai_act_outcome: _step3Data.axis_b?.ai_act_outcome,
        governance_tier: _step3Data.axis_a?.tier,
        combined_outcome: _step3Data.combined_outcome?.outcome_label,
        classification_date: _step3Data.classification_date
      } : null,
      total_risks: selectedRisks.length,
      total_controls_applicable: totalControls,
      total_controls_selected: totalSelected,
      selected_risks: selectedRisks
    };
  }

  // ---- Download / Upload -----------------------------------
  function _downloadRecord() {
    if (!_record) return;
    const blob = new Blob([JSON.stringify(_record, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-record-${_record._meta?.use_case_id || 'draft'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function _handleUpload() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          _record = JSON.parse(ev.target.result);
          sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record));

          _step3Data = _record?.['step-3'] ?? null;
          _state.selected_controls = {};

          const s7 = _record?.['step-7'];
          if (s7?.selected_risks) {
            _state.assessed_by = s7.assessed_by || '';
            _state.use_case_id = s7.use_case_id || '';
            s7.selected_risks.forEach(risk =>
              risk.controls.forEach(c => { _state.selected_controls[c.control_number] = c.selected; })
            );
          }

          _filteredStepItems = _buildFilteredStepItems();

          if (Object.keys(_state.selected_controls).length === 0) {
            _filteredStepItems.forEach(si =>
              si.risks.forEach(r =>
                r.controls.forEach(c => { _state.selected_controls[c.control_number] = true; })
              )
            );
          }

          const paneWrap = _container.querySelector('.wiz-pane-wrap');
          if (paneWrap) _renderPanes(paneWrap);
        } catch (err) {
          alert('Invalid system record file: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
    inp.click();
  }

  // ---- Results area ----------------------------------------
  function _renderResults(rec7) {
    const area = _container.querySelector('.wiz7-results');
    if (!area) return;
    area.innerHTML = '';

    const card = _el('div', 'wiz7-result-card');

    const h = _el('h3', 'wiz7-result-title');
    h.textContent = 'Risk Assessment Saved';
    card.appendChild(h);

    const stats = _el('div', 'wiz7-result-stats');
    [
      [rec7.total_risks, 'Risks assessed'],
      [rec7.total_controls_selected, 'Controls selected'],
      [rec7.total_controls_applicable - rec7.total_controls_selected, 'Controls excluded']
    ].forEach(([num, label]) => {
      const s = _el('div', 'wiz7-stat');
      const n = _el('span', 'wiz7-stat-num');
      n.textContent = String(num);
      const l = _el('span', 'wiz7-stat-lbl');
      l.textContent = label;
      s.appendChild(n);
      s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);

    const note = _el('p', 'wiz7-result-note');
    note.textContent = 'System record updated and downloaded. Selected controls will feed into Step 9 (Risk Treatment). Step 8 (DPIA) will additionally extract Article 10 data governance risks.';
    card.appendChild(note);

    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane -------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');

    const title = _el('h2', 'step-detail-title');
    title.textContent = 'Risk Catalogue Reference';
    card.appendChild(title);

    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Complete catalogue of all risks and their associated controls from the AI Risk Control Framework (Section 3: Build & Test). The risks displayed in the wizard are filtered to those applicable to the Step 3 classification.';
    card.appendChild(sub);

    const allItems = Object.values(_framework || {}).reduce(
      (acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []
    );

    allItems.forEach(stepItem => {
      const risks = (stepItem.Fields || []).filter(f => f.jkType === 'risk');
      if (!risks.length) return;

      const sec = _el('div', 'wiz7-ref-article');

      const h3 = _el('div', 'wiz7-ref-article-header');
      const nm = _el('span', 'wiz7-ref-article-name');
      nm.textContent = stepItem.StepName;
      h3.appendChild(nm);
      const cnt = _el('span', 'wiz7-count-badge');
      cnt.textContent = `${risks.length} risk${risks.length !== 1 ? 's' : ''}`;
      h3.appendChild(cnt);
      sec.appendChild(h3);

      risks.forEach(risk => {
        const riskDiv = _el('div', 'wiz7-ref-risk');

        const riskNm = _el('p', 'wiz7-ref-risk-name');
        riskNm.textContent = risk.jkName;
        riskDiv.appendChild(riskNm);

        const grid = _el('div', 'wiz7-ref-ctrl-grid');
        (risk.controls || []).forEach(ctrl => {
          const c = _el('div', 'wiz7-ref-ctrl');
          const cnum = _el('span', 'wiz7-ctrl-num');
          cnum.textContent = ctrl.control_number;
          c.appendChild(cnum);
          const nm2 = _el('span', 'wiz7-ref-ctrl-name');
          nm2.textContent = ctrl.jkName;
          c.appendChild(nm2);
          grid.appendChild(c);
        });
        riskDiv.appendChild(grid);
        sec.appendChild(riskDiv);
      });

      card.appendChild(sec);
    });

    return card;
  }

  // ---- Style injection ------------------------------------
  function _injectStyles() {
    if (document.getElementById('wiz7-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz7-styles';
    s.textContent = `
/* ---- Step 7 base layout ---- */
.wiz-shell { display: flex; flex-direction: column; height: 100%; }
.wiz-tab-strip { display: flex; gap: 4px; padding: 16px 24px 0; border-bottom: 1px solid var(--color-border); background: var(--color-bg); flex-shrink: 0; }
.wiz-tab { padding: 8px 16px; font-size: 13px; font-weight: 500; border: none; background: none; cursor: pointer; border-bottom: 2px solid transparent; color: var(--color-text-secondary); margin-bottom: -1px; transition: color .15s, border-color .15s; }
.wiz-tab--active { color: var(--teal-600,#0d9488); border-bottom-color: var(--teal-600,#0d9488); }
.wiz-pane-wrap { flex: 1; overflow-y: auto; }
.wiz-pane { min-height: 100%; }
.wiz-pane--hidden { display: none; }
.wiz-action-row { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; border-top: 1px solid var(--color-border); margin-top: 24px; gap: 12px; flex-wrap: wrap; }
.wiz-btn-primary { padding: 9px 20px; background: var(--teal-600,#0d9488); color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
.wiz-btn-primary:hover { background: var(--teal-700,#0f766e); }
.wiz-btn-secondary { padding: 9px 20px; background: transparent; color: var(--color-text-secondary); border: 1px solid var(--color-border); border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; }
.wiz-btn-secondary:hover { background: var(--color-bg-hover,#f1f5f9); }

/* ---- Source classification card ---- */
.wiz7-source-card { background: var(--info-50,#f0f9ff); border: 1px solid var(--info-200,#bae6fd); border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; }
.wiz7-source-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--info-600,#0284c7); margin: 0 0 10px; }
.wiz7-source-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 10px; }
.wiz7-source-cell { display: flex; flex-direction: column; gap: 3px; }
.wiz7-cell-label { font-size: 11px; color: var(--color-text-tertiary); font-weight: 500; }
.wiz7-cell-value { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.wiz7-cell-value--badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; background: var(--teal-100,#ccfbf1); color: var(--teal-700,#0f766e); padding: 2px 8px; border-radius: 10px; display: inline-block; }
.wiz7-cell-value--num { font-size: 18px; font-weight: 700; color: var(--teal-600,#0d9488); line-height: 1.2; }

/* ---- Warning ---- */
.wiz7-warn { background: var(--warning-50,#fffbeb); border: 1px solid var(--warning-200,#fde68a); border-radius: 6px; padding: 10px 14px; font-size: 13px; color: var(--warning-800,#92400e); line-height: 1.55; }

/* ---- Identity row ---- */
.wiz7-identity-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
.wiz7-field-wrap { display: flex; flex-direction: column; gap: 5px; }
.wiz7-label { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); }
.wiz7-input { padding: 8px 10px; border: 1px solid var(--color-border); border-radius: 6px; font-size: 13px; color: var(--color-text-primary); background: #fff; outline: none; }
.wiz7-input:focus { border-color: var(--teal-400,#2dd4bf); box-shadow: 0 0 0 2px var(--teal-100,#ccfbf1); }

/* ---- Instruction / notice ---- */
.wiz7-instruction { font-size: 13px; color: var(--color-text-secondary); margin: 0 0 16px; line-height: 1.6; }
.wiz7-notice { font-size: 13px; color: var(--color-text-tertiary); padding: 20px 0; }

/* ---- StepName accordion (top level) ---- */
.wiz7-stepname { border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
.wiz7-stepname-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--color-bg-subtle,#f8fafc); cursor: pointer; user-select: none; gap: 10px; }
.wiz7-stepname-header:hover { background: var(--color-bg-hover,#f1f5f9); }
.wiz7-stepname-header-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.wiz7-stepname-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.wiz7-badge-risks { font-size: 11px; font-weight: 600; background: var(--danger-100,#fee2e2); color: var(--danger-700,#b91c1c); padding: 2px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }
.wiz7-stepname-header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.wiz7-sel-btn { font-size: 11px; font-weight: 500; color: var(--teal-600,#0d9488); background: none; border: 1px solid var(--teal-200,#99f6e4); border-radius: 4px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.wiz7-sel-btn:hover { background: var(--teal-50,#f0fdfa); }
.wiz7-article-sel-count { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 10px; white-space: nowrap; min-width: 52px; text-align: center; }
.wiz7-article-sel-count--all { background: var(--success-100,#dcfce7); color: var(--success-700,#15803d); }
.wiz7-article-sel-count--partial { background: var(--warning-100,#fef3c7); color: var(--warning-700,#b45309); }
.wiz7-article-sel-count--none { background: var(--danger-100,#fee2e2); color: var(--danger-700,#b91c1c); }
.wiz7-chevron { display: flex; color: var(--color-text-tertiary); flex-shrink: 0; transition: transform .2s; }
.wiz7-stepname-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
.wiz7-collapsed { display: none; }

/* ---- Risk card ---- */
.wiz7-risk-card { background: #fff; border: 1px solid var(--color-border); border-radius: 8px; padding: 14px 16px; }
.wiz7-risk-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.wiz7-risk-icon { display: flex; color: var(--danger-500,#ef4444); flex-shrink: 0; }
.wiz7-risk-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); flex: 1; }
.wiz7-role-badge { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; background: var(--purple-100,#ede9fe); color: var(--purple-700,#6d28d9); padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.wiz7-risk-desc { font-size: 12px; color: var(--color-text-secondary); line-height: 1.65; margin: 0 0 12px; padding: 10px 12px; background: var(--danger-50,#fef2f2); border-left: 3px solid var(--danger-200,#fecaca); border-radius: 0 4px 4px 0; }
.wiz7-ctrl-section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--color-text-tertiary); margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--color-border); }

/* ---- Risk control rows ---- */
.wiz7-ctrl-list { display: flex; flex-direction: column; gap: 5px; }
.wiz7-ctrl-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 6px; background: #fff; transition: background .1s; }
.wiz7-ctrl-row:hover { background: var(--color-bg-subtle,#f8fafc); }
.wiz7-ctrl-cb { margin-top: 3px; flex-shrink: 0; accent-color: var(--teal-600,#0d9488); width: 14px; height: 14px; cursor: pointer; }
.wiz7-ctrl-content { flex: 1; min-width: 0; }
.wiz7-ctrl-top { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; flex-wrap: wrap; }
.wiz7-ctrl-num { font-size: 10px; font-weight: 700; font-family: var(--font-mono,monospace); background: var(--amber-100,#fef3c7); color: var(--amber-700,#b45309); padding: 1px 5px; border-radius: 3px; white-space: nowrap; flex-shrink: 0; }
.wiz7-rcn { font-size: 10px; font-weight: 600; font-family: var(--font-mono,monospace); background: var(--purple-100,#ede9fe); color: var(--purple-700,#6d28d9); padding: 1px 5px; border-radius: 3px; white-space: nowrap; flex-shrink: 0; }
.wiz7-ctrl-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.wiz7-ctrl-desc { font-size: 12px; color: var(--color-text-secondary); line-height: 1.55; margin: 0; }

/* ---- Count badge (shared) ---- */
.wiz7-count-badge { font-size: 11px; font-weight: 600; background: var(--teal-100,#ccfbf1); color: var(--teal-700,#0f766e); padding: 2px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }

/* ---- Action area ---- */
.wiz7-action-left { display: flex; align-items: center; }
.wiz7-action-right { display: flex; gap: 8px; }
.wiz7-count-lg { font-size: 13px; font-weight: 600; color: var(--teal-700,#0f766e); }

/* ---- Results card ---- */
.wiz7-results { margin-top: 16px; }
.wiz7-result-card { background: var(--success-50,#f0fdf4); border: 1px solid var(--success-200,#bbf7d0); border-radius: 8px; padding: 20px; }
.wiz7-result-title { font-size: 14px; font-weight: 700; color: var(--success-700,#15803d); margin: 0 0 14px; }
.wiz7-result-stats { display: flex; gap: 28px; margin-bottom: 14px; flex-wrap: wrap; }
.wiz7-stat { display: flex; flex-direction: column; gap: 2px; }
.wiz7-stat-num { font-size: 26px; font-weight: 700; color: var(--success-700,#15803d); line-height: 1; }
.wiz7-stat-lbl { font-size: 11px; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: .05em; }
.wiz7-result-note { font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; margin: 0; }

/* ---- Reference pane ---- */
.wiz7-ref-article { margin-bottom: 28px; }
.wiz7-ref-article-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid var(--color-border); }
.wiz7-ref-article-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.wiz7-ref-risk { margin-bottom: 14px; padding-left: 12px; border-left: 3px solid var(--danger-200,#fecaca); }
.wiz7-ref-risk-name { font-size: 12px; font-weight: 700; color: var(--danger-700,#b91c1c); margin: 0 0 8px; }
.wiz7-ref-ctrl-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(240px,1fr)); gap: 5px; }
.wiz7-ref-ctrl { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--color-bg-subtle,#f8fafc); border: 1px solid var(--color-border); border-radius: 5px; }
.wiz7-ref-ctrl-name { font-size: 12px; color: var(--color-text-secondary); }
`;
    document.head.appendChild(s);
  }

  // ---- Utilities -------------------------------------------
  function _el(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function _sectionLabel(text) {
    const el = document.createElement('p');
    el.className = 'section-label';
    el.textContent = text;
    return el;
  }

})();
