/* Step 7 — DPIA Wizard (GDPR Article 35)
   Reads step-7.json for section/field definitions.
   Saves to system-record["step-7"]; identity from central _meta.
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _detail = null, _record = null;
  const _answers = {}; // fieldId → string | string[]

  // ---- Public API ---------------------------------------------
  window.mountStep7Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container = container;
    _step      = step;
    _colorKey  = colorKey;
    _phaseTitle = phaseTitle;
    _detail    = detail;
    _record    = null;
    // Clear answers
    Object.keys(_answers).forEach(k => delete _answers[k]);

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(_buildTabStrip());
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _init(pw);
  };

  // ---- Init ---------------------------------------------------
  function _init(pw) {
    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}
    const s7 = _record?.['step-7'];
    if (s7?.answers) Object.assign(_answers, s7.answers);
    _renderPanes(pw);
    _evalConditions();
  }

  // ---- Condition helpers --------------------------------------
  function _hasPersonalData() {
    const subjects = _answers['s2_f1'];
    const types    = _answers['s2_f2'];
    return (Array.isArray(subjects) && subjects.length > 0) ||
           (Array.isArray(types)    && types.length    > 0);
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
    const hasSpecial = _hasSpecialCategoryData();
    const hasADM     = _isADMApplicable();
    const isLIA      = (_answers['s4_f1'] || '') === 'Art.6(1)(f) — Legitimate interests';

    // Section gates: s4, s6, s9 require personal data to be identified
    ['s4', 's6', 's9'].forEach(sid => {
      const el = _container.querySelector(`[data-section-id="${sid}"]`);
      if (el) el.classList.toggle('dpia-section--disabled', !hasData);
    });

    // Field-level gates
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
    const strip = _el('div', 'wiz-tab-strip');
    [['wizard', 'Step Wizard'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
      const btn = document.createElement('button');
      btn.className = `wiz-tab${i === 0 ? ' wiz-tab--active' : ''}`;
      btn.dataset.tab = id;
      btn.textContent = lbl;
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

    // Header
    const ey = _el('p', `step-detail-eyebrow color-${_colorKey}`);
    ey.textContent = _phaseTitle;
    card.appendChild(ey);

    const title = _el('h2', 'step-detail-title');
    title.textContent = `Step ${_step.number} — ${_step.title}`;
    card.appendChild(title);

    const meta = _el('div', 'step-detail-meta');
    (_step.owners || []).forEach(o => {
      const t = _el('span', 'owner-tag'); t.textContent = o; meta.appendChild(t);
    });
    card.appendChild(meta);

    if (_detail?.description) {
      const d = _el('p', 'step-detail-summary');
      d.textContent = _detail.description;
      card.appendChild(d);
    }

    // Deliverables
    if (_step.deliverables?.length) {
      card.appendChild(_sectionLabel('Deliverables'));
      const dl = _el('ul', 'deliverables-list');
      _step.deliverables.forEach(d => {
        const li = _el('li', 'deliverable-item'); li.textContent = d; dl.appendChild(li);
      });
      card.appendChild(dl);
    }

    // Scope note
    const note = _el('div', 'dpia-info-note');
    note.innerHTML = '<strong>GDPR Art.35 scope:</strong> A DPIA is required where AI processing is likely to result in a high risk to individuals — including systematic profiling, processing of special-category data at scale, or automated decision-making with legal effects (Art.22). The data types inventory produced here feeds directly into the Risk Assessment in Step 8.';
    card.appendChild(note);

    // Sections
    card.appendChild(_sectionLabel('DPIA Sections'));
    if (_detail?.sections) {
      _detail.sections.forEach((section, idx) => {
        card.appendChild(_buildSectionAccordion(section, idx));
      });
    } else {
      const warn = _el('p', 'dpia-warn');
      warn.textContent = 'No DPIA sections found — check that step-7.json loaded correctly.';
      card.appendChild(warn);
    }

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'dpia-results'));
    return card;
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
    const badge = _el('span', 'dpia-section-badge');
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
      badge.className = 'dpia-section-badge dpia-section-badge--na';
      return;
    }

    // Required fields — exclude dividers and hidden fields
    const required = (section.fields || []).filter(f => f.required && f.type !== 'divider');
    if (!required.length) { badge.textContent = ''; badge.className = 'dpia-section-badge'; return; }

    const visibleRequired = required.filter(f => {
      const el = _container.querySelector(`[data-field-id="${f.id}"]`);
      return !el?.classList.contains('dpia-field--hidden');
    });

    if (!visibleRequired.length) { badge.textContent = ''; badge.className = 'dpia-section-badge'; return; }

    const filled = visibleRequired.filter(f => {
      const v = _answers[f.id];
      if (!v) return false;
      return Array.isArray(v) ? v.length > 0 : v.trim() !== '';
    });

    badge.textContent = `${filled.length} / ${visibleRequired.length}`;
    badge.className = filled.length === 0
      ? 'dpia-section-badge dpia-section-badge--none'
      : filled.length === visibleRequired.length
        ? 'dpia-section-badge dpia-section-badge--all'
        : 'dpia-section-badge dpia-section-badge--partial';
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
    row.appendChild(right);
    return row;
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    const rec7 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-7'] = rec7;
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
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
      step_id:   'step-7',
      step_title: 'DPIA',
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
    note.innerHTML = `DPIA saved to record. <strong>${di.standard_personal_data.length + di.special_category_data.length} data type${(di.standard_personal_data.length + di.special_category_data.length) !== 1 ? 's' : ''}</strong> identified will be used to scope the Risk Assessment in Step 8. Use the <strong>Save Record</strong> button in the sidebar to download the full system record.`;
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

    const sections = [
      { heading: 'When is a DPIA mandatory? (Art.35(1)–(3))', items: [
        'Systematic and extensive profiling with significant effects on individuals',
        'Large-scale processing of special-category data (Art.9) or criminal conviction data (Art.10)',
        'Systematic monitoring of publicly accessible areas at large scale',
        'Processing types on the supervisory authority high-risk list',
        'New technologies used in a way that creates high risk to data subjects'
      ]},
      { heading: 'Mandatory DPIA content (Art.35(7))', items: [
        '(a) Description of processing: nature, scope, context, purpose, legitimate interests',
        '(b) Assessment of necessity and proportionality',
        '(c) Assessment of risks to rights and freedoms of data subjects',
        '(d) Measures to address risks: safeguards, security measures, oversight mechanisms'
      ]},
      { heading: 'DPO consultation (Art.35(2))', items: [
        'The controller shall seek the advice of the DPO when conducting a DPIA',
        'DPO advice and the controller\'s decision must be documented',
        'Failure to consult the DPO is an infringement of GDPR Art.35(2)'
      ]},
      { heading: 'Prior consultation of supervisory authority (Art.36)', items: [
        'Required where the DPIA shows residual HIGH risk that cannot be mitigated',
        'Controller must not begin processing until the supervisory authority provides written advice',
        'Supervisory authority has 8 weeks to respond, extendable by 6 weeks',
        'Art.36 consultation is a hard stop before deployment where residual risk is unacceptable'
      ]},
      { heading: 'Automated decision-making (Art.22)', items: [
        'Applies where decisions based SOLELY on automated processing have legal or similarly significant effects',
        'Data subject rights: human intervention, express point of view, contest the decision',
        'Three lawful grounds: (a) contract performance, (b) legal authorisation, (c) explicit consent',
        'Special category data subject to Art.22(4) additional restrictions',
        'Explainability obligation: data subjects must receive "meaningful information about the logic involved"'
      ]},
      { heading: 'GDPR Art.9 special category safeguards', items: [
        'Processing requires both an Art.6 lawful basis AND a specific Art.9(2) condition',
        'Explicit consent (Art.9(2)(a)) requires a separate, specific consent act beyond standard consent',
        'Employment/social security ground (Art.9(2)(b)) requires a basis in Union or Member State law',
        'Additional safeguards must be implemented and documented alongside the Art.9(2) condition'
      ]}
    ];

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
    if (document.getElementById('wiz7-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz7-styles';
    s.textContent = `
/* ---- Shared wizard base layout ---- */
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

