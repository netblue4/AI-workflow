/* Step 7 — Content Verification Testing
   Reads selected controls from record['step-6'].risk_controls[] and compliance_additions[].
   FK chain: selected risk control → tbl_Risk_Controls (fk_Risk_ID) + tbl_Test_Controls (fk_Risk_Control_ID).
   R→T naming convention: [X.Y.R1] control is evidenced by [X.Y.T1] test control.
   All test plans link to EU AI Act risks; controls without test controls appear in the uncovered section.
   Tester marks each test as: pending | completed | not_applicable.
   Saves to record['step-7'].
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _tblData = null, _record = null;
  let _planData  = [];  // [{plan_id, plan_ref, plan_name, objective, role, risk_name, test_controls:[], test_cases:[]}]
  let _uncovered = [];  // [{control_id, control_name, control_source}]

  const STATUS_OPTIONS = [
    { value: 'not_started',       label: 'Not started' },
    { value: 'in_progress',       label: 'In progress' },
    { value: 'evidence_provided', label: 'Evidence provided' },
    { value: 'waived',            label: 'Waived' }
  ];
  const STATUS_LEGACY_MAP = { pending: 'not_started', completed: 'evidence_provided', not_applicable: 'waived' };

  const _state = {
    testStatus: {}, // key = pk_Test_Control_ID → STATUS_OPTIONS values
    testNotes:  {}  // key = pk_Test_Control_ID → string
  };

  // ---- Public API ---------------------------------------------
  window.mountStep7Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _tblData    = null;
    _record     = null;
    _planData   = [];
    _uncovered  = [];
    _state.testStatus = {};

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
      const [rRes, rcRes, tcRes] = await Promise.all([
        fetch('tbl_Risks.json'),
        fetch('tbl_Risk_Controls.json'),
        fetch('tbl_Test_Controls.json')
      ]);
      if (!rRes.ok || !rcRes.ok || !tcRes.ok) throw new Error('fetch failed');
      const [risks, riskControls, testControls] = await Promise.all([
        rRes.json(), rcRes.json(), tcRes.json()
      ]);
      _tblData = { risks, riskControls, testControls };
    } catch (_) {
      pw.innerHTML = `<p style="padding:24px;color:#dc2626">Could not load data files (tbl_Risks.json, tbl_Risk_Controls.json, tbl_Test_Controls.json)</p>`;
      return;
    }

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

    // Build plan data from tbl_* files, filtered to step-6 selections
    const { plans, uncovered } = _buildPlanData();
    _planData  = plans;
    _uncovered = uncovered;

    // Restore prior test statuses and notes
    const saved10 = _record?.['step-7'];
    if (saved10?.plans) {
      saved10.plans.forEach(p => {
        (p.test_controls || []).forEach(tc => {
          if (tc.test_control_id) {
            const raw = tc.status || 'not_started';
            _state.testStatus[tc.test_control_id] = STATUS_LEGACY_MAP[raw] || raw;
            if (tc.notes) _state.testNotes[tc.test_control_id] = tc.notes;
          }
        });
      });
    } else {
      _planData.forEach(p => p.test_controls.forEach(tc => {
        _state.testStatus[tc.pk_Test_Control_ID] = 'not_started';
      }));
    }

    _renderPanes(pw);
  }

  // ---- Build plan data from tbl_* filtered to step-6 selections ----
  function _buildPlanData() {
    const step6 = _record?.['step-6'];
    if (!step6) return { plans: [], uncovered: [] };

    // Collect selected controls from flat risk_controls[] and compliance_additions[]
    const seen = new Set();
    const selectedControls = [];
    const push = c => {
      if (!seen.has(c.control_id)) {
        seen.add(c.control_id);
        selectedControls.push({ control_id: c.control_id, control_name: c.control_name, control_source: c.control_source || '' });
      }
    };
    (step6.risk_controls || []).forEach(c => { if (c.selected) push(c); });
    (step6.compliance_additions || []).forEach(c => push(c));

    if (!selectedControls.length) return { plans: [], uncovered: [] };

    // Build lookup maps
    const rcById   = new Map(_tblData.riskControls.map(rc => [rc.pk_Risk_Control_ID, rc]));
    const riskById = new Map(_tblData.risks.map(r => [r.pk_Risk_ID, r]));

    // Direct FK: fk_Risk_Control_ID → test control (R→T 1:1 convention)
    const tcByRC = new Map();
    _tblData.testControls.forEach(tc => {
      if (tc.fk_Risk_Control_ID) tcByRC.set(tc.fk_Risk_Control_ID, tc);
    });

    const riskMap   = new Map(); // risk_id → {risk_id, risk_name, test_controls:[]}
    const uncovered = [];

    const _ensureRisk = riskId => {
      if (!riskMap.has(riskId)) {
        const risk = riskById.get(riskId);
        riskMap.set(riskId, {
          risk_id:       riskId,
          risk_name:     risk?.risk_name || riskId,
          test_controls: []
        });
      }
      return riskMap.get(riskId);
    };

    selectedControls.forEach(sc => {
      const rc = rcById.get(sc.control_id);
      if (!rc) { uncovered.push(sc); return; }

      // Framework_Statement controls have no automated test — skip entirely
      if ((rc.control_source || '').includes('Framework')) return;

      const tc = tcByRC.get(sc.control_id);
      if (!tc) { uncovered.push(sc); return; }

      _ensureRisk(rc.fk_Risk_ID).test_controls.push(tc);
    });

    return { plans: Array.from(riskMap.values()).filter(r => r.test_controls.length > 0), uncovered };
  }

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    const strip = _el('div', 'wiz-tab-strip');
    [['wizard', 'Test Plan'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
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
    if (id === 'reference') {
      const refPane = _container.querySelector('[data-pane="reference"]');
      if (refPane) { refPane.innerHTML = ''; refPane.appendChild(_buildReferencePane()); }
    }
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const wz  = _el('div', 'wiz-pane');                    wz.dataset.pane  = 'wizard';
    const ref = _el('div', 'wiz-pane wiz-pane--hidden');   ref.dataset.pane = 'reference';
    wz.appendChild(_buildWizardPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(wz);
    pw.appendChild(ref);
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

    // Source card — step 9 summary
    card.appendChild(_sectionLabel('Input Source'));
    card.appendChild(_buildSourceCard());

    if (_planData.length === 0 && _uncovered.length === 0) {
      const warn = _el('div', 'wiz10-warn');
      warn.innerHTML = '<strong>No controls selected in Step 6.</strong> Complete the Control Identification (Step 6) and confirm at least one control before returning to this step.';
      card.appendChild(warn);
      return card;
    }

    card.appendChild(_sectionLabel('Test Plan'));

    const intro = _el('p', 'wiz10-intro');
    const totalTests = _planData.reduce((n, p) => n + p.test_controls.length, 0);
    intro.innerHTML = `Mark each test control as <strong>Evidence provided</strong>, <strong>Waived</strong>, or leave as <strong>Not started</strong>. ${totalTests} test control${totalTests !== 1 ? 's' : ''} identified across ${_planData.length} risk${_planData.length !== 1 ? 's' : ''}.`;
    card.appendChild(intro);

    // Validation banner
    card.appendChild(_buildValidationBanner());

    // Test plans
    if (_planData.length > 0) {
      const planList = _el('div', 'wiz10-plan-list');
      _planData.forEach((plan, idx) => planList.appendChild(_buildPlanCard(plan, idx)));
      card.appendChild(planList);
    }

    // Uncovered controls section
    if (_uncovered.length > 0) {
      card.appendChild(_buildUncoveredSection());
    }

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'wiz10-results'));
    return card;
  }

  // ---- Source card --------------------------------------------
  function _buildSourceCard() {
    const card = _el('div', 'wiz10-source-card');
    const step9 = _record?.['step-6'];
    if (!step9) {
      const w = _el('div', 'wiz10-info');
      w.innerHTML = '<strong>Step 6 (Control Identification) not yet completed.</strong> Complete and save Step 9 first.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz10-source-label');
    lbl.textContent = 'Step 6 — Control Identification'; card.appendChild(lbl);
    const grid = _el('div', 'wiz10-source-grid');
    const cell = (l, v, mod) => {
      const c = _el('div', 'wiz10-source-cell');
      const lEl = _el('span', 'wiz10-cell-label'); lEl.textContent = l; c.appendChild(lEl);
      const vEl = _el('span', mod ? `wiz10-cell-value wiz10-cell-value--${mod}` : 'wiz10-cell-value');
      vEl.textContent = v || '—'; c.appendChild(vEl); grid.appendChild(c);
    };
    cell('Risks assessed',       String(step9.total_risks      || 0));
    cell('Controls selected',    String(step9.selected_controls || 0), 'num');
    cell('Risks covered',         String(_planData.length),             'num');
    cell('Controls without tests', String(_uncovered.length),
         _uncovered.length > 0 ? 'warn' : 'ok');
    card.appendChild(grid); return card;
  }

  // ---- Validation banner --------------------------------------
  function _buildValidationBanner() {
    const wrap = _el('div', 'wiz10-val-wrap');
    wrap.id = 'wiz10-val-banner';
    _updateValidationBanner(wrap);
    return wrap;
  }

  function _updateValidationBanner(wrap) {
    const el = wrap || _container.querySelector('#wiz10-val-banner');
    if (!el) return;
    const allTests = _planData.reduce((a, p) => a.concat(p.test_controls), []);
    const evidenced = allTests.filter(t => _state.testStatus[t.pk_Test_Control_ID] === 'evidence_provided').length;
    const waived    = allTests.filter(t => _state.testStatus[t.pk_Test_Control_ID] === 'waived').length;
    const pending   = allTests.length - evidenced - waived;
    el.innerHTML = '';
    if (pending === 0 && allTests.length > 0) {
      const ok = _el('div', 'wiz10-val-ok');
      ok.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All ${allTests.length} test controls reviewed — ${evidenced} evidence provided, ${waived} waived.`;
      el.appendChild(ok);
    } else {
      const info = _el('div', 'wiz10-val-info');
      const pct = allTests.length ? Math.round(((evidenced + waived) / allTests.length) * 100) : 0;
      info.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <strong>${pending} test${pending !== 1 ? 's' : ''} not yet evidenced</strong> — ${evidenced} evidence provided, ${waived} waived (${pct}% reviewed).`;
      el.appendChild(info);
    }
  }

  // ---- Plan card ----------------------------------------------
  function _buildPlanCard(plan, idx) {
    const sec = _el('div', 'wiz10-plan-sec');
    sec.dataset.planId = plan.plan_id;

    const hdr = _el('div', 'wiz10-plan-hdr');

    const left = _el('div', 'wiz10-plan-hdr-left');

    const idBadge = _el('span', 'wiz10-plan-id-badge');
    idBadge.textContent = plan.risk_id;
    left.appendChild(idBadge);

    const riskName = _el('span', 'wiz10-plan-name');
    riskName.textContent = plan.risk_name;
    left.appendChild(riskName);

    const countBadge = _el('span', 'wiz10-plan-count');
    countBadge.id = `wiz10-plan-count-${idx}`;
    _updatePlanCount(plan, countBadge);
    left.appendChild(countBadge);

    hdr.appendChild(left);

    const chevron = _el('span', 'wiz10-plan-chevron');
    chevron.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)';
    hdr.appendChild(chevron);

    sec.appendChild(hdr);

    const ctrlList = _el('div', 'wiz10-ctrl-list');
    ctrlList.classList.add('wiz10-collapsed');
    plan.test_controls.forEach(tc => ctrlList.appendChild(_buildTestControlCard(tc, plan, idx)));
    sec.appendChild(ctrlList);

    hdr.addEventListener('click', () => {
      const isCollapsed = ctrlList.classList.toggle('wiz10-collapsed');
      chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
    });

    return sec;
  }

  function _updatePlanCount(plan, el) {
    const total = plan.test_controls.length;
    const done  = plan.test_controls.filter(t =>
      _state.testStatus[t.pk_Test_Control_ID] === 'evidence_provided' ||
      _state.testStatus[t.pk_Test_Control_ID] === 'waived'
    ).length;
    el.textContent = `${done} / ${total} reviewed`;
    el.className   = done === total
      ? 'wiz10-plan-count wiz10-plan-count--ok'
      : 'wiz10-plan-count wiz10-plan-count--pending';
  }

  // ---- Test control card (minimal) ----------------------------
  function _buildTestControlCard(tc, plan, planIdx) {
    const status = _state.testStatus[tc.pk_Test_Control_ID] || 'not_started';
    const card = _el('div', 's7-ctrl-card');
    card.dataset.tcId = tc.pk_Test_Control_ID;

    // Header: source badge + name
    const hdr = _el('div', 's7-ctrl-hdr');
    const srcBadge = _el('span', tc._isFramework ? 's7-src-badge s7-src-badge--fs' : 's7-src-badge');
    srcBadge.textContent = tc._isFramework ? 'Self-certified' : 'EU AI Act';
    hdr.appendChild(srcBadge);
    const name = _el('span', 's7-ctrl-name');
    name.textContent = tc.jkName;
    hdr.appendChild(name);
    card.appendChild(hdr);

    // Objective (plain text)
    if (tc.jkObjective) {
      const obj = _el('p', 's7-ctrl-obj');
      obj.textContent = tc.jkObjective;
      card.appendChild(obj);
    }

    // Evidence / notes textarea — Framework controls pre-fill from their
    // documented implementation evidence; the assessor can update it.
    const notesWrap = _el('div', 's7-ctrl-notes-wrap');
    const notesLbl = _el('label', 's7-ctrl-notes-lbl');
    notesLbl.textContent = 'Evidence / Notes';
    notesWrap.appendChild(notesLbl);
    const textarea = document.createElement('textarea');
    textarea.className = 's7-ctrl-notes';
    textarea.placeholder = 'Add evidence link or notes…';
    textarea.rows = 2;
    if (_state.testNotes[tc.pk_Test_Control_ID] === undefined && tc._isFramework && tc.jkImplementationEvidence) {
      _state.testNotes[tc.pk_Test_Control_ID] = tc.jkImplementationEvidence;
    }
    textarea.value = _state.testNotes[tc.pk_Test_Control_ID] || '';
    textarea.addEventListener('input', () => {
      _state.testNotes[tc.pk_Test_Control_ID] = textarea.value;
      if (textarea.value && _state.testStatus[tc.pk_Test_Control_ID] === 'not_started') {
        _state.testStatus[tc.pk_Test_Control_ID] = 'in_progress';
        _syncCardStatus(card, 'in_progress', plan, planIdx);
      }
    });
    notesWrap.appendChild(textarea);
    card.appendChild(notesWrap);

    // Status row: label + dropdown + pill
    const statusRow = _el('div', 's7-ctrl-status-row');
    const statusLbl = _el('span', 's7-ctrl-status-lbl');
    statusLbl.textContent = 'Status';
    statusRow.appendChild(statusLbl);

    const sel = document.createElement('select');
    sel.className = 's7-ctrl-status-sel';
    STATUS_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === status) o.selected = true;
      sel.appendChild(o);
    });

    const pill = _el('span', `s7-ctrl-pill s7-ctrl-pill--${status}`);
    pill.textContent = STATUS_OPTIONS.find(o => o.value === status)?.label || status;

    sel.addEventListener('change', () => {
      const newStatus = sel.value;
      _state.testStatus[tc.pk_Test_Control_ID] = newStatus;
      _syncCardStatus(card, newStatus, plan, planIdx);
    });

    statusRow.appendChild(sel);
    statusRow.appendChild(pill);
    card.appendChild(statusRow);

    return card;
  }

  function _syncCardStatus(card, status, plan, planIdx) {
    const pill = card.querySelector('.s7-ctrl-pill');
    if (pill) {
      pill.className = `s7-ctrl-pill s7-ctrl-pill--${status}`;
      pill.textContent = STATUS_OPTIONS.find(o => o.value === status)?.label || status;
    }
    const sel = card.querySelector('.s7-ctrl-status-sel');
    if (sel) sel.value = status;
    const countEl = _container.querySelector(`#wiz10-plan-count-${planIdx}`);
    if (countEl) _updatePlanCount(plan, countEl);
    _updateValidationBanner();
  }

  // ---- Collapsible section ------------------------------------
  function _buildCollapsible(label, content, cls) {
    const wrap = _el('div', 'wiz10-collapsible');
    const btn = document.createElement('button');
    btn.className = 'wiz10-coll-btn';
    btn.innerHTML = `<svg class="wiz10-coll-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>${label}`;
    const body = _el('div', `wiz10-coll-body ${cls}`);
    body.hidden = true;
    const text = _el('p', 'wiz10-coll-text'); text.textContent = content; body.appendChild(text);
    btn.addEventListener('click', () => {
      body.hidden = !body.hidden;
      btn.querySelector('.wiz10-coll-chevron').style.transform =
        body.hidden ? '' : 'rotate(180deg)';
    });
    wrap.appendChild(btn); wrap.appendChild(body);
    return wrap;
  }

  // ---- Test cases section ------------------------------------
  function _buildTestCasesSection(plan) {
    const wrap = _el('div', 'wiz10-collapsible wiz10-dataset-wrap');
    const btn  = document.createElement('button');
    btn.className = 'wiz10-coll-btn wiz10-dataset-btn';
    btn.innerHTML = `<svg class="wiz10-coll-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>Test Cases (${plan.test_cases.length})`;
    const body = _el('div', 'wiz10-coll-body');
    body.hidden = true;

    const table = _el('div', 'wiz10-dataset-table');
    plan.test_cases.forEach(tc => {
      const row = _el('div', 'wiz10-dataset-row');
      const idCell = _el('span', 'wiz10-dataset-id'); idCell.textContent = tc.test_case_id || ''; row.appendChild(idCell);
      const main = _el('div', 'wiz10-dataset-main');
      const q = _el('p', 'wiz10-dataset-query'); q.textContent = tc.query || ''; main.appendChild(q);
      const eo = _el('p', 'wiz10-dataset-outcome');
      eo.innerHTML = `<strong>Expected:</strong> ${tc.expected_outcome || ''}`;
      main.appendChild(eo);
      if (tc.rationale_summary) {
        const rs = _el('p', 'wiz10-dataset-rationale'); rs.textContent = tc.rationale_summary; main.appendChild(rs);
      }
      row.appendChild(main);
      table.appendChild(row);
    });

    body.appendChild(table);
    btn.addEventListener('click', () => {
      body.hidden = !body.hidden;
      btn.querySelector('.wiz10-coll-chevron').style.transform =
        body.hidden ? '' : 'rotate(180deg)';
    });
    wrap.appendChild(btn); wrap.appendChild(body);
    return wrap;
  }

  // ---- Status selector ----------------------------------------
  function _buildStatusSelector(tc, plan, planIdx) {
    const row = _el('div', 'wiz10-status-row');
    const lbl = _el('span', 'wiz10-status-label'); lbl.textContent = 'Status:'; row.appendChild(lbl);

    const options = [
      { value: 'pending',        label: 'Pending',        cls: 'wiz10-status-btn--pending' },
      { value: 'completed',      label: 'Completed',      cls: 'wiz10-status-btn--completed' },
      { value: 'not_applicable', label: 'Not Applicable', cls: 'wiz10-status-btn--na' }
    ];

    options.forEach(opt => {
      const btn = document.createElement('button');
      const current = _state.testStatus[tc.pk_Test_Control_ID] || 'pending';
      btn.className = `wiz10-status-btn ${opt.cls}${current === opt.value ? ' wiz10-status-btn--active' : ''}`;
      btn.textContent = opt.label;
      btn.dataset.statusValue = opt.value;
      btn.addEventListener('click', () => {
        _state.testStatus[tc.pk_Test_Control_ID] = opt.value;

        // Update all status buttons in this card
        const card = btn.closest('.wiz10-tc-card');
        if (card) {
          card.className = `wiz10-tc-card wiz10-tc-card--${opt.value}`;
          card.querySelectorAll('.wiz10-status-btn').forEach(b => {
            b.classList.toggle('wiz10-status-btn--active', b.dataset.statusValue === opt.value);
          });
          const pip = card.querySelector('.wiz10-tc-pip');
          if (pip) pip.className = `wiz10-tc-pip wiz10-tc-pip--${opt.value}`;
        }

        // Update plan count badge
        const countEl = _container.querySelector(`#wiz10-plan-count-${planIdx}`);
        if (countEl) _updatePlanCount(plan, countEl);

        // Update validation banner
        _updateValidationBanner();
      });
      row.appendChild(btn);
    });

    return row;
  }

  // ---- Uncovered controls section -----------------------------
  function _buildUncoveredSection() {
    const sec = _el('div', 'wiz10-uncovered-sec');
    const hdr = _el('div', 'wiz10-uncovered-hdr');
    const icon = _el('span', 'wiz10-unc-icon');
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    hdr.appendChild(icon);
    const hdrText = _el('span', 'wiz10-unc-title');
    hdrText.textContent = `${_uncovered.length} selected control${_uncovered.length !== 1 ? 's' : ''} without automated test coverage`;
    hdr.appendChild(hdrText);
    sec.appendChild(hdr);

    const note = _el('p', 'wiz10-unc-note');
    note.textContent = 'The following controls do not have a corresponding test plan. Manual evidence review is required.';
    sec.appendChild(note);

    const list = _el('div', 'wiz10-unc-list');
    _uncovered.forEach(rc => {
      const item = _el('div', 'wiz10-unc-item');
      // Source badge
      const srcBadge = _el('span', 'wiz9-src-badge wiz9-src-badge--eu');
      srcBadge.textContent = 'EU AI Act';
      item.appendChild(srcBadge);
      const nm = _el('span', 'wiz10-unc-ctrl-name'); nm.textContent = rc.control_name; item.appendChild(nm);
      list.appendChild(item);
    });
    sec.appendChild(list);
    return sec;
  }

  // ---- Action row ---------------------------------------------
  function _buildActionRow() {
    const row = _el('div', 'wiz-action-row');
    const btn = document.createElement('button');
    btn.className = 'wiz-btn-primary';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Test Status`;
    btn.addEventListener('click', _handleSave);
    row.appendChild(btn);
    return row;
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    const rec10 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-7'] = rec10;
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 10 saved ✓');
    _renderResults(rec10);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};

    const plans = _planData.map(p => ({
      plan_ref:  p.risk_id,
      plan_name: p.risk_name,
      risk_name: p.risk_name,
      test_controls: p.test_controls.map(tc => ({
        test_control_id:            tc.pk_Test_Control_ID,
        control_ref:                tc.control_ref || '',
        control_name:               tc.jkName      || '',
        fk_Harmonised_Standard_IDs: tc.fk_Harmonised_Standard_IDs || '',
        notes:                      _state.testNotes[tc.pk_Test_Control_ID]  || '',
        status:                     _state.testStatus[tc.pk_Test_Control_ID] || 'not_started'
      }))
    }));

    const allTests  = plans.reduce((a, p) => a.concat(p.test_controls), []);
    const evidenced = allTests.filter(t => t.status === 'evidence_provided').length;
    const waived    = allTests.filter(t => t.status === 'waived').length;
    const pending   = allTests.length - evidenced - waived;

    return {
      step_id:                'step-7',
      step_title:             'Control Verification Testing',
      assessment_date:        today,
      assessed_by:            meta.assessed_by || '',
      use_case_id:            meta.use_case_id || '',
      total_tests:            allTests.length,
      evidence_provided_tests: evidenced,
      waived_tests:           waived,
      pending_tests:          pending,
      plans,
      uncovered_controls: _uncovered.map(rc => ({
        control_id:     rc.control_id,
        control_name:   rc.control_name,
        control_source: rc.control_source
      }))
    };
  }

  function _renderResults(rec10) {
    const area = _container.querySelector('.wiz10-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'wiz10-result-card');
    const h = _el('h3', 'wiz10-result-title'); h.textContent = 'Test Status Saved'; card.appendChild(h);
    const stats = _el('div', 'wiz10-result-stats');
    [
      [rec10.total_tests,             'Total tests'],
      [rec10.evidence_provided_tests, 'Evidence provided'],
      [rec10.waived_tests,            'Waived'],
      [rec10.pending_tests,           'Pending']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num); s.appendChild(n);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl; s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);
    const note = _el('p', 'wiz10-result-note');
    note.innerHTML = `Test status saved. <strong>${rec10.evidence_provided_tests} test${rec10.evidence_provided_tests !== 1 ? 's' : ''} with evidence provided</strong>, ${rec10.waived_tests} waived, ${rec10.pending_tests} still pending.`;
    card.appendChild(note);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane -----------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');
    const title = _el('h2', 'step-detail-title');
    title.textContent = 'Test Control Reference'; card.appendChild(title);

    if (_planData.length === 0 && _uncovered.length === 0) {
      const p = _el('p', 'wiz10-intro'); p.textContent = 'No controls selected in Step 6.'; card.appendChild(p);
      return card;
    }

    // Summary
    const allTests  = _planData.reduce((a, p) => a.concat(p.test_controls), []);
    const evidenced = allTests.filter(t => _state.testStatus[t.pk_Test_Control_ID] === 'evidence_provided').length;
    const waived    = allTests.filter(t => _state.testStatus[t.pk_Test_Control_ID] === 'waived').length;
    const pending   = allTests.length - evidenced - waived;

    const summary = _el('div', 'wiz10-ref-summary');
    const badge = _el('span', pending === 0
      ? 'wiz9-ref-sum-badge wiz9-ref-sum-badge--ok'
      : 'wiz9-ref-sum-badge wiz9-ref-sum-badge--warn');
    badge.textContent = `${evidenced + waived} / ${allTests.length} tests reviewed`;
    summary.appendChild(badge);
    if (_uncovered.length > 0) {
      const unc = _el('span', 'wiz9-ref-uncovered');
      unc.textContent = `${_uncovered.length} control${_uncovered.length !== 1 ? 's' : ''} without automated test`;
      summary.appendChild(unc);
    }
    card.appendChild(summary);

    const hint = _el('p', 'wiz9-ref-hint');
    hint.textContent = 'This view shows all test controls matched to your selected Step 9 controls, grouped by test plan. Status reflects your current selections.';
    card.appendChild(hint);

    // Plans
    _planData.forEach(plan => {
      const planSec = _el('div', 'wiz10-ref-plan-sec');

      const ph = _el('div', 'wiz10-ref-plan-hdr');
      const pref = _el('span', 'wiz10-cn-badge'); pref.textContent = plan.risk_id; ph.appendChild(pref);
      const pn  = _el('span', 'wiz10-ref-plan-name');
      pn.textContent = plan.risk_name;
      ph.appendChild(pn);
      const reviewed = plan.test_controls.filter(t =>
        _state.testStatus[t.pk_Test_Control_ID] === 'evidence_provided' ||
        _state.testStatus[t.pk_Test_Control_ID] === 'waived'
      ).length;
      const rb = _el('span', reviewed === plan.test_controls.length
        ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--all'
        : reviewed > 0
          ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--partial'
          : 'wiz9-risk-sel-badge wiz9-risk-sel-badge--none');
      rb.textContent = `${reviewed} / ${plan.test_controls.length}`;
      ph.appendChild(rb);
      planSec.appendChild(ph);

      if (plan.risk_name) {
        const rs = _el('p', 'wiz10-ref-risk-sub');
        rs.innerHTML = `<span class="wiz10-risk-label">EU AI Act risk:</span> ${plan.risk_name}`;
        planSec.appendChild(rs);
      }

      plan.test_controls.forEach(tc => {
        const status  = _state.testStatus[tc.pk_Test_Control_ID] || 'not_started';
        const tc_card = _el('div', `wiz10-ref-tc wiz10-ref-tc--${status}`);
        const tch     = _el('div', 'wiz10-ref-tc-hdr');

        const statusDot = _el('span', `wiz10-ref-status-dot wiz10-ref-status-dot--${status}`);
        tch.appendChild(statusDot);

        const tcName = _el('span', 'wiz10-ref-tc-name'); tcName.textContent = tc.jkName; tch.appendChild(tcName);
        if (tc.control_ref) {
          const cnb = _el('span', 'wiz10-cn-badge'); cnb.textContent = tc.control_ref; tch.appendChild(cnb);
        }
        if (tc.fk_Harmonised_Standard_IDs) {
          const sref = _el('span', 'wiz10-std-badge'); sref.textContent = tc.fk_Harmonised_Standard_IDs; tch.appendChild(sref);
        }
        tc_card.appendChild(tch);

        if (tc.jkObjective) {
          const obj = _el('p', 'wiz10-ref-tc-obj'); obj.textContent = tc.jkObjective; tc_card.appendChild(obj);
        }

        planSec.appendChild(tc_card);
      });

      card.appendChild(planSec);
    });

    // Uncovered
    if (_uncovered.length > 0) {
      const uncSec = _el('div', 'wiz10-ref-plan-sec');
      const uh = _el('div', 'wiz10-ref-plan-hdr');
      const un = _el('span', 'wiz10-ref-plan-name'); un.textContent = 'Controls without automated test coverage'; uh.appendChild(un);
      const rb = _el('span', 'wiz9-risk-sel-badge wiz9-risk-sel-badge--none');
      rb.textContent = `${_uncovered.length} control${_uncovered.length !== 1 ? 's' : ''}`; uh.appendChild(rb);
      uncSec.appendChild(uh);
      _uncovered.forEach(rc => {
        const item = _el('div', 'wiz10-ref-tc wiz10-ref-tc--pending');
        const srcBadge = _el('span', 'wiz9-src-badge wiz9-src-badge--eu');
        srcBadge.textContent = 'EU AI Act';
        item.appendChild(srcBadge);
        const nm = _el('span', 'wiz10-ref-tc-name'); nm.textContent = rc.control_name; item.appendChild(nm);
        uncSec.appendChild(item);
      });
      card.appendChild(uncSec);
    }

    return card;
  }

  // ---- Helpers ------------------------------------------------
  function _el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function _sectionLabel(text) {
    const p = _el('p', 'section-label'); p.textContent = text; return p;
  }

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    // Inject shared wiz-* base classes if not already present
    if (!document.getElementById('wiz-shared-styles')) {
      const s = document.createElement('style');
      s.id = 'wiz-shared-styles';
      s.textContent = `
.wiz-shell{display:flex;flex-direction:column;height:100%}
.wiz-tab-strip{display:flex;gap:2px;padding:14px 24px 0;border-bottom:1px solid var(--color-border);background:var(--color-surface)}
.wiz-tab{padding:8px 16px;font-size:12px;font-weight:500;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--color-text-secondary);font-family:inherit;transition:color .15s,border-color .15s;white-space:nowrap}
.wiz-tab:hover{color:var(--color-text-primary)}
.wiz-tab--active{color:var(--teal-600,#0d9488);border-bottom-color:var(--teal-600,#0d9488)}
.wiz-pane-wrap{flex:1;overflow-y:auto}
.wiz-pane{padding:24px;min-height:100%}
.wiz-pane--hidden{display:none}
.wiz-action-row{display:flex;gap:10px;margin-top:24px}
.wiz-btn-primary{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:var(--teal-600,#0d9488);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s}
.wiz-btn-primary:hover{background:var(--teal-700,#0f766e)}
`;
      document.head.appendChild(s);
    }

    if (document.getElementById('wiz10-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz10-styles';
    s.textContent = `
/* ---- Step 7 minimal control card styles -------------------- */
.s7-src-badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:#dbeafe;color:#1e40af;white-space:nowrap;flex-shrink:0}
.s7-src-badge--fs{background:#ede9fe;color:#7c3aed}
.s7-ctrl-card{padding:14px 16px;border-bottom:1px solid var(--color-border)}
.s7-ctrl-card:last-child{border-bottom:none}
.s7-ctrl-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.s7-ctrl-name{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.s7-ctrl-obj{font-size:12px;color:var(--color-text-secondary);line-height:1.5;margin:0 0 10px}
.s7-ctrl-notes-wrap{margin-bottom:10px}
.s7-ctrl-notes-lbl{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin-bottom:4px}
.s7-ctrl-notes{width:100%;box-sizing:border-box;padding:8px 10px;font-size:12px;font-family:inherit;border:1px solid var(--color-border);border-radius:6px;resize:vertical;color:var(--color-text-primary);background:var(--color-bg,#fff);line-height:1.5}
.s7-ctrl-notes:focus{outline:none;border-color:var(--teal-500,#14b8a6);box-shadow:0 0 0 2px rgba(20,184,166,.15)}
.s7-ctrl-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.s7-ctrl-status-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary)}
.s7-ctrl-status-sel{padding:4px 8px;font-size:12px;font-family:inherit;border:1px solid var(--color-border);border-radius:5px;background:var(--color-bg,#fff);color:var(--color-text-primary);cursor:pointer}
.s7-ctrl-status-sel:focus{outline:none;border-color:var(--teal-500,#14b8a6)}
.s7-ctrl-pill{font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap}
.s7-ctrl-pill--not_started{background:#f1f5f9;color:#475569}
.s7-ctrl-pill--in_progress{background:#fef3c7;color:#92400e}
.s7-ctrl-pill--evidence_provided{background:#dcfce7;color:#166534}
.s7-ctrl-pill--waived{background:#ede9fe;color:#6d28d9}

/* ---- Step 10 styles ---------------------------------------- */
.wiz10-intro{font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;line-height:1.6}
.wiz10-warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px;font-size:13px;color:#9a3412;margin-bottom:16px}
.wiz10-info{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;font-size:12px;color:#1e40af;margin-bottom:8px}

/* Source card */
.wiz10-source-card{background:var(--color-bg-subtle,#f8fafc);border:1px solid var(--color-border);border-radius:8px;padding:14px 16px;margin-bottom:20px}
.wiz10-source-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-tertiary);margin:0 0 10px}
.wiz10-source-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.wiz10-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz10-cell-label{font-size:10px;color:var(--color-text-tertiary);font-weight:500;text-transform:uppercase;letter-spacing:.04em}
.wiz10-cell-value{font-size:18px;font-weight:700;color:var(--color-text-primary)}
.wiz10-cell-value--num{color:var(--teal-600,#0d9488)}
.wiz10-cell-value--warn{color:#d97706}
.wiz10-cell-value--ok{color:#16a34a}

/* Validation banner */
.wiz10-val-wrap{margin-bottom:16px}
.wiz10-val-ok{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#dcfce7;border:1px solid #bbf7d0;border-radius:6px;font-size:12px;color:#166534;font-weight:500}
.wiz10-val-info{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:12px;color:#1e40af}

/* Plan list */
.wiz10-plan-list{display:flex;flex-direction:column;gap:16px;margin-bottom:20px}
.wiz10-plan-sec{background:var(--color-bg,#fff);border:1px solid var(--color-border);border-radius:10px;overflow:hidden}
.wiz10-plan-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);border-bottom:1px solid var(--color-border);cursor:pointer;user-select:none}
.wiz10-plan-hdr:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz10-plan-hdr-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.wiz10-plan-id-badge{font-size:10px;font-weight:700;background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0}
.wiz10-plan-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz10-collapsed{display:none!important}
.wiz10-plan-icon{display:flex;align-items:center;color:var(--teal-600,#0d9488);flex-shrink:0}
.wiz10-plan-name{font-size:13px;font-weight:600;color:var(--color-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiz10-plan-risk-sub{font-size:11px;color:var(--color-text-tertiary);padding:6px 16px;margin:0;border-bottom:1px solid var(--color-border);background:var(--color-bg-subtle,#f8fafc)}
.wiz10-risk-label{font-weight:600;color:var(--color-text-secondary)}
.wiz10-role-badge{font-size:10px;font-weight:500;padding:2px 7px;background:#ccfbf1;color:#115e59;border-radius:4px;white-space:nowrap;flex-shrink:0}
.wiz10-plan-count{font-size:11px;font-weight:600;padding:3px 10px;border-radius:12px;white-space:nowrap;flex-shrink:0}
.wiz10-plan-count--pending{background:#dbeafe;color:#1e40af}
.wiz10-plan-count--ok{background:#dcfce7;color:#166534}
.wiz10-plan-obj{font-size:12px;color:var(--color-text-secondary);padding:10px 16px 8px;line-height:1.5;border-bottom:1px solid var(--color-border);margin:0}

/* Test control card */
.wiz10-ctrl-list{display:flex;flex-direction:column;gap:1px;padding:0}
.wiz10-tc-card{padding:14px 16px;border-bottom:1px solid var(--color-border);transition:background .15s}
.wiz10-tc-card:last-child{border-bottom:none}
.wiz10-tc-card--pending{background:#fff}
.wiz10-tc-card--completed{background:#f0fdf4}
.wiz10-tc-card--not_applicable{background:#fffbeb}
.wiz10-tc-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.wiz10-tc-pip{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
.wiz10-tc-pip--pending{background:#94a3b8}
.wiz10-tc-pip--completed{background:#22c55e}
.wiz10-tc-pip--not_applicable{background:#f59e0b}
.wiz10-tc-icon{display:flex;align-items:center;color:var(--color-text-tertiary);flex-shrink:0}
.wiz10-tc-name{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz10-cn-badge{font-size:10px;font-weight:600;padding:2px 6px;background:#e0e7ff;color:#4338ca;border-radius:4px;font-family:var(--font-mono,monospace);white-space:nowrap}
.wiz10-std-badge{font-size:10px;font-weight:500;padding:2px 6px;background:#f1f5f9;color:#475569;border-radius:4px;white-space:nowrap;word-break:break-all}

/* Collapsible */
.wiz10-collapsible{margin-bottom:8px}
.wiz10-coll-btn{display:inline-flex;align-items:center;gap:5px;background:transparent;border:none;padding:4px 0;font-size:11px;font-weight:600;color:var(--color-text-secondary);cursor:pointer;font-family:inherit;text-transform:uppercase;letter-spacing:.04em}
.wiz10-coll-btn:hover{color:var(--color-text-primary)}
.wiz10-coll-chevron{transition:transform .2s;flex-shrink:0}
.wiz10-coll-body{margin-top:4px}
.wiz10-coll-text{font-size:12px;color:var(--color-text-secondary);line-height:1.6;padding:8px 12px;background:var(--color-bg-subtle,#f8fafc);border-radius:4px;border-left:2px solid var(--color-border);margin:0}
.wiz10-tc-obj .wiz10-coll-text{border-left-color:#a7f3d0}
.wiz10-tc-text .wiz10-coll-text{border-left-color:#93c5fd}
.wiz10-tc-evidence .wiz10-coll-text{border-left-color:#fcd34d;font-family:var(--font-mono,monospace);font-size:11px;white-space:pre-wrap}

/* Dataset / test cases */
.wiz10-dataset-wrap{border-top:1px solid var(--color-border);padding:10px 16px}
.wiz10-dataset-btn{font-size:11px}
.wiz10-dataset-table{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.wiz10-dataset-row{display:flex;gap:12px;padding:10px;background:var(--color-bg,#fff);border:1px solid var(--color-border);border-radius:6px}
.wiz10-dataset-id{font-family:var(--font-mono,monospace);font-size:10px;font-weight:700;color:#4338ca;min-width:60px;flex-shrink:0;padding-top:2px}
.wiz10-dataset-main{flex:1;min-width:0}
.wiz10-dataset-query{font-size:12px;color:var(--color-text-primary);margin:0 0 6px;line-height:1.4}
.wiz10-dataset-outcome{font-size:11px;color:var(--color-text-secondary);margin:0 0 4px}
.wiz10-dataset-rationale{font-size:11px;color:var(--color-text-tertiary);margin:0;font-style:italic}

/* Status selector */
.wiz10-status-row{display:flex;align-items:center;gap:6px;margin-top:10px;flex-wrap:wrap}
.wiz10-status-label{font-size:11px;font-weight:600;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-right:2px}
.wiz10-status-btn{padding:5px 12px;font-size:11px;font-weight:600;border-radius:5px;cursor:pointer;font-family:inherit;transition:all .15s;border:1px solid transparent}
.wiz10-status-btn--pending{background:var(--color-bg-subtle,#f8fafc);border-color:var(--color-border);color:var(--color-text-secondary)}
.wiz10-status-btn--completed{background:#f0fdf4;border-color:#bbf7d0;color:#166534}
.wiz10-status-btn--na{background:#fffbeb;border-color:#fde68a;color:#92400e}
.wiz10-status-btn--active.wiz10-status-btn--pending{background:#e2e8f0;border-color:#94a3b8;color:#334155;font-weight:700}
.wiz10-status-btn--active.wiz10-status-btn--completed{background:#22c55e;border-color:#16a34a;color:#fff;font-weight:700}
.wiz10-status-btn--active.wiz10-status-btn--na{background:#f59e0b;border-color:#d97706;color:#fff;font-weight:700}

/* Uncovered section */
.wiz10-uncovered-sec{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin-bottom:20px}
.wiz10-uncovered-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.wiz10-unc-icon{color:#d97706;display:flex;align-items:center}
.wiz10-unc-title{font-size:13px;font-weight:600;color:#92400e}
.wiz10-unc-note{font-size:12px;color:#b45309;margin:0 0 12px;line-height:1.5}
.wiz10-unc-list{display:flex;flex-direction:column;gap:6px}
.wiz10-unc-item{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff;border:1px solid #fed7aa;border-radius:6px;flex-wrap:wrap}
.wiz10-unc-ctrl-name{font-size:12px;font-weight:500;color:var(--color-text-primary)}
.wiz10-unc-risk{font-size:11px;color:var(--color-text-tertiary)}

/* Result card */
.wiz10-results{margin-top:24px}
.wiz10-result-card{background:var(--color-bg-subtle,#f8fafc);border:1px solid var(--color-border);border-radius:10px;padding:20px 24px}
.wiz10-result-title{font-size:15px;font-weight:700;color:var(--color-text-primary);margin:0 0 16px}
.wiz10-result-stats{display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap}
.wiz10-result-note{font-size:12px;color:var(--color-text-secondary);margin:0;line-height:1.6}

/* Reference pane */
.wiz10-ref-plan-sec{margin-bottom:20px}
.wiz10-ref-plan-hdr{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.wiz10-ref-plan-name{font-size:13px;font-weight:600;color:var(--color-text-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiz10-ref-risk-sub{font-size:11px;color:var(--color-text-tertiary);margin:0 0 8px;font-style:italic}
.wiz10-ref-tc{padding:10px 12px;border:1px solid var(--color-border);border-radius:6px;margin-bottom:6px}
.wiz10-ref-tc--completed,.wiz10-ref-tc--evidence_provided{border-left:3px solid #22c55e}
.wiz10-ref-tc--not_applicable,.wiz10-ref-tc--waived{border-left:3px solid #a78bfa}
.wiz10-ref-tc--pending,.wiz10-ref-tc--not_started{border-left:3px solid #94a3b8}
.wiz10-ref-tc--in_progress{border-left:3px solid #f59e0b}
.wiz10-ref-tc-hdr{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.wiz10-ref-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.wiz10-ref-status-dot--not_started,.wiz10-ref-status-dot--pending{background:#94a3b8}
.wiz10-ref-status-dot--in_progress{background:#f59e0b}
.wiz10-ref-status-dot--evidence_provided,.wiz10-ref-status-dot--completed{background:#22c55e}
.wiz10-ref-status-dot--waived,.wiz10-ref-status-dot--not_applicable{background:#a78bfa}
.wiz10-ref-tc-name{font-size:12px;font-weight:600;color:var(--color-text-primary)}
.wiz10-ref-tc-obj{font-size:11px;color:var(--color-text-tertiary);margin:4px 0 0;line-height:1.5}
.wiz10-ref-summary{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
`;
    document.head.appendChild(s);
  }

})();
