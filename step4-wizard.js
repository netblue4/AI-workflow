/* Step 4 — Data identification and DPIA Wizard
   Reads step-4.json for DPIA section/field definitions.
   Saves to system-record["step-4"]; identity from central _meta.
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _detail = null, _record = null;
  const _answers = {}; // fieldId → string | string[]
  let _rationale = ''; // free-text DPIA rationale (holds JAKE's reasoning)

  // ---- Public API ---------------------------------------------
  window.mountStep4Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container = container;
    _step      = step;
    _colorKey  = colorKey;
    _phaseTitle = phaseTitle;
    _detail    = detail;
    _record    = null;
    // Clear answers
    Object.keys(_answers).forEach(k => delete _answers[k]);
    _rationale = '';

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(WizUtils.buildStepHeader(step, colorKey, phaseTitle));
    shell.appendChild(_buildTabStrip());
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _init(pw);
  };

  // ---- Init ---------------------------------------------------
  function _init(pw) {
    _record = WizUtils.loadRecord();
    const s7 = _record?.['step-4'];
    if (s7?.answers) Object.assign(_answers, s7.answers);
    if (s7?.rationale) _rationale = s7.rationale;
    _renderPanes(pw);
    _evalConditions();
    // Persist the saved DPIA summary across navigation, the way Step 3 shows a
    // saved classification result. A completed save carries completion_date +
    // data_types_identified; a JAKE-loaded draft (answers only) does not.
    if (s7 && s7.completion_date && s7.data_types_identified) {
      _renderResults(s7);
      const prog = _container.querySelector('#dpia-progress');
      if (prog) prog.textContent = _computeProgress();
    }
  }

  // ---- Condition helpers --------------------------------------
  const _NONE_PD = 'None — no personal data processed';

  function _hasPersonalData() {
    const subjects = _answers['s2_f1'];
    const types    = _answers['s2_f2'];
    const realSubjects = Array.isArray(subjects) ? subjects.filter(x => x !== _NONE_PD) : [];
    const realTypes    = Array.isArray(types)    ? types.filter(x => x !== _NONE_PD)    : [];
    return realSubjects.length > 0 || realTypes.length > 0;
  }

  function _hasNoneInS2() {
    const s1 = _answers['s2_f1'];
    const s2 = _answers['s2_f2'];
    return (Array.isArray(s1) && s1.includes(_NONE_PD)) ||
           (Array.isArray(s2) && s2.includes(_NONE_PD));
  }

  function _hasSpecialCategoryData() {
    const v = _answers['s3_f1'];
    if (!Array.isArray(v) || v.length === 0) return false;
    return !v.every(x => x === 'None — no special category data');
  }

  function _isADMApplicable() {
    const v = _answers['s5_f1'] || '';
    return v.startsWith('Partially') || v.startsWith('Yes —');
  }

  // ---- Conditional logic --------------------------------------
  function _evalConditions() {
    const hasData    = _hasPersonalData();
    const noneInS2   = _hasNoneInS2();
    const hasSpecial = _hasSpecialCategoryData();
    const hasADM     = _isADMApplicable();
    const isLIA      = (_answers['s4_f1'] || '') === 'Art.6(1)(f) — Legitimate interests';

    // Section gates: s4, s6, s9 require personal data to be identified
    ['s4', 's6', 's9'].forEach(sid => {
      const el = _container.querySelector(`[data-section-id="${sid}"]`);
      if (el) el.classList.toggle('dpia-section--disabled', !hasData);
    });

    // Field-level gates
    _toggleField('s2_f3', noneInS2);
    _toggleField('s2_f4', noneInS2);
    _toggleField('s3_f2', !hasSpecial);
    _toggleField('s3_f3', !hasSpecial);
    _toggleField('s4_f2', !isLIA);
    _toggleField('s5_f2', !hasADM);
    _toggleField('s5_f3', !hasADM);

    // Refresh all badges
    if (_detail?.sections) {
      _detail.sections.forEach(s => _updateSectionBadge(s));
    }

    // Refresh progress label
    const prog = _container.querySelector('#dpia-progress');
    if (prog) prog.textContent = _computeProgress();
  }

  function _toggleField(fieldId, hide) {
    const el = _container.querySelector(`[data-field-id="${fieldId}"]`);
    if (el) el.classList.toggle('dpia-field--hidden', hide);
  }

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    return WizUtils.buildTabStrip([['wizard', 'Step Wizard'], ['reference', 'Reference']], _switchTab);
  }

  function _switchTab(id) {
    _container.querySelectorAll('.wiz-tab').forEach(t =>
      t.classList.toggle('wiz-tab--active', t.dataset.tab === id));
    _container.querySelectorAll('.wiz-pane').forEach(p =>
      p.classList.toggle('wiz-pane--hidden', p.dataset.pane !== id));
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const wz  = _el('div', 'wiz-pane');  wz.dataset.pane  = 'wizard';
    const ref = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane = 'reference';
    wz.appendChild(_buildWizardPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(wz);
    pw.appendChild(ref);
  }

  // ---- Wizard pane --------------------------------------------
  function _buildWizardPane() {
    const card = _el('div', 'step-detail-card');

    if (_detail?.description) {
      const d = _el('p', 'step-detail-summary');
      d.textContent = _detail.description;
      card.appendChild(d);
    }

    // Scope note
    const note = _el('div', 'dpia-info-note');
    if (_detail?.scope_note) {
      const strong = _el('strong'); strong.textContent = 'GDPR Art.35 scope: ';
      note.appendChild(strong);
      note.appendChild(document.createTextNode(_detail.scope_note));
    }
    card.appendChild(note);

    // Sections
    card.appendChild(_sectionLabel('DPIA Sections'));
    if (_detail?.sections) {
      _detail.sections.forEach((section, idx) => {
        card.appendChild(_buildSectionAccordion(section, idx));
      });
    } else {
      const warn = _el('p', 'dpia-warn');
      warn.textContent = 'No DPIA sections found — check that step-4.json loaded correctly.';
      card.appendChild(warn);
    }

    card.appendChild(_buildRationaleSection());
    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'dpia-results'));
    return card;
  }

  // Rationale textbox — holds the reasoning JAKE returns (or the assessor's own
  // notes) so the "why" behind the DPIA answers is saved in the record.
  function _buildRationaleSection() {
    const wrap = _el('div', 'dpia-rationale-wrap');
    wrap.appendChild(_sectionLabel('DPIA rationale'));
    const hint = _el('p', 'dpia-rationale-hint');
    hint.textContent = 'Reasoning behind the DPIA answers. Loaded from JAKE’s reasoning, or add your own notes. Saved with the DPIA.';
    wrap.appendChild(hint);
    const ta = document.createElement('textarea');
    ta.className = 'dpia-rationale-ta';
    ta.rows = 5;
    ta.placeholder = 'Rationale for the data-protection assessment…';
    ta.value = _rationale || '';
    ta.addEventListener('input', () => { _rationale = ta.value; });
    wrap.appendChild(ta);
    return wrap;
  }

  // ---- Section accordion --------------------------------------
  function _buildSectionAccordion(section, idx) {
    const wrap = _el('div', 'dpia-section');
    wrap.dataset.sectionId = section.id;

    // Header
    const header = _el('div', 'dpia-section-header');

    const left = _el('div', 'dpia-section-header-left');
    const num  = _el('span', 'dpia-section-num');
    num.textContent = String(idx + 1);
    left.appendChild(num);
    const sTitle = _el('span', 'dpia-section-title');
    sTitle.textContent = section.title;
    left.appendChild(sTitle);
    if (section.gdpr_ref) {
      const ref = _el('span', 'dpia-gdpr-ref');
      ref.textContent = section.gdpr_ref;
      left.appendChild(ref);
    }
    header.appendChild(left);

    const right = _el('div', 'dpia-section-header-right');
    const badge = _el('span', 'wiz-item-badge');
    badge.id = `dpia-badge-${section.id}`;
    right.appendChild(badge);
    const chevron = _el('span', 'dpia-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    if (idx !== 0) chevron.style.transform = 'rotate(-90deg)';
    right.appendChild(chevron);
    header.appendChild(right);
    wrap.appendChild(header);

    // Body
    const body = _el('div', `dpia-section-body${idx !== 0 ? ' dpia-collapsed' : ''}`);

    // N/A notice — visible only when section is disabled
    const naNotice = _el('div', 'dpia-na-notice');
    naNotice.innerHTML = '<strong>Not applicable</strong> — Identify personal data in Section 2 (Data inventory) to activate this section.';
    body.appendChild(naNotice);

    if (section.description) {
      const desc = _el('p', 'dpia-section-desc');
      desc.textContent = section.description;
      body.appendChild(desc);
    }
    (section.fields || []).forEach(f => body.appendChild(_buildField(f, section)));
    wrap.appendChild(body);

    _updateSectionBadge(section);

    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('dpia-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
    return wrap;
  }

  // ---- Field rendering ----------------------------------------
  function _buildField(field, section) {
    // Dividers render as visual separators — no data-field-id wrapper
    if (field.type === 'divider') {
      const div = _el('div', 'dpia-divider');
      const lbl = _el('span', 'dpia-divider-label');
      lbl.textContent = field.label;
      div.appendChild(lbl);
      return div;
    }

    const wrap = _el('div', 'dpia-field-wrap');
    wrap.dataset.fieldId = field.id;

    // Label row
    const lbl = _el('label', 'dpia-label');
    lbl.textContent = field.label;
    if (field.required) {
      const req = _el('span', 'dpia-required'); req.textContent = ' *'; lbl.appendChild(req);
    }
    wrap.appendChild(lbl);

    // Hint
    if (field.hint) {
      const hint = _el('p', 'dpia-hint'); hint.textContent = field.hint; wrap.appendChild(hint);
    }

    const cur = _answers[field.id];
    // Every field change re-evaluates all conditions (badges, progress, visibility)
    const onChange = () => _evalConditions();

    if (field.type === 'text') {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'dpia-text-input';
      inp.placeholder = field.placeholder || ''; inp.value = cur || '';
      inp.addEventListener('input', e => { _answers[field.id] = e.target.value; onChange(); });
      wrap.appendChild(inp);

    } else if (field.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.className = 'dpia-textarea'; ta.rows = 4;
      ta.placeholder = field.placeholder || ''; ta.value = cur || '';
      ta.addEventListener('input', e => { _answers[field.id] = e.target.value; onChange(); });
      wrap.appendChild(ta);

    } else if (field.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'dpia-select';
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '— Select —'; sel.appendChild(blank);
      (field.options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        if (cur === opt) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', e => { _answers[field.id] = e.target.value; onChange(); });
      wrap.appendChild(sel);

    } else if (field.type === 'checkbox_group') {
      const curArr = Array.isArray(cur) ? cur : [];
      const grid = _el('div', 'dpia-cb-grid');
      (field.options || []).forEach(opt => {
        const cbWrap = _el('label', 'dpia-cb-wrap');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.className = 'dpia-cb';
        cb.value = opt; cb.checked = curArr.includes(opt);
        cb.addEventListener('change', () => {
          const all = grid.querySelectorAll('.dpia-cb');
          const selected = [];
          all.forEach(c => { if (c.checked) selected.push(c.value); });
          _answers[field.id] = selected;
          onChange();
        });
        cbWrap.appendChild(cb);
        cbWrap.appendChild(document.createTextNode(' ' + opt));
        grid.appendChild(cbWrap);
      });
      wrap.appendChild(grid);
    }

    return wrap;
  }

  // ---- Section completion badge -------------------------------
  function _updateSectionBadge(section) {
    const badge = document.getElementById(`dpia-badge-${section.id}`);
    if (!badge) return;

    // Show N/A badge when section is disabled
    const sectionEl = _container.querySelector(`[data-section-id="${section.id}"]`);
    if (sectionEl?.classList.contains('dpia-section--disabled')) {
      badge.textContent = 'N/A';
      badge.className = 'wiz-item-badge wiz-item-badge--na';
      return;
    }

    // Required fields — exclude dividers and hidden fields
    const required = (section.fields || []).filter(f => f.required && f.type !== 'divider');
    if (!required.length) { badge.textContent = ''; badge.className = 'wiz-item-badge'; return; }

    const visibleRequired = required.filter(f => {
      const el = _container.querySelector(`[data-field-id="${f.id}"]`);
      return !el?.classList.contains('dpia-field--hidden');
    });

    if (!visibleRequired.length) { badge.textContent = ''; badge.className = 'wiz-item-badge'; return; }

    const filled = visibleRequired.filter(f => {
      const v = _answers[f.id];
      if (!v) return false;
      return Array.isArray(v) ? v.length > 0 : v.trim() !== '';
    });

    badge.textContent = `${filled.length} / ${visibleRequired.length}`;
    badge.className = filled.length === 0
      ? 'wiz-item-badge wiz-item-badge--none'
      : filled.length === visibleRequired.length
        ? 'wiz-item-badge wiz-item-badge--ok'
        : 'wiz-item-badge wiz-item-badge--partial';
  }

  // ---- Progress counter ---------------------------------------
  function _computeProgress() {
    if (!_detail?.sections) return '';
    let totalRequired = 0, filled = 0;

    _detail.sections.forEach(s => {
      // Skip disabled sections entirely
      const sectionEl = _container.querySelector(`[data-section-id="${s.id}"]`);
      if (sectionEl?.classList.contains('dpia-section--disabled')) return;

      (s.fields || []).filter(f => f.required && f.type !== 'divider').forEach(f => {
        // Skip hidden fields
        const el = _container.querySelector(`[data-field-id="${f.id}"]`);
        if (el?.classList.contains('dpia-field--hidden')) return;
        totalRequired++;
        const v = _answers[f.id];
        if (v && (Array.isArray(v) ? v.length > 0 : v.trim() !== '')) filled++;
      });
    });

    return `${filled} / ${totalRequired} required fields completed`;
  }

  // ---- Action row ---------------------------------------------
  function _buildActionRow() {
    const row = _el('div', 'wiz-action-row');
    const left = _el('div');
    const prog = _el('span', 'dpia-progress-label');
    prog.id = 'dpia-progress'; prog.textContent = _computeProgress();
    left.appendChild(prog);
    row.appendChild(left);
    const right = _el('div', 'dpia-action-right');
    const btn = document.createElement('button');
    btn.className = 'wiz-btn-primary'; btn.textContent = 'Save DPIA';
    btn.addEventListener('click', _handleSave);
    right.appendChild(btn);
    const clearBtn = document.createElement('button');
    clearBtn.className = 'wiz-btn-secondary'; clearBtn.textContent = '↺ Clear all answers';
    clearBtn.addEventListener('click', _clearAll);
    right.appendChild(clearBtn);
    row.appendChild(right);
    return row;
  }

  // Reset in-memory answers and re-render the panes. Matches Step 5's behaviour:
  // the saved record is untouched until the user saves the DPIA again.
  function _clearAll() {
    Object.keys(_answers).forEach(k => delete _answers[k]);
    _rationale = '';
    const pw = _container.querySelector('.wiz-pane-wrap');
    if (pw) _renderPanes(pw);
    _evalConditions();
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    const rec7 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-4'] = rec7;
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('DPIA saved ✓');
    _renderResults(rec7);
    const prog = _container.querySelector('#dpia-progress');
    if (prog) prog.textContent = _computeProgress();
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};
    const getArr = id => { const v = _answers[id]; return Array.isArray(v) ? v : []; };
    const getStr = id => _answers[id] || '';
    const s3f1 = getArr('s3_f1');
    const specialCatData = s3f1.includes('None — no special category data')
      ? [] : s3f1.filter(x => x !== 'None — no special category data');

    return {
      step_id:   'step-4',
      step_title: 'Data identification and DPIA',
      completion_date: today,
      assessed_by:    meta.assessed_by  || '',
      use_case_id:    meta.use_case_id  || '',
      data_types_identified: {
        data_subjects:            getArr('s2_f1'),
        standard_personal_data:   getArr('s2_f2'),
        special_category_data:    specialCatData,
        automated_decision_making: getStr('s5_f1'),
        training_data_use:        getStr('s6_f3'),
        security_measures:        getArr('s7_f1'),
        erasure_capability:       getStr('s8_f2'),
        privacy_risks:            getArr('s10_f1')
      },
      lawful_basis:             getStr('s4_f1'),
      inherent_risk_rating:     getStr('s10_f2'),
      residual_risk_rating:     getStr('s10_f3'),
      dpo_consulted:            getStr('s11_f1'),
      art36_consultation_required: getStr('s11_f3'),
      rationale: _rationale || '',
      answers: Object.assign({}, _answers)
    };
  }

  // ---- Results area -------------------------------------------
  function _renderResults(rec7) {
    const area = _container.querySelector('.dpia-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'dpia-result-card');

    const h = _el('h3', 'dpia-result-title'); h.textContent = 'DPIA Saved'; card.appendChild(h);

    const di    = rec7.data_types_identified;
    const stats = _el('div', 'dpia-result-stats');
    [
      [(di.standard_personal_data.length + di.special_category_data.length), 'Data types'],
      [di.special_category_data.length, 'Special categories'],
      [di.privacy_risks.length,         'Privacy risks'],
      [rec7.residual_risk_rating || '—', 'Residual risk']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'dpia-stat');
      const n = _el('span', 'dpia-stat-num'); n.textContent = String(num);
      const l = _el('span', 'dpia-stat-lbl'); l.textContent = lbl;
      s.appendChild(n); s.appendChild(l); stats.appendChild(s);
    });
    card.appendChild(stats);

    const note = _el('p', 'dpia-result-note');
    note.innerHTML = `DPIA saved to record. <strong>${di.standard_personal_data.length + di.special_category_data.length} data type${(di.standard_personal_data.length + di.special_category_data.length) !== 1 ? 's' : ''}</strong> identified will be used to scope the Risk Assessment in Step 5. Use the <strong>Save Record</strong> button in the sidebar to download the full system record.`;
    card.appendChild(note);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane -----------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');

    const title = _el('h2', 'step-detail-title');
    title.textContent = 'DPIA Reference — GDPR Article 35';
    card.appendChild(title);

    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'A Data Protection Impact Assessment is mandatory where processing is likely to result in a high risk to individuals. The sections below summarise the key legal obligations.';
    card.appendChild(sub);

    const sections = _detail?.reference_sections || [];

    sections.forEach(sec => {
      const h = _el('p', 'section-label'); h.textContent = sec.heading; card.appendChild(h);
      const ul = _el('ul', 'dpia-ref-list');
      sec.items.forEach(item => {
        const li = _el('li', 'dpia-ref-item'); li.textContent = item; ul.appendChild(li);
      });
      card.appendChild(ul);
    });

    if (_detail?.requirement_labels) {
      card.appendChild(_sectionLabel('Requirement mapping'));
      const rw = _el('div', 'req-list');
      _detail.requirement_labels.forEach(r => {
        const pill = _el('span', 'req-pill'); pill.textContent = r; rw.appendChild(pill);
      });
      card.appendChild(rw);
    }

    return card;
  }

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    WizUtils.injectStyles('wiz4-styles', `
/* ---- DPIA info note ---- */
.dpia-info-note{background:var(--info-50,rgba(80,150,225,0.12));border:1px solid var(--info-200,rgba(80,150,225,0.40));border-left:3px solid var(--info-400,#38bdf8);border-radius:6px;padding:12px 14px;font-size:13px;color:var(--info-800,#a4ccf6);line-height:1.6;margin-bottom:20px}

/* ---- DPIA rationale ---- */
.dpia-rationale-wrap{margin-top:22px}
.dpia-rationale-hint{font-size:12px;color:var(--color-text-secondary);margin:0 0 8px}
.dpia-rationale-ta{width:100%;box-sizing:border-box;font-size:13px;font-family:inherit;color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:6px;padding:10px 12px;line-height:1.5;resize:vertical;background:var(--color-bg-subtle,#211d15)}
.dpia-rationale-ta:focus{outline:none;border-color:var(--info-400,#38bdf8);background:var(--color-surface)}

/* ---- Section accordion ---- */
.dpia-section{border:1px solid var(--color-border);border-radius:8px;margin-bottom:10px;overflow:hidden}
.dpia-section-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none;gap:10px}
.dpia-section-header:hover{background:var(--color-bg-hover,#262219)}
.dpia-section-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.dpia-section-num{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:var(--purple-100,rgba(138,130,235,0.16));color:var(--purple-700,#bfb8ff);padding:2px 7px;border-radius:4px;flex-shrink:0;font-family:var(--font-mono,monospace)}
.dpia-section-title{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.dpia-gdpr-ref{font-size:11px;color:var(--color-text-tertiary);font-style:italic;white-space:nowrap;flex-shrink:0}
.dpia-section-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.dpia-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.dpia-section-body{padding:16px;display:flex;flex-direction:column;gap:16px}
.dpia-collapsed{display:none}
.dpia-section-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0;padding:10px 12px;background:var(--color-bg);border-radius:6px;border:1px solid var(--color-border)}

/* ---- Conditional sections ---- */
.dpia-section--disabled .dpia-section-header{opacity:.5}
.dpia-na-notice{display:none;font-size:12px;color:var(--color-text-tertiary);background:var(--color-bg-subtle,#211d15);border:1px dashed var(--color-border);border-radius:5px;padding:10px 12px;line-height:1.55}
.dpia-section--disabled .dpia-na-notice{display:block}
.dpia-section--disabled .dpia-section-body > :not(.dpia-na-notice){display:none!important}
.dpia-field--hidden{display:none!important}

/* ---- Divider ---- */
.dpia-divider{display:flex;align-items:center;gap:12px;padding:10px 0 4px;border-top:1px solid var(--color-border);margin-top:6px}
.dpia-divider-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-tertiary);white-space:nowrap}

/* ---- Fields ---- */
.dpia-field-wrap{display:flex;flex-direction:column;gap:6px}
.dpia-label{font-size:13px;font-weight:600;color:var(--color-text-primary);cursor:default}
.dpia-required{color:var(--danger-500,#ec6a68)}
.dpia-hint{font-size:11px;color:var(--color-text-tertiary);margin:0;line-height:1.55;padding:6px 10px;background:var(--color-bg);border-radius:4px;border:1px solid var(--color-border)}
.dpia-text-input,.dpia-textarea,.dpia-select{width:100%;padding:8px 11px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface);outline:none;box-sizing:border-box}
.dpia-textarea{resize:vertical;line-height:1.6}
.dpia-text-input:focus,.dpia-textarea:focus,.dpia-select:focus{border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,rgba(93,202,165,0.16))}
.dpia-select{cursor:pointer}
.dpia-cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}
.dpia-cb-wrap{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border:1px solid var(--color-border);border-radius:5px;font-size:13px;color:var(--color-text-primary);background:var(--color-surface);cursor:pointer;line-height:1.45}
.dpia-cb-wrap:hover{background:var(--color-bg-subtle,#211d15)}
.dpia-cb{margin-top:2px;flex-shrink:0;accent-color:var(--teal-600,#8ce3c6);width:14px;height:14px;cursor:pointer}
.dpia-warn{font-size:13px;color:var(--danger-600,#ec6a68);padding:16px 0}

/* ---- Action row ---- */
.dpia-action-right{display:flex;gap:8px}
.dpia-progress-label{font-size:13px;font-weight:600;color:var(--color-text-secondary)}

/* ---- Results ---- */
.dpia-results{margin-top:16px}
.dpia-result-card{background:var(--success-50,rgba(52,199,120,0.10));border:1px solid var(--success-200,rgba(52,199,120,0.40));border-radius:8px;padding:20px}
.dpia-result-title{font-size:14px;font-weight:700;color:var(--success-700,#8cebb0);margin:0 0 14px}
.dpia-result-stats{display:flex;gap:28px;margin-bottom:14px;flex-wrap:wrap}
.dpia-stat{display:flex;flex-direction:column;gap:2px}
.dpia-stat-num{font-size:26px;font-weight:700;color:var(--success-700,#8cebb0);line-height:1}
.dpia-stat-lbl{font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
.dpia-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* ---- Reference pane ---- */
.dpia-ref-list{padding-left:20px;margin:0 0 16px}
.dpia-ref-item{font-size:13px;color:var(--color-text-secondary);line-height:1.65;padding:3px 0}
`);
  }

})();