/* ---- DPIA info note ---- */
.dpia-info-note{background:var(--info-50,#f0f9ff);border:1px solid var(--info-200,#bae6fd);border-left:3px solid var(--info-400,#38bdf8);border-radius:6px;padding:12px 14px;font-size:13px;color:var(--info-800,#075985);line-height:1.6;margin-bottom:20px}

/* ---- Section accordion ---- */
.dpia-section{border:1px solid var(--color-border);border-radius:8px;margin-bottom:10px;overflow:hidden}
.dpia-section-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none;gap:10px}
.dpia-section-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.dpia-section-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.dpia-section-num{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:var(--purple-100,#ede9fe);color:var(--purple-700,#6d28d9);padding:2px 7px;border-radius:4px;flex-shrink:0;font-family:var(--font-mono,monospace)}
.dpia-section-title{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.dpia-gdpr-ref{font-size:11px;color:var(--color-text-tertiary);font-style:italic;white-space:nowrap;flex-shrink:0}
.dpia-section-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.dpia-section-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center}
.dpia-section-badge--all{background:var(--success-100,#dcfce7);color:var(--success-700,#15803d)}
.dpia-section-badge--partial{background:var(--warning-100,#fef3c7);color:var(--warning-700,#b45309)}
.dpia-section-badge--none{background:var(--danger-100,#fee2e2);color:var(--danger-700,#b91c1c)}
.dpia-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.dpia-section-body{padding:16px;display:flex;flex-direction:column;gap:16px}
.dpia-collapsed{display:none}
.dpia-section-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0;padding:10px 12px;background:var(--color-bg);border-radius:6px;border:1px solid var(--color-border)}

/* ---- Conditional sections ---- */
.dpia-section--disabled .dpia-section-header{opacity:.5}
.dpia-na-notice{display:none;font-size:12px;color:var(--color-text-tertiary);background:var(--color-bg-subtle,#f8fafc);border:1px dashed var(--color-border);border-radius:5px;padding:10px 12px;line-height:1.55}
.dpia-section--disabled .dpia-na-notice{display:block}
.dpia-section--disabled .dpia-section-body > :not(.dpia-na-notice){display:none!important}
.dpia-section-badge--na{background:var(--color-bg-subtle,#f1f5f9);color:var(--color-text-tertiary);font-weight:600}
.dpia-field--hidden{display:none!important}

/* ---- Divider ---- */
.dpia-divider{display:flex;align-items:center;gap:12px;padding:10px 0 4px;border-top:1px solid var(--color-border);margin-top:6px}
.dpia-divider-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-tertiary);white-space:nowrap}

/* ---- Fields ---- */
.dpia-field-wrap{display:flex;flex-direction:column;gap:6px}
.dpia-label{font-size:13px;font-weight:600;color:var(--color-text-primary);cursor:default}
.dpia-required{color:var(--danger-500,#ef4444)}
.dpia-hint{font-size:11px;color:var(--color-text-tertiary);margin:0;line-height:1.55;padding:6px 10px;background:var(--color-bg);border-radius:4px;border:1px solid var(--color-border)}
.dpia-text-input,.dpia-textarea,.dpia-select{width:100%;padding:8px 11px;border:1px solid var(--color-border);border-radius:6px;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:#fff;outline:none;box-sizing:border-box}
.dpia-textarea{resize:vertical;line-height:1.6}
.dpia-text-input:focus,.dpia-textarea:focus,.dpia-select:focus{border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,#ccfbf1)}
.dpia-select{cursor:pointer}
.dpia-cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px}
.dpia-cb-wrap{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border:1px solid var(--color-border);border-radius:5px;font-size:13px;color:var(--color-text-primary);background:#fff;cursor:pointer;line-height:1.45}
.dpia-cb-wrap:hover{background:var(--color-bg-subtle,#f8fafc)}
.dpia-cb{margin-top:2px;flex-shrink:0;accent-color:var(--teal-600,#0d9488);width:14px;height:14px;cursor:pointer}
.dpia-warn{font-size:13px;color:var(--danger-600,#dc2626);padding:16px 0}

/* ---- Action row ---- */
.dpia-action-right{display:flex;gap:8px}
.dpia-progress-label{font-size:13px;font-weight:600;color:var(--color-text-secondary)}

/* ---- Results ---- */
.dpia-results{margin-top:16px}
.dpia-result-card{background:var(--success-50,#f0fdf4);border:1px solid var(--success-200,#bbf7d0);border-radius:8px;padding:20px}
.dpia-result-title{font-size:14px;font-weight:700;color:var(--success-700,#15803d);margin:0 0 14px}
.dpia-result-stats{display:flex;gap:28px;margin-bottom:14px;flex-wrap:wrap}
.dpia-stat{display:flex;flex-direction:column;gap:2px}
.dpia-stat-num{font-size:26px;font-weight:700;color:var(--success-700,#15803d);line-height:1}
.dpia-stat-lbl{font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
.dpia-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* ---- Reference pane ---- */
.dpia-ref-list{padding-left:20px;margin:0 0 16px}
.dpia-ref-item{font-size:13px;color:var(--color-text-secondary);line-height:1.65;padding:3px 0}
`;
    document.head.appendChild(s);
  }

  // ---- Utilities ----------------------------------------------
  function _el(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function _sectionLabel(text) {
    const p = _el('p', 'section-label'); p.textContent = text; return p;
  }

})();
