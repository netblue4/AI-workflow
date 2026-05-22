(function () {
  'use strict';

  // ---- Module state -----------------------------------------
  let _step = null;
  let _detail = null;
  let _colorKey = null;
  let _phaseTitle = null;
  let _container = null;
  let _framework = null;
  let _record = null;
  let _step3Data = null;
  let _filteredArticles = [];

  const _state = {
    assessed_by: '',
    use_case_id: '',
    selected_controls: {} // requirement_control_number → boolean
  };

  // ---- Public API -------------------------------------------
  window.mountStep7Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container = container;
    _step = step;
    _detail = detail;
    _colorKey = colorKey;
    _phaseTitle = phaseTitle;

    // Reset state for fresh mount
    _state.assessed_by = '';
    _state.use_case_id = '';
    _state.selected_controls = {};
    _framework = null;
    _record = null;
    _step3Data = null;
    _filteredArticles = [];

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

    // Load system record from sessionStorage
    try {
      const saved = sessionStorage.getItem('ai_workflow_system_record');
      if (saved) _record = JSON.parse(saved);
    } catch (_e) {}

    _step3Data = _record?.['step-3'] ?? null;

    // Restore prior step-7 selections if they exist
    const saved7 = _record?.['step-7'];
    if (saved7?.selected_controls) {
      _state.assessed_by = saved7.assessed_by || '';
      _state.use_case_id = saved7.use_case_id || '';
      saved7.selected_controls.forEach(c => {
        _state.selected_controls[c.requirement_control_number] = c.selected;
      });
    }

    _filteredArticles = _buildFilteredArticles();

    // Default all to selected if no prior state
    if (Object.keys(_state.selected_controls).length === 0) {
      _filteredArticles.forEach(a =>
        a.fields.forEach(f =>
          f.controls.forEach(c => { _state.selected_controls[c.requirement_control_number] = true; })
        )
      );
    }

    _renderPanes(paneWrap);
  }

  function _buildFilteredArticles() {
    if (!_framework) return [];
    const allArticles = _framework['1. Compliance Requirements'] || [];
    const applicable = _step3Data?.all_requirement_control_numbers
      ? new Set(_step3Data.all_requirement_control_numbers)
      : null;

    return allArticles.map(article => {
      const filteredFields = (article.Fields || []).map(field => {
        const filteredControls = (field.controls || []).filter(c =>
          !applicable || applicable.has(c.requirement_control_number)
        );
        return filteredControls.length ? { ...field, controls: filteredControls } : null;
      }).filter(Boolean);

      return filteredFields.length ? {
        stepName: article.StepName,
        objectives: article.Objectives || [],
        fields: filteredFields
      } : null;
    }).filter(Boolean);
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

    // Eyebrow
    const ey = _el('p', `step-detail-eyebrow color-${_colorKey}`);
    ey.textContent = _phaseTitle;
    card.appendChild(ey);

    // Title
    const title = _el('h2', 'step-detail-title');
    title.textContent = `Step ${_step.number} — ${_step.title}`;
    card.appendChild(title);

    // Meta
    const meta = _el('div', 'step-detail-meta');
    (_step.owners || []).forEach(o => {
      const tag = _el('span', 'owner-tag');
      tag.textContent = o;
      meta.appendChild(tag);
    });
    card.appendChild(meta);

    // Summary
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

    // Risk assessment section
    card.appendChild(_sectionLabel('Risk & Control Assessment'));
    card.appendChild(_buildStep3SummaryCard());
    card.appendChild(_buildIdentitySection());

    const totalControls = _filteredArticles.reduce(
      (s, a) => s + a.fields.reduce((s2, f) => s2 + f.controls.length, 0), 0
    );

    if (totalControls === 0 && _step3Data) {
      const notice = _el('p', 'wiz7-notice');
      notice.textContent = 'No applicable controls found for this classification.';
      card.appendChild(notice);
    } else {
      const instr = _el('p', 'wiz7-instruction');
      instr.innerHTML = `<strong>${totalControls} control${totalControls !== 1 ? 's' : ''}</strong> ${_step3Data ? 'are applicable based on the Step 3 classification' : '(all controls shown — complete Step 3 first for filtered view)'}. Review each and deselect controls that do not apply to your specific deployment.`;
      card.appendChild(instr);

      _filteredArticles.forEach(a => card.appendChild(_buildArticleSection(a)));
    }

    card.appendChild(_buildActionRow());

    const resultsArea = _el('div', 'wiz7-results');
    card.appendChild(resultsArea);

    return card;
  }

  // ---- Step 3 summary card ----------------------------------
  function _buildStep3SummaryCard() {
    const card = _el('div', 'wiz7-source-card');

    if (!_step3Data) {
      const w = _el('div', 'wiz7-warn');
      w.innerHTML = '<strong>Step 3 not yet completed.</strong> Complete Step 3 (System classification) to filter controls to only those applicable to your system. All 95 controls are shown.';
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

  // ---- Article section --------------------------------------
  function _buildArticleSection(article) {
    const sec = _el('div', 'wiz7-article');
    const totalControls = article.fields.reduce((s, f) => s + f.controls.length, 0);

    // Header
    const header = _el('div', 'wiz7-article-header');

    const left = _el('div', 'wiz7-article-header-left');
    const nameEl = _el('span', 'wiz7-article-name');
    nameEl.textContent = article.stepName;
    left.appendChild(nameEl);
    const badge = _el('span', 'wiz7-count-badge');
    badge.textContent = `${totalControls} control${totalControls !== 1 ? 's' : ''}`;
    left.appendChild(badge);
    header.appendChild(left);

    const right = _el('div', 'wiz7-article-header-right');

    const selAll = document.createElement('button');
    selAll.className = 'wiz7-sel-btn';
    selAll.textContent = 'Select all';
    selAll.addEventListener('click', e => { e.stopPropagation(); _setArticleSelection(article, true); });
    right.appendChild(selAll);

    const deselAll = document.createElement('button');
    deselAll.className = 'wiz7-sel-btn';
    deselAll.textContent = 'Deselect all';
    deselAll.addEventListener('click', e => { e.stopPropagation(); _setArticleSelection(article, false); });
    right.appendChild(deselAll);

    const chevron = _el('span', 'wiz7-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    right.appendChild(chevron);
    header.appendChild(right);
    sec.appendChild(header);

    // Body
    const body = _el('div', 'wiz7-article-body');

    if (article.objectives?.length) {
      const obj = _el('p', 'wiz7-objective');
      obj.textContent = article.objectives[0].Objective;
      body.appendChild(obj);
    }

    article.fields.forEach(f => body.appendChild(_buildFieldGroup(f)));
    sec.appendChild(body);

    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('wiz7-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });

    return sec;
  }

  function _setArticleSelection(article, selected) {
    article.fields.forEach(f =>
      f.controls.forEach(c => { _state.selected_controls[c.requirement_control_number] = selected; })
    );
    _syncCheckboxes();
  }

  function _syncCheckboxes() {
    _container.querySelectorAll('.wiz7-ctrl-cb').forEach(cb => {
      const rcn = cb.dataset.rcn;
      if (rcn !== undefined) cb.checked = !!_state.selected_controls[rcn];
    });
    _updateCountBadge();
  }

  function _updateCountBadge() {
    const sel = Object.values(_state.selected_controls).filter(Boolean).length;
    const tot = Object.keys(_state.selected_controls).length;
    const badge = _container.querySelector('#wiz7-count');
    if (badge) badge.textContent = `${sel} / ${tot} selected`;
  }

  // ---- Field group -----------------------------------------
  function _buildFieldGroup(field) {
    const fg = _el('div', 'wiz7-fg');

    const fn = _el('p', 'wiz7-fg-name');
    fn.textContent = field.jkName;
    fg.appendChild(fn);

    const list = _el('div', 'wiz7-ctrl-list');
    field.controls.forEach(c => list.appendChild(_buildControlRow(c)));
    fg.appendChild(list);

    return fg;
  }

  // ---- Control row -----------------------------------------
  function _buildControlRow(ctrl) {
    const row = _el('div', 'wiz7-ctrl-row');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'wiz7-ctrl-cb';
    cb.dataset.rcn = ctrl.requirement_control_number;
    cb.checked = !!_state.selected_controls[ctrl.requirement_control_number];
    cb.addEventListener('change', e => {
      _state.selected_controls[ctrl.requirement_control_number] = e.target.checked;
      _updateCountBadge();
    });
    row.appendChild(cb);

    const content = _el('div', 'wiz7-ctrl-content');

    const top = _el('div', 'wiz7-ctrl-top');
    const rcnBadge = _el('span', 'wiz7-rcn');
    rcnBadge.textContent = ctrl.requirement_control_number;
    top.appendChild(rcnBadge);
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

  // ---- Save handler ----------------------------------------
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

    try {
      sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record));
    } catch (_e) {}

    _downloadRecord();
    _renderResults(rec7);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const controls = [];

    _filteredArticles.forEach(a =>
      a.fields.forEach(f =>
        f.controls.forEach(c => {
          controls.push({
            requirement_control_number: c.requirement_control_number,
            article: a.stepName,
            field_group: f.jkName,
            control_name: c.jkName,
            control_description: c.jkText || '',
            selected: !!_state.selected_controls[c.requirement_control_number]
          });
        })
      )
    );

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
      total_controls_applicable: controls.length,
      total_controls_selected: controls.filter(c => c.selected).length,
      selected_controls: controls
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

          // Restore step-7 state from uploaded record
          const s7 = _record?.['step-7'];
          _state.selected_controls = {};
          if (s7?.selected_controls) {
            _state.assessed_by = s7.assessed_by || '';
            _state.use_case_id = s7.use_case_id || '';
            s7.selected_controls.forEach(c => {
              _state.selected_controls[c.requirement_control_number] = c.selected;
            });
          }

          _filteredArticles = _buildFilteredArticles();

          // If still no selections, default all to selected
          if (Object.keys(_state.selected_controls).length === 0) {
            _filteredArticles.forEach(a =>
              a.fields.forEach(f =>
                f.controls.forEach(c => { _state.selected_controls[c.requirement_control_number] = true; })
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
    [[rec7.total_controls_selected, 'Controls selected'],
     [rec7.total_controls_applicable - rec7.total_controls_selected, 'Controls excluded'],
     [rec7.total_controls_applicable, 'Total applicable']
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
    note.textContent = 'System record updated and downloaded. Selected controls will feed into Step 9 (Risk Treatment). Step 8 (DPIA) will additionally extract Article 10 data governance controls.';
    card.appendChild(note);

    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane --------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');

    const title = _el('h2', 'step-detail-title');
    title.textContent = 'Risk & Control Framework Reference';
    card.appendChild(title);

    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Complete listing of all EU AI Act compliance articles and their associated control families in the AI Risk Control Framework. Controls applicable to a specific system are determined by the Step 3 classification output.';
    card.appendChild(sub);

    const articles = _framework?.['1. Compliance Requirements'] || [];

    articles.forEach(article => {
      const totalControls = (article.Fields || []).reduce(
        (s, f) => s + (f.controls || []).length, 0
      );

      const sec = _el('div', 'wiz7-ref-article');

      const h3 = _el('div', 'wiz7-ref-article-header');
      const nm = _el('span', 'wiz7-ref-article-name');
      nm.textContent = article.StepName;
      h3.appendChild(nm);
      const cnt = _el('span', 'wiz7-count-badge');
      cnt.textContent = `${totalControls} controls`;
      h3.appendChild(cnt);
      sec.appendChild(h3);

      (article.Fields || []).forEach(field => {
        const fg = _el('div', 'wiz7-ref-fg');
        const fn = _el('p', 'wiz7-ref-fg-name');
        fn.textContent = field.jkName;
        fg.appendChild(fn);

        const grid = _el('div', 'wiz7-ref-ctrl-grid');
        (field.controls || []).forEach(ctrl => {
          const c = _el('div', 'wiz7-ref-ctrl');
          const rcn = _el('span', 'wiz7-rcn');
          rcn.textContent = ctrl.requirement_control_number;
          c.appendChild(rcn);
          const nm2 = _el('span', 'wiz7-ref-ctrl-name');
          nm2.textContent = ctrl.jkName;
          c.appendChild(nm2);
          grid.appendChild(c);
        });

        fg.appendChild(grid);
        sec.appendChild(fg);
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
/* ---- Step 7 Wizard — base layout (safe to redeclare alongside wiz3) ---- */
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

/* ---- Article accordion ---- */
.wiz7-article { border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
.wiz7-article-header { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; background: var(--color-bg-subtle,#f8fafc); cursor: pointer; user-select: none; gap: 10px; }
.wiz7-article-header:hover { background: var(--color-bg-hover,#f1f5f9); }
.wiz7-article-header-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.wiz7-article-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.wiz7-count-badge { font-size: 11px; font-weight: 600; background: var(--teal-100,#ccfbf1); color: var(--teal-700,#0f766e); padding: 2px 8px; border-radius: 10px; white-space: nowrap; flex-shrink: 0; }
.wiz7-article-header-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.wiz7-sel-btn { font-size: 11px; font-weight: 500; color: var(--teal-600,#0d9488); background: none; border: 1px solid var(--teal-200,#99f6e4); border-radius: 4px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.wiz7-sel-btn:hover { background: var(--teal-50,#f0fdfa); }
.wiz7-chevron { display: flex; color: var(--color-text-tertiary); flex-shrink: 0; transition: transform .2s; }
.wiz7-article-body { padding: 0 14px 14px; }
.wiz7-collapsed { display: none; }

/* ---- Objective ---- */
.wiz7-objective { font-size: 12px; color: var(--color-text-tertiary); line-height: 1.6; margin: 12px 0 8px; padding: 8px 10px; background: var(--color-bg-subtle,#f8fafc); border-radius: 4px; border-left: 3px solid var(--info-300,#7dd3fc); }

/* ---- Field group ---- */
.wiz7-fg { margin-top: 14px; }
.wiz7-fg-name { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--color-text-tertiary); margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid var(--color-border); }

/* ---- Control rows ---- */
.wiz7-ctrl-list { display: flex; flex-direction: column; gap: 5px; }
.wiz7-ctrl-row { display: flex; align-items: flex-start; gap: 10px; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: 6px; background: #fff; transition: background .1s; }
.wiz7-ctrl-row:hover { background: var(--color-bg-subtle,#f8fafc); }
.wiz7-ctrl-cb { margin-top: 3px; flex-shrink: 0; accent-color: var(--teal-600,#0d9488); width: 14px; height: 14px; cursor: pointer; }
.wiz7-ctrl-content { flex: 1; min-width: 0; }
.wiz7-ctrl-top { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; flex-wrap: wrap; }
.wiz7-rcn { font-size: 10px; font-weight: 700; font-family: var(--font-mono,monospace); background: var(--purple-100,#ede9fe); color: var(--purple-700,#6d28d9); padding: 1px 5px; border-radius: 3px; white-space: nowrap; flex-shrink: 0; }
.wiz7-ctrl-name { font-size: 13px; font-weight: 600; color: var(--color-text-primary); }
.wiz7-ctrl-desc { font-size: 12px; color: var(--color-text-secondary); line-height: 1.55; margin: 0; }

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
.wiz7-ref-article-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid var(--color-border); }
.wiz7-ref-article-name { font-size: 13px; font-weight: 700; color: var(--color-text-primary); }
.wiz7-ref-fg { margin-bottom: 12px; padding-left: 12px; border-left: 3px solid var(--color-border); }
.wiz7-ref-fg-name { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--color-text-tertiary); margin: 0 0 8px; }
.wiz7-ref-ctrl-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap: 5px; }
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
