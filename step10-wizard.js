/* Step 10 — Content Verification Testing
   Reads selected controls from record['step-9'].
   For each selected control, finds the matching test control via control_number prefix linking:
     [X.Y.Rn] (risk control) ↔ [X.Y.Tn] (test control) — shared numeric prefix X.Y + index n.
   Groups test controls under their parent test plan.
   Tester marks each test as: pending | completed | not_applicable.
   Saves to record['step-10'].
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _framework = null, _record = null;
  let _planData  = [];  // [{plan_id, objective, role, dataset, test_controls:[...]}]
  let _uncovered = [];  // [{risk_name, ctrl_name, cn, rcn}] — no matching test control

  const _state = {
    testStatus: {} // key = control_number e.g. "[2.6.T1]" → "pending"|"completed"|"not_applicable"
  };

  // ---- Public API ---------------------------------------------
  window.mountStep10Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _framework  = null;
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

    // Build plan data from framework, filtered to step-9 selections
    const { plans, uncovered } = _buildPlanData();
    _planData  = plans;
    _uncovered = uncovered;

    // Restore prior test statuses
    const saved10 = _record?.['step-10'];
    if (saved10?.plans) {
      saved10.plans.forEach(p => {
        (p.test_controls || []).forEach(tc => {
          if (tc.status && tc.control_number) {
            _state.testStatus[tc.control_number] = tc.status;
          }
        });
      });
    } else {
      // Default: all pending
      _planData.forEach(p => p.test_controls.forEach(tc => {
        _state.testStatus[tc.cn] = 'pending';
      }));
    }

    _renderPanes(pw);
  }

  // ---- Build plan data from framework -------------------------
  function _buildPlanData() {
    // 1. Collect step-9 selected controls
    const step9 = _record?.['step-9'];
    const selectedRCtrls = []; // [{risk_name, ctrl_name, cn, rcn}]

    if (step9?.risks) {
      step9.risks.forEach(r => {
        (r.controls || []).forEach(c => {
          if (c.selected && c.control_number) {
            selectedRCtrls.push({
              risk_name: r.risk_name,
              ctrl_name: c.control_name,
              cn:        c.control_number,
              rcn:       c.rcn || ''
            });
          }
        });
      });
    }

    if (!selectedRCtrls.length) return { plans: [], uncovered: [] };

    // 2. Build index of selected risk controls: normalizedKey → info
    // [X.Y.Rn] → key: "X.Y|n"
    const selectedIndex = new Map();
    selectedRCtrls.forEach(rc => {
      const key = _normalizeRCN(rc.cn);
      if (key) selectedIndex.set(key, rc);
    });

    // 3. Scan framework for test plans and test controls
    const allItems = Object.values(_framework).reduce(
      (acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []
    );

    // Build plan list — include only plans where ≥1 test control matches a selected risk control
    const planMap = new Map(); // plan full jkName → plan data

    for (const item of allItems) {
      for (const field of (item.Fields || [])) {
        if (field.jkType !== 'plan') continue;

        const planId  = field.jkName || '';
        const planObj = field.PlanObjective || '';
        const planRole = field.Role || '';
        const planDataset = field.TestDataset || [];
        const matchedTests = [];

        for (const ctrl of (field.controls || [])) {
          if (ctrl.jkType !== 'test_control') continue;
          const tcn = ctrl.control_number || '';
          const key = _normalizeTCN(tcn);
          if (!key) continue;

          const linkedRC = selectedIndex.get(key);
          if (!linkedRC) continue; // this test not needed for user's selected controls

          matchedTests.push({
            cn:           tcn,
            rcn:          ctrl.requirement_control_number || '',
            jkName:       ctrl.jkName || '',
            jkText:       ctrl.jkText || '',
            jkObjective:  ctrl.jkObjective || '',
            jkImplementationEvidence: ctrl.jkImplementationEvidence || '',
            linked_risk_cn:   linkedRC.cn,
            linked_risk_name: linkedRC.ctrl_name,
            risk_name:        linkedRC.risk_name
          });
        }

        if (!matchedTests.length) continue;

        // Use plan full name as key to avoid duplicate-id collision (two TEST-AL-01 plans exist)
        if (!planMap.has(planId)) {
          planMap.set(planId, {
            plan_id:       planId,
            objective:     planObj,
            role:          planRole,
            dataset:       planDataset,
            test_controls: []
          });
        }
        planMap.get(planId).test_controls.push(...matchedTests);
      }
    }

    // 4. Find uncovered (no matching T control)
    const coveredKeys = new Set();
    for (const plan of planMap.values()) {
      plan.test_controls.forEach(tc => {
        const key = _normalizeTCN(tc.cn);
        if (key) coveredKeys.add(key);
      });
    }

    const uncovered = selectedRCtrls.filter(rc => {
      const key = _normalizeRCN(rc.cn);
      return !key || !coveredKeys.has(key);
    });

    return { plans: Array.from(planMap.values()), uncovered };
  }

  // Normalize [X.Y.Rn] → "X.Y|n"  (risk control)
  function _normalizeRCN(cn) {
    const m = cn && cn.match(/^\[([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.R(\d+)\]$/);
    return m ? `${m[1]}|${m[2]}` : null;
  }

  // Normalize [X.Y.Tn] → "X.Y|n"  (test control)
  function _normalizeTCN(cn) {
    const m = cn && cn.match(/^\[([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.T(\d+)\]$/);
    return m ? `${m[1]}|${m[2]}` : null;
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
      warn.innerHTML = '<strong>No controls selected in Step 9.</strong> Complete the Control Identification (Step 9) and confirm at least one control before returning to this step.';
      card.appendChild(warn);
      return card;
    }

    card.appendChild(_sectionLabel('Test Plan'));

    const intro = _el('p', 'wiz10-intro');
    const totalTests = _planData.reduce((n, p) => n + p.test_controls.length, 0);
    intro.innerHTML = `Mark each test control as <strong>Completed</strong>, <strong>Not Applicable</strong>, or leave as <strong>Pending</strong>. ${totalTests} test control${totalTests !== 1 ? 's' : ''} identified across ${_planData.length} test plan${_planData.length !== 1 ? 's' : ''}.`;
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
    const step9 = _record?.['step-9'];
    if (!step9) {
      const w = _el('div', 'wiz10-info');
      w.innerHTML = '<strong>Step 9 (Control Identification) not yet completed.</strong> Complete and save Step 9 first.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz10-source-label');
    lbl.textContent = 'Step 9 — Control Identification'; card.appendChild(lbl);
    const grid = _el('div', 'wiz10-source-grid');
    const cell = (l, v, mod) => {
      const c = _el('div', 'wiz10-source-cell');
      const lEl = _el('span', 'wiz10-cell-label'); lEl.textContent = l; c.appendChild(lEl);
      const vEl = _el('span', mod ? `wiz10-cell-value wiz10-cell-value--${mod}` : 'wiz10-cell-value');
      vEl.textContent = v || '—'; c.appendChild(vEl); grid.appendChild(c);
    };
    cell('Risks addressed',    String(step9.total_risks || 0));
    cell('Controls selected',  String(step9.selected_controls || 0), 'num');
    cell('Test plans found',   String(_planData.length), 'num');
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
    const completed  = allTests.filter(t => _state.testStatus[t.cn] === 'completed').length;
    const notAppl    = allTests.filter(t => _state.testStatus[t.cn] === 'not_applicable').length;
    const pending    = allTests.length - completed - notAppl;
    el.innerHTML = '';
    if (pending === 0 && allTests.length > 0) {
      const ok = _el('div', 'wiz10-val-ok');
      ok.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All ${allTests.length} test controls reviewed — ${completed} completed, ${notAppl} not applicable.`;
      el.appendChild(ok);
    } else {
      const info = _el('div', 'wiz10-val-info');
      const pct = allTests.length ? Math.round(((completed + notAppl) / allTests.length) * 100) : 0;
      info.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <strong>${pending} test${pending !== 1 ? 's' : ''} pending</strong> — ${completed} completed, ${notAppl} not applicable (${pct}% reviewed).`;
      el.appendChild(info);
    }
  }

  // ---- Plan card ----------------------------------------------
  function _buildPlanCard(plan, idx) {
    const sec = _el('div', 'wiz10-plan-sec');
    sec.dataset.planId = plan.plan_id;

    // Plan header
    const hdr = _el('div', 'wiz10-plan-hdr');
    const hdrLeft = _el('div', 'wiz10-plan-hdr-left');

    const planIcon = _el('span', 'wiz10-plan-icon');
    planIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>`;
    hdrLeft.appendChild(planIcon);

    const planName = _el('span', 'wiz10-plan-name');
    planName.textContent = plan.plan_id; hdrLeft.appendChild(planName);

    if (plan.role) {
      const roleBadge = _el('span', 'wiz10-role-badge');
      roleBadge.textContent = plan.role; hdrLeft.appendChild(roleBadge);
    }

    hdr.appendChild(hdrLeft);

    // Count badge
    const countBadge = _el('span', 'wiz10-plan-count');
    countBadge.id = `wiz10-plan-count-${idx}`;
    _updatePlanCount(plan, countBadge);
    hdr.appendChild(countBadge);

    sec.appendChild(hdr);

    // Plan objective
    if (plan.objective) {
      const obj = _el('p', 'wiz10-plan-obj');
      obj.textContent = plan.objective; sec.appendChild(obj);
    }

    // Test controls
    const ctrlList = _el('div', 'wiz10-ctrl-list');
    plan.test_controls.forEach(tc => ctrlList.appendChild(_buildTestControlCard(tc, plan, idx)));
    sec.appendChild(ctrlList);

    // Test dataset (collapsible)
    if (plan.dataset && plan.dataset.length > 0) {
      sec.appendChild(_buildDatasetSection(plan));
    }

    return sec;
  }

  function _updatePlanCount(plan, el) {
    const total     = plan.test_controls.length;
    const done      = plan.test_controls.filter(t =>
      _state.testStatus[t.cn] === 'completed' || _state.testStatus[t.cn] === 'not_applicable'
    ).length;
    el.textContent  = `${done} / ${total} reviewed`;
    el.className    = done === total
      ? 'wiz10-plan-count wiz10-plan-count--ok'
      : 'wiz10-plan-count wiz10-plan-count--pending';
  }

  // ---- Test control card --------------------------------------
  function _buildTestControlCard(tc, plan, planIdx) {
    const status = _state.testStatus[tc.cn] || 'pending';
    const card = _el('div', `wiz10-tc-card wiz10-tc-card--${status}`);
    card.dataset.tcn = tc.cn;

    // Card header
    const hdr = _el('div', 'wiz10-tc-hdr');

    // Status pip
    const pip = _el('span', `wiz10-tc-pip wiz10-tc-pip--${status}`);
    hdr.appendChild(pip);

    // Test icon
    const icon = _el('span', 'wiz10-tc-icon');
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    hdr.appendChild(icon);

    const name = _el('span', 'wiz10-tc-name');
    name.textContent = tc.jkName; hdr.appendChild(name);

    // Badges
    if (tc.cn) {
      const cnb = _el('span', 'wiz10-cn-badge'); cnb.textContent = tc.cn; hdr.appendChild(cnb);
    }
    if (tc.rcn) {
      const rcnb = _el('span', 'wiz9-rcn-badge'); rcnb.textContent = tc.rcn; hdr.appendChild(rcnb);
    }

    card.appendChild(hdr);

    // Linked risk control
    const link = _el('div', 'wiz10-tc-link');
    link.innerHTML = `<span class="wiz10-link-label">Linked to:</span>
      <span class="wiz10-link-rc">${tc.linked_risk_cn}</span>
      <span class="wiz10-link-rcname">${tc.linked_risk_name}</span>
      <span class="wiz10-link-risk">${tc.risk_name}</span>`;
    card.appendChild(link);

    // Objective (collapsed by default)
    if (tc.jkObjective) {
      card.appendChild(_buildCollapsible('Objective', tc.jkObjective, 'wiz10-tc-obj'));
    }

    // Test instructions (collapsed)
    if (tc.jkText) {
      card.appendChild(_buildCollapsible('Test Instructions', tc.jkText, 'wiz10-tc-text'));
    }

    // Evidence sample (collapsed)
    if (tc.jkImplementationEvidence) {
      card.appendChild(_buildCollapsible('Required Evidence Sample', tc.jkImplementationEvidence, 'wiz10-tc-evidence'));
    }

    // Status selector
    card.appendChild(_buildStatusSelector(tc, plan, planIdx));

    return card;
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

  // ---- Test dataset section -----------------------------------
  function _buildDatasetSection(plan) {
    const wrap = _el('div', 'wiz10-collapsible wiz10-dataset-wrap');
    const btn  = document.createElement('button');
    btn.className = 'wiz10-coll-btn wiz10-dataset-btn';
    btn.innerHTML = `<svg class="wiz10-coll-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>Test Cases (${plan.dataset.length})`;
    const body = _el('div', 'wiz10-coll-body');
    body.hidden = true;

    const table = _el('div', 'wiz10-dataset-table');
    plan.dataset.forEach(tc => {
      const row = _el('div', 'wiz10-dataset-row');
      const idCell = _el('span', 'wiz10-dataset-id'); idCell.textContent = tc.ID || ''; row.appendChild(idCell);
      const main = _el('div', 'wiz10-dataset-main');
      const q = _el('p', 'wiz10-dataset-query'); q.textContent = tc.Query || ''; main.appendChild(q);
      const eo = _el('p', 'wiz10-dataset-outcome');
      eo.innerHTML = `<strong>Expected:</strong> ${tc.Expected_Outcome || ''}`;
      main.appendChild(eo);
      if (tc.Rationale_Summary) {
        const rs = _el('p', 'wiz10-dataset-rationale'); rs.textContent = tc.Rationale_Summary || ''; main.appendChild(rs);
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
      { value: 'pending',         label: 'Pending',        cls: 'wiz10-status-btn--pending' },
      { value: 'completed',       label: 'Completed',      cls: 'wiz10-status-btn--completed' },
      { value: 'not_applicable',  label: 'Not Applicable', cls: 'wiz10-status-btn--na' }
    ];

    options.forEach(opt => {
      const btn = document.createElement('button');
      const current = _state.testStatus[tc.cn] || 'pending';
      btn.className = `wiz10-status-btn ${opt.cls}${current === opt.value ? ' wiz10-status-btn--active' : ''}`;
      btn.textContent = opt.label;
      btn.dataset.statusValue = opt.value;
      btn.addEventListener('click', () => {
        _state.testStatus[tc.cn] = opt.value;

        // Update all status buttons in this card
        const card = btn.closest('.wiz10-tc-card');
        if (card) {
          card.className = `wiz10-tc-card wiz10-tc-card--${opt.value}`;
          card.querySelectorAll('.wiz10-status-btn').forEach(b => {
            b.classList.toggle('wiz10-status-btn--active', b.dataset.statusValue === opt.value);
          });
          // Update pip
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
    note.textContent = 'The following controls do not have a corresponding test control in the framework (typically infrastructure and container security controls). Manual evidence review is required.';
    sec.appendChild(note);

    const list = _el('div', 'wiz10-unc-list');
    _uncovered.forEach(rc => {
      const item = _el('div', 'wiz10-unc-item');
      const cnb = _el('span', 'wiz10-cn-badge'); cnb.textContent = rc.cn; item.appendChild(cnb);
      const nm = _el('span', 'wiz10-unc-ctrl-name'); nm.textContent = rc.ctrl_name; item.appendChild(nm);
      const risk = _el('span', 'wiz10-unc-risk'); risk.textContent = rc.risk_name; item.appendChild(risk);
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
    _record['step-10'] = rec10;
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 10 saved ✓');
    _renderResults(rec10);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};

    const plans = _planData.map(p => ({
      plan_id:       p.plan_id,
      objective:     p.objective,
      test_controls: p.test_controls.map(tc => ({
        control_number:              tc.cn,
        control_name:                tc.jkName,
        rcn:                         tc.rcn,
        linked_risk_control_number:  tc.linked_risk_cn,
        linked_risk_control_name:    tc.linked_risk_name,
        risk_name:                   tc.risk_name,
        status:                      _state.testStatus[tc.cn] || 'pending'
      }))
    }));

    const allTests   = plans.reduce((a, p) => a.concat(p.test_controls), []);
    const completed  = allTests.filter(t => t.status === 'completed').length;
    const notAppl    = allTests.filter(t => t.status === 'not_applicable').length;
    const pending    = allTests.length - completed - notAppl;

    return {
      step_id:     'step-10',
      step_title:  'Content Verification Testing',
      assessment_date: today,
      assessed_by:  meta.assessed_by || '',
      use_case_id:  meta.use_case_id || '',
      total_tests:          allTests.length,
      completed_tests:      completed,
      not_applicable_tests: notAppl,
      pending_tests:        pending,
      plans,
      uncovered_controls: _uncovered.map(rc => ({
        control_number:   rc.cn,
        control_name:     rc.ctrl_name,
        risk_name:        rc.risk_name,
        rcn:              rc.rcn
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
      [rec10.total_tests,          'Total tests'],
      [rec10.completed_tests,      'Completed'],
      [rec10.not_applicable_tests, 'Not applicable'],
      [rec10.pending_tests,        'Pending']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num); s.appendChild(n);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl; s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);
    const note = _el('p', 'wiz10-result-note');
    note.innerHTML = `Test status saved. <strong>${rec10.completed_tests} test${rec10.completed_tests !== 1 ? 's' : ''} completed</strong>, ${rec10.not_applicable_tests} not applicable, ${rec10.pending_tests} still pending.`;
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
      const p = _el('p', 'wiz10-intro'); p.textContent = 'No controls selected in Step 9.'; card.appendChild(p);
      return card;
    }

    // Summary
    const allTests = _planData.reduce((a, p) => a.concat(p.test_controls), []);
    const completed = allTests.filter(t => _state.testStatus[t.cn] === 'completed').length;
    const notAppl   = allTests.filter(t => _state.testStatus[t.cn] === 'not_applicable').length;
    const pending   = allTests.length - completed - notAppl;

    const summary = _el('div', 'wiz10-ref-summary');
    const badge = _el('span', pending === 0
      ? 'wiz9-ref-sum-badge wiz9-ref-sum-badge--ok'
      : 'wiz9-ref-sum-badge wiz9-ref-sum-badge--warn');
    badge.textContent = `${completed + notAppl} / ${allTests.length} tests reviewed`;
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
      const pn = _el('span', 'wiz10-ref-plan-name'); pn.textContent = plan.plan_id; ph.appendChild(pn);
      const reviewed = plan.test_controls.filter(t =>
        _state.testStatus[t.cn] === 'completed' || _state.testStatus[t.cn] === 'not_applicable'
      ).length;
      const rb = _el('span', reviewed === plan.test_controls.length
        ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--all'
        : reviewed > 0
          ? 'wiz9-risk-sel-badge wiz9-risk-sel-badge--partial'
          : 'wiz9-risk-sel-badge wiz9-risk-sel-badge--none');
      rb.textContent = `${reviewed} / ${plan.test_controls.length}`;
      ph.appendChild(rb);
      planSec.appendChild(ph);

      plan.test_controls.forEach(tc => {
        const status = _state.testStatus[tc.cn] || 'pending';
        const tc_card = _el('div', `wiz10-ref-tc wiz10-ref-tc--${status}`);
        const tch = _el('div', 'wiz10-ref-tc-hdr');

        const statusDot = _el('span', `wiz10-ref-status-dot wiz10-ref-status-dot--${status}`);
        tch.appendChild(statusDot);

        const tcName = _el('span', 'wiz10-ref-tc-name'); tcName.textContent = tc.jkName; tch.appendChild(tcName);
        const cnb = _el('span', 'wiz10-cn-badge'); cnb.textContent = tc.cn; tch.appendChild(cnb);
        tc_card.appendChild(tch);

        const tcLink = _el('div', 'wiz10-ref-tc-link');
        tcLink.innerHTML = `<span class="wiz10-link-label">→</span> <span class="wiz10-link-rc">${tc.linked_risk_cn}</span> ${tc.linked_risk_name}`;
        tc_card.appendChild(tcLink);

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
      rb.textContent = `${_uncovered.length} controls`; uh.appendChild(rb);
      uncSec.appendChild(uh);
      _uncovered.forEach(rc => {
        const item = _el('div', 'wiz10-ref-tc wiz10-ref-tc--pending');
        item.innerHTML = `<span class="wiz10-cn-badge">${rc.cn}</span> <span class="wiz10-ref-tc-name">${rc.ctrl_name}</span> <span class="wiz10-unc-risk">${rc.risk_name}</span>`;
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
.wiz10-plan-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);border-bottom:1px solid var(--color-border)}
.wiz10-plan-hdr-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.wiz10-plan-icon{display:flex;align-items:center;color:var(--teal-600,#0d9488);flex-shrink:0}
.wiz10-plan-name{font-size:13px;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
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

/* Linked control */
.wiz10-tc-link{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;margin-bottom:10px;padding:6px 10px;background:var(--color-bg-subtle,#f8fafc);border-radius:4px;border-left:2px solid var(--color-border)}
.wiz10-link-label{color:var(--color-text-tertiary);font-weight:500}
.wiz10-link-rc{font-family:var(--font-mono,monospace);font-size:10px;font-weight:600;padding:1px 5px;background:#fce7f3;color:#9d174d;border-radius:3px}
.wiz10-link-rcname{color:var(--color-text-primary);font-weight:500}
.wiz10-link-risk{color:var(--color-text-tertiary)}

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

/* Dataset */
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
.wiz10-ref-plan-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.wiz10-ref-plan-name{font-size:13px;font-weight:600;color:var(--color-text-primary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wiz10-ref-tc{padding:10px 12px;border:1px solid var(--color-border);border-radius:6px;margin-bottom:6px}
.wiz10-ref-tc--completed{border-left:3px solid #22c55e}
.wiz10-ref-tc--not_applicable{border-left:3px solid #f59e0b}
.wiz10-ref-tc--pending{border-left:3px solid #94a3b8}
.wiz10-ref-tc-hdr{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
.wiz10-ref-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.wiz10-ref-status-dot--pending{background:#94a3b8}
.wiz10-ref-status-dot--completed{background:#22c55e}
.wiz10-ref-status-dot--not_applicable{background:#f59e0b}
.wiz10-ref-tc-name{font-size:12px;font-weight:600;color:var(--color-text-primary)}
.wiz10-ref-tc-link{font-size:11px;color:var(--color-text-secondary);margin:3px 0}
.wiz10-ref-tc-obj{font-size:11px;color:var(--color-text-tertiary);margin:4px 0 0;line-height:1.5}
.wiz10-ref-summary{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
`;
    document.head.appendChild(s);
  }

})();
