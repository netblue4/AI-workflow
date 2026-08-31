/* Step 7 — Residual Risk
   Domain-tabbed wizard (Legal/Regulatory, DPIA, Internal Standards) matching the
   risk/control domains of Steps 5 and 6. Under each domain, every risk is one
   block with three in-order sections: 1) Control Activation, 2) Control Testing,
   3) Residual Risk. Residual unlocks per risk once its activation and testing
   are evidenced or waived; a per-tab rollup summarises residual across the domain.

   Saves everything to record['step-7'] for backward compat with report-wizard.js.
   On restore, falls back to record['step-9'] for legacy activation data.
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _tblData = null, _record = null;

  const _config = {
    status_options: [
      { value: 'not_started',       label: 'Not started' },
      { value: 'in_progress',       label: 'In progress' },
      { value: 'evidence_provided', label: 'Evidence provided' },
      { value: 'waived',            label: 'Waived' },
    ],
    status_colors: {
      not_started:       { bg: '#262219', text: '#b1a992' },
      in_progress:       { bg: 'rgba(212,184,96,0.16)', text: '#ecd489' },
      evidence_provided: { bg: 'rgba(52,199,120,0.16)', text: '#8cebb0' },
      waived:            { bg: 'rgba(138,130,235,0.16)', text: '#bfb8ff' },
    },
    risk_matrix: {
      low:      { low: 'low',    medium: 'low',    high: 'medium',   critical: 'medium'   },
      medium:   { low: 'low',    medium: 'medium', high: 'high',     critical: 'high'     },
      high:     { low: 'medium', medium: 'high',   high: 'high',     critical: 'critical' },
      critical: { low: 'medium', medium: 'high',   high: 'critical', critical: 'critical' },
    },
    residual_colors: {
      low:      { bg: 'rgba(52,199,120,0.16)', text: '#8cebb0' },
      medium:   { bg: 'rgba(212,184,96,0.16)', text: '#ecd489' },
      high:     { bg: 'rgba(224,120,80,0.40)', text: '#f3ab8a' },
      critical: { bg: 'rgba(226,90,88,0.16)', text: '#fba4a3' },
    },
  };

  // Tab 1 — test controls
  let _planData  = [];  // [{risk_id, risk_name, test_controls:[]}]
  let _uncovered = [];  // [{control_id, control_name, control_source}]
  const _testState = { status: {}, notes: {} }; // pk_Test_Control_ID → value

  // Tab 2 — activation controls
  let _controls = []; // [{key, name, objective, source, risk_id, risk_name, implementationEvidence}]
  const _actState = {}; // control_key → { notes, status }

  // Tab 3 — residual risk
  const _residualState = {}; // risk_id → { likelihood, impact, justification }

  // Legal/Regulatory tab — the HS requirement is the activated treatment unit
  let _hsByRef = new Map();   // standard_ref → HS row
  let _tcByHsRef = new Map(); // standard_ref → TestControl[]
  let _fsByRef = new Map();   // canonical HS ref → framework self-certification statement
  const _hsActState = {};     // `${riskId}::${standard_ref}` → { status, notes }

  // HS refs appear with/without brackets and stray spaces across tables — compare
  // on a canonical form so "[18286.1]" and "18286.1" resolve to the same key.
  const _canonRef = r => String(r == null ? '' : r).replace(/[[\]\s]/g, '');

  const STATUS_LEGACY_MAP = { pending: 'not_started', completed: 'evidence_provided', not_applicable: 'waived' };

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
    _controls   = [];
    _testState.status = {};
    _testState.notes  = {};
    Object.keys(_actState).forEach(k => delete _actState[k]);
    Object.keys(_residualState).forEach(k => delete _residualState[k]);
    Object.keys(_hsActState).forEach(k => delete _hsActState[k]);
    _hsByRef = new Map();
    _tcByHsRef = new Map();

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
    pw.innerHTML = '<p style="padding:32px;color:var(--color-text-secondary)">Loading…</p>';
    const [risks, riskControls, testControls, hs] = await WizUtils.fetchAll([
      'tbl_Risks.json',
      'tbl_Risk_Controls.json',
      'tbl_Test_Controls.json',
      'tbl_Harmonised_Standards.json',
    ]);
    if (!risks || !riskControls || !testControls) {
      pw.innerHTML = `<p style="padding:24px;color:#ec6a68">Could not load data files.</p>`;
      return;
    }
    _tblData = { risks, riskControls, testControls, hs: hs || [] };
    _hsByRef = new Map((hs || []).map(h => [h.standard_ref, h]));
    // Framework self-certifications, indexed by the HS requirement they certify.
    // Used to pre-fill the evidence box in Step 7 with the framework statement the
    // assessor already saw in Step 6, so they don't have to copy it across.
    _fsByRef = new Map();
    (riskControls || []).forEach(rc => {
      if (!/Framework/i.test(rc.control_source || '')) return;
      const stmt = [rc.jkName, rc.jkObjective].filter(Boolean).join('\n');
      if (!stmt) return;
      (rc.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean)
        .forEach(ref => { const k = _canonRef(ref); if (!_fsByRef.has(k)) _fsByRef.set(k, stmt); });
    });
    // Test controls indexed by each HS requirement they verify — used to ask the
    // assessor for the test result (operating effectiveness) on Test-type reqs.
    _tcByHsRef = new Map();
    (testControls || []).forEach(tc => {
      (tc.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean)
        .forEach(ref => { if (!_tcByHsRef.has(ref)) _tcByHsRef.set(ref, []); _tcByHsRef.get(ref).push(tc); });
    });

    _record = WizUtils.loadRecord();

    // Tab 1: test plans
    const { plans, uncovered } = _buildPlanData();
    _planData  = plans;
    _uncovered = uncovered;

    // Tab 2: activation controls
    _buildControlList();

    // Restore state
    _restoreState();

    _renderPanes(pw);
  }

  // ---- Build plan data (Tab 1) --------------------------------
  function _buildPlanData() {
    const step6 = _record?.['step-6'];
    if (!step6) return { plans: [], uncovered: [] };

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

    const rcById   = new Map(_tblData.riskControls.map(rc => [rc.pk_Risk_Control_ID, rc]));
    const riskById = new Map(_tblData.risks.map(r => [r.pk_Risk_ID, r]));
    const tcByRC   = new Map();
    _tblData.testControls.forEach(tc => { if (tc.fk_Risk_Control_ID) tcByRC.set(tc.fk_Risk_Control_ID, tc); });

    const riskMap   = new Map();
    const uncovered = [];

    const _ensureRisk = riskId => {
      if (!riskMap.has(riskId)) {
        const risk = riskById.get(riskId);
        riskMap.set(riskId, { risk_id: riskId, risk_name: risk?.risk_name || riskId, fk_AI_Article_ID: risk?.fk_AI_Article_ID || '', test_controls: [] });
      }
      return riskMap.get(riskId);
    };

    selectedControls.forEach(sc => {
      const rc = rcById.get(sc.control_id);
      if (!rc) { uncovered.push(sc); return; }
      // Framework_Statement controls have no automated tests — skip
      if ((rc.control_source || '').includes('Framework')) return;
      const tc = tcByRC.get(sc.control_id);
      if (!tc) { uncovered.push(sc); return; }
      _ensureRisk(rc.fk_Risk_ID).test_controls.push(tc);
    });

    return { plans: Array.from(riskMap.values()).filter(r => r.test_controls.length > 0), uncovered };
  }

  // ---- Build control list (Tab 2) ----------------------------
  function _buildControlList() {
    const s6 = _record?.['step-6'];
    if (!s6) return;

    const rcById       = new Map((_tblData.riskControls || []).map(c => [c.pk_Risk_Control_ID, c]));
    const riskNameById = new Map((_tblData.risks        || []).map(r => [r.pk_Risk_ID, r.risk_name]));
    const seen         = new Set();

    const push = (controlId, controlName, source, riskId, domain) => {
      if (seen.has(controlId)) return;
      seen.add(controlId);
      const tbl = rcById.get(controlId);
      _controls.push({
        key:                    controlId,
        name:                   tbl?.jkName      || controlName || controlId,
        objective:              tbl?.jkObjective || '',
        source,
        domain,
        risk_id:                riskId || '',
        risk_name:              riskNameById.get(riskId) || '',
        hs_ids:                 tbl?.fk_Harmonised_Standard_IDs || '',
        implementationEvidence: tbl?.jkImplementationEvidence || ''
      });
    };

    (s6.risk_controls || []).filter(c => c.selected).forEach(c =>
      push(c.control_id, c.control_name, c.control_source || 'EU AI Act', c.risk_id, 'legal')
    );
    (s6.compliance_additions || []).forEach(c =>
      push(c.control_id, c.control_name, 'Compliance', null, 'compliance')
    );
    ((s6.group_standard_controls?.controls) || []).filter(c => c.selected).forEach(c =>
      push(c.control_id, c.control_name, 'Internal Standard', c.risk_id, 'group_standard')
    );
    (s6.dpia_controls || []).forEach(c => {
      const key = 'DPIA__' + c.control_name;
      if (seen.has(key)) return;
      seen.add(key);
      _controls.push({ key, name: c.control_name, objective: '', source: 'DPIA', domain: 'dpia', risk_id: '', risk_name: '', implementationEvidence: '' });
    });
  }

  // ---- Restore saved state -----------------------------------
  function _restoreState() {
    // --- Tab 1 test state ---
    const saved7 = _record?.['step-7'];
    if (saved7?.plans) {
      saved7.plans.forEach(p => {
        (p.test_controls || []).forEach(tc => {
          if (tc.test_control_id) {
            const raw = tc.status || 'not_started';
            _testState.status[tc.test_control_id] = STATUS_LEGACY_MAP[raw] || raw;
            if (tc.notes) _testState.notes[tc.test_control_id] = tc.notes;
          }
        });
      });
    } else {
      _planData.forEach(p => p.test_controls.forEach(tc => {
        _testState.status[tc.pk_Test_Control_ID] = 'not_started';
      }));
    }

    // --- Tab 2 activation state (fallback to legacy step-9) ---
    const isFS = c => (c.source || '').includes('Framework');
    _controls.forEach(c => {
      _actState[c.key] = { notes: isFS(c) ? (c.implementationEvidence || '') : '', status: 'not_started' };
    });
    const savedActControls = saved7?.controls || _record?.['step-9']?.controls || [];
    savedActControls.forEach(s => {
      if (_actState[s.key] !== undefined) {
        _actState[s.key] = { notes: s.notes || '', status: s.status || 'not_started' };
      }
    });

    // --- Tab 3 residual state (fallback to legacy step-9) ---
    // Include legal/regulatory risks too: they are treated via HS requirements
    // (not activation controls), so they never appear in _controls. Without this,
    // their _residualState entry is never created and the Likelihood/Impact change
    // handlers throw on undefined — so the Risk Level never computes and never saves.
    const allRiskIds = new Set([
      ..._controls.filter(c => c.risk_id).map(c => c.risk_id),
      ..._legalRiskIds(),
    ]);
    allRiskIds.forEach(riskId => { _residualState[riskId] = { likelihood: '', impact: '', justification: '' }; });
    const savedResidual = saved7?.residual_risks || _record?.['step-9']?.residual_risks || {};
    Object.entries(savedResidual).forEach(([riskId, rr]) => {
      if (_residualState[riskId]) {
        _residualState[riskId] = { likelihood: rr.likelihood || '', impact: rr.impact || '', justification: rr.justification || '' };
      }
    });

    // --- Legal HS-requirement activation (the treatment unit for legal risks) ---
    const legalRiskIds = _legalRiskIds();
    legalRiskIds.forEach(riskId => {
      _legalRiskHsRefs(riskId).forEach(ref => {
        // Default the evidence note to the framework self-certification for this HS
        // requirement (shown in Step 6). Saved notes below override this default.
        const fs = _fsByRef.get(_canonRef(ref)) || '';
        _hsActState[_hsActKey(riskId, ref)] = { status: 'not_started', notes: fs };
      });
    });
    const savedHsAct = saved7?.hs_activation || {};
    Object.entries(savedHsAct).forEach(([riskId, byRef]) => {
      Object.entries(byRef || {}).forEach(([ref, st]) => {
        // A saved record wins — but if it predates this feature and has no note,
        // fall back to the framework statement so existing assessments benefit too.
        const fs = _fsByRef.get(_canonRef(ref)) || '';
        _hsActState[_hsActKey(riskId, ref)] = { status: st.status || 'not_started', notes: st.notes || fs };
      });
    });
    _deriveActFromHs(); // bridge HS activation → control activation for the report
  }

  // ---- Legal HS-requirement activation helpers ---------------
  const _hsActKey = (riskId, ref) => `${riskId}::${ref}`;
  // Legal risks in Step 7 are those treated via HS requirements in Step 6
  // (selected_hs keys) — a durable signal independent of the risk controls.
  // Legacy records that predate selected_hs fall back to the legal control map.
  function _legalRiskIds() {
    const ids = new Set(Object.keys(_record?.['step-6']?.selected_hs || {}));
    _controls.filter(c => c.domain === 'legal' && c.risk_id).forEach(c => ids.add(c.risk_id));
    return ids;
  }
  function _isLegalRisk(riskId) {
    return _legalRiskIds().has(riskId);
  }
  // HS requirements a legal risk addresses = those ticked in Step 6, else the
  // risk's direct risk↔HS link (tbl_Risks.fk_Harmonised_Standard_IDs), else the
  // union of its legal controls' HS refs.
  function _legalRiskHsRefs(riskId) {
    const sel = _record?.['step-6']?.selected_hs?.[riskId];
    if (sel && sel.length) return sel.slice();
    const tblRisk = (_tblData.risks || []).find(r => r.pk_Risk_ID === riskId);
    if (tblRisk?.fk_Harmonised_Standard_IDs) {
      return tblRisk.fk_Harmonised_Standard_IDs.split(',').map(s => s.trim()).filter(Boolean);
    }
    const set = new Set();
    _controls.filter(c => c.domain === 'legal' && c.risk_id === riskId).forEach(c => {
      (c.hs_ids || '').split(',').map(s => s.trim()).filter(Boolean).forEach(r => set.add(r));
    });
    return [...set];
  }
  // Bridge: derive control activation status from HS activation so the report's
  // control schedule keeps working until it is repointed to HS activation.
  function _deriveActFromHs() {
    _controls.filter(c => c.domain === 'legal').forEach(c => {
      const refs = (c.hs_ids || '').split(',').map(s => s.trim()).filter(Boolean)
        .filter(r => _hsActState[_hsActKey(c.risk_id, r)] !== undefined);
      const statuses = refs.map(r => _hsActState[_hsActKey(c.risk_id, r)].status);
      let st = 'not_started';
      if (statuses.length) {
        if (statuses.every(s => s === 'evidence_provided')) st = 'evidence_provided';
        else if (statuses.every(s => s === 'evidence_provided' || s === 'waived')) st = 'waived';
        else if (statuses.some(s => s !== 'not_started')) st = 'in_progress';
      }
      if (!_actState[c.key]) _actState[c.key] = { notes: '', status: 'not_started' };
      _actState[c.key].status = st;
    });
  }

  // ---- Tab strip ---------------------------------------------
  function _buildTabStrip() {
    return WizUtils.buildTabStrip([
      ['legal',    'Legal/Regulatory'],
      ['dpia',     'DPIA'],
      ['groupstd', 'Internal Standards']
    ], _switchTab);
  }

  function _switchTab(id) {
    _container.querySelectorAll('.wiz-tab').forEach(t =>
      t.classList.toggle('wiz-tab--active', t.dataset.tab === id));
    _container.querySelectorAll('.wiz-pane').forEach(p =>
      p.classList.toggle('wiz-pane--hidden', p.dataset.pane !== id));
    // Rebuild the active domain pane on entry so residual reflects latest state
    if (id === 'legal') {
      const p = _container.querySelector('[data-pane="legal"]');
      if (p) { p.innerHTML = ''; p.appendChild(_buildDomainRiskPane('legal', 'Legal/Regulatory')); }
    }
    if (id === 'groupstd') {
      const p = _container.querySelector('[data-pane="groupstd"]');
      if (p) { p.innerHTML = ''; p.appendChild(_buildDomainRiskPane('group_standard', 'Internal Standards')); }
    }
    if (id === 'dpia') {
      const p = _container.querySelector('[data-pane="dpia"]');
      if (p) { p.innerHTML = ''; p.appendChild(_buildDpiaResidualPane()); }
    }
  }

  // ---- Panes -------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const pLegal = _el('div', 'wiz-pane');                  pLegal.dataset.pane = 'legal';
    const pDpia  = _el('div', 'wiz-pane wiz-pane--hidden'); pDpia.dataset.pane  = 'dpia';
    const pGs    = _el('div', 'wiz-pane wiz-pane--hidden'); pGs.dataset.pane    = 'groupstd';

    pLegal.appendChild(_buildDomainRiskPane('legal', 'Legal/Regulatory'));
    pDpia.appendChild(_buildDpiaResidualPane());
    pGs.appendChild(_buildDomainRiskPane('group_standard', 'Internal Standards'));

    pw.appendChild(pLegal);
    pw.appendChild(pDpia);
    pw.appendChild(pGs);
  }

  // ===========================================================
  // DOMAIN PANE — per-risk Activation → Testing → Residual
  // ===========================================================
  function _domainMuted(txt) {
    const p = _el('p', '');
    p.style.cssText = 'font-size:12px;color:var(--color-text-tertiary);margin:4px 0 10px;padding-left:2px';
    p.textContent = txt;
    return p;
  }

  function _buildDomainRollup(riskIds) {
    const levels = {};
    let assessed = 0;
    riskIds.forEach(id => {
      const rr = _residualState[id] || {};
      if (rr.likelihood && rr.impact) {
        assessed++;
        const lvl = _config.risk_matrix[rr.likelihood]?.[rr.impact] || '';
        if (lvl) levels[lvl] = (levels[lvl] || 0) + 1;
      }
    });
    const wrap = _el('div', '');
    wrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 14px;padding:10px 12px;border:1px solid var(--color-border,#2e2a1f);border-radius:8px;background:var(--color-bg-subtle,#211d15)';
    const lead = _el('span', '');
    lead.style.cssText = 'font-size:12px;font-weight:700;color:var(--color-text-secondary)';
    lead.textContent = `${assessed} / ${riskIds.length} risks assessed`;
    wrap.appendChild(lead);
    ['critical', 'high', 'medium', 'low'].forEach(lvl => {
      if (!levels[lvl]) return;
      const col = _config.residual_colors[lvl] || { bg: '#262219', text: '#b1a992' };
      const pill = _el('span', '');
      pill.style.cssText = `font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;background:${col.bg};color:${col.text}`;
      pill.textContent = `${levels[lvl]} ${lvl.charAt(0).toUpperCase() + lvl.slice(1)}`;
      wrap.appendChild(pill);
    });
    return wrap;
  }

  function _buildRiskBlock(riskId, riskName, domain) {
    const sec = _el('div', 's9-risk-acc');

    const hdr  = _el('div', 's9-risk-acc-hdr');
    const left = _el('div', 's9-risk-acc-left');
    left.appendChild(_el('span', 's9-risk-acc-id',   { textContent: riskId }));
    left.appendChild(_el('span', 's9-risk-acc-name', { textContent: riskName }));
    const artId = (_tblData.risks || []).find(r => r.pk_Risk_ID === riskId)?.fk_AI_Article_ID;
    if (artId) left.appendChild(_el('span', 'wiz-art-tag', { textContent: WizUtils.artLabel(artId) }));
    hdr.appendChild(left);
    const rr = _residualState[riskId] || {};
    const lvlPill = _el('span', 's9-risk-acc-id');
    lvlPill.title = 'Residual level';
    _applyResidualLevel(lvlPill, rr.likelihood, rr.impact);
    hdr.appendChild(lvlPill);
    const chevron = _el('span', 's9-risk-acc-chevron');
    chevron.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)';
    hdr.appendChild(chevron);
    sec.appendChild(hdr);

    const body = _el('div', 's9-risk-acc-body s9-collapsed');

    if (domain === 'legal') {
      // Legal/Regulatory: verify each HS requirement — for Test-type requirements
      // the evidence is the test result; for Document/Workflow it is the artefact
      // or workflow record. No separate risk-control test section.
      body.appendChild(_sectionLabel('1 · Harmonised Standard Verification'));
      const refs = _legalRiskHsRefs(riskId);
      if (refs.length) refs.forEach(ref => body.appendChild(_buildHsActCard(riskId, ref)));
      else body.appendChild(_domainMuted('No harmonised standard requirements selected for this risk in Step 6.'));

      body.appendChild(_sectionLabel('2 · Residual Risk'));
      body.appendChild(_buildResidualPanel(riskId));
    } else {
      // 1 · Control Activation
      body.appendChild(_sectionLabel('1 · Control Activation'));
      const actCtrls = _controls.filter(c => c.risk_id === riskId);
      if (actCtrls.length) actCtrls.forEach(c => body.appendChild(_buildActControlCard(c, 'eu')));
      else body.appendChild(_domainMuted('No activation controls for this risk.'));

      // 2 · Control Testing
      body.appendChild(_sectionLabel('2 · Control Testing'));
      const plan = _planData.find(p => p.risk_id === riskId);
      if (plan && plan.test_controls.length) {
        const planIdx = _planData.indexOf(plan);
        plan.test_controls.forEach(tc => body.appendChild(_buildTestControlCard(tc, plan, planIdx)));
      } else {
        body.appendChild(_domainMuted('No test controls defined for this risk.'));
      }

      // 3 · Residual Risk
      body.appendChild(_sectionLabel('3 · Residual Risk'));
      body.appendChild(_buildResidualPanel(riskId));
    }

    sec.appendChild(body);
    hdr.addEventListener('click', () => {
      const collapsed = body.classList.toggle('s9-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
    return sec;
  }

  function _buildDomainRiskPane(domain, title) {
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('h2', 'step-detail-title', { textContent: 'Residual Risk — ' + title }));
    card.appendChild(_el('p', 'step-detail-summary', { textContent: 'For each risk: confirm control activation, record control testing, then assess residual risk. Residual unlocks once that risk’s activation and testing are evidenced or waived.' }));

    const riskIds = domain === 'legal'
      ? Array.from(_legalRiskIds())
      : Array.from(new Set(_controls.filter(c => c.domain === domain && c.risk_id).map(c => c.risk_id)));
    if (!riskIds.length) {
      const warn = _el('div', 's9-warn');
      warn.innerHTML = `<strong>No ${title} risk controls found.</strong> Select controls for ${title} risks in Steps 5 and 6 first.`;
      card.appendChild(warn);
      return card;
    }
    const riskNameById = new Map((_tblData.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));

    card.appendChild(_buildDomainRollup(riskIds));
    const list = _el('div', '');
    riskIds.forEach(id => list.appendChild(_buildRiskBlock(id, riskNameById.get(id) || id, domain)));
    card.appendChild(list);
    card.appendChild(_buildSaveRow('Save Residual Risk', _handleSave));
    return card;
  }

  // DPIA residual — the DPIA is assessed as a whole in Step 4, so this is a
  // single block: security measures as activation controls, no test controls,
  // and the residual rating carried (read-only) from Step 4.
  function _buildDpiaResidualPane() {
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('h2', 'step-detail-title', { textContent: 'Residual Risk — DPIA' }));

    const step4 = _record?.['step-4'];
    if (!step4) {
      const warn = _el('div', 's9-warn');
      warn.innerHTML = '<strong>Step 4 (DPIA) not yet completed.</strong> Complete and save the DPIA first.';
      card.appendChild(warn);
      return card;
    }
    card.appendChild(_el('p', 'step-detail-summary', { textContent: 'The DPIA is assessed as a whole in Step 4. Confirm the security-measure controls are live; the residual rating is carried from the DPIA.' }));

    const di = step4.data_types_identified || {};
    const privacyRisks = di.privacy_risks || [];

    // Privacy risks (context, read-only)
    card.appendChild(_sectionLabel(`Privacy risks identified (${privacyRisks.length})`));
    if (privacyRisks.length) {
      const ul = _el('ul', '');
      ul.style.cssText = 'margin:0 0 8px;padding-left:18px;font-size:13px;line-height:1.7;color:var(--color-text-primary)';
      privacyRisks.forEach(r => { const li = document.createElement('li'); li.textContent = r; ul.appendChild(li); });
      card.appendChild(ul);
    } else {
      card.appendChild(_domainMuted('No privacy risks were recorded in the DPIA.'));
    }

    // Single DPIA block
    const sec  = _el('div', 's9-risk-acc');
    const hdr  = _el('div', 's9-risk-acc-hdr');
    const left = _el('div', 's9-risk-acc-left');
    left.appendChild(_el('span', 's9-risk-acc-id',   { textContent: 'DPIA' }));
    left.appendChild(_el('span', 's9-risk-acc-name', { textContent: 'Data Protection Impact Assessment' }));
    hdr.appendChild(left);
    const chevron = _el('span', 's9-risk-acc-chevron');
    chevron.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    hdr.appendChild(chevron);
    sec.appendChild(hdr);

    const body = _el('div', 's9-risk-acc-body');

    body.appendChild(_sectionLabel('1 · Control Activation'));
    const dpiaCtrls = _controls.filter(c => c.domain === 'dpia');
    if (dpiaCtrls.length) dpiaCtrls.forEach(c => body.appendChild(_buildActControlCard(c, 'dpia')));
    else body.appendChild(_domainMuted('No security-measure controls were recorded in the DPIA.'));

    body.appendChild(_sectionLabel('2 · Control Testing'));
    body.appendChild(_domainMuted('Not applicable — DPIA controls are not separately test-evidenced.'));

    body.appendChild(_sectionLabel('3 · Residual Risk'));
    const ratings = _el('div', '');
    ratings.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const mkPill = (label, rating) => {
      const col = _config.residual_colors[(rating || '').toLowerCase()] || { bg: '#262219', text: '#8b8574' };
      const w = _el('div', ''); w.style.cssText = 'display:flex;align-items:center;gap:6px';
      w.appendChild(_el('span', '', { textContent: label }));
      const pill = _el('span', ''); pill.style.cssText = `font-size:12px;font-weight:700;padding:2px 10px;border-radius:10px;background:${col.bg};color:${col.text}`;
      pill.textContent = rating || '—';
      w.appendChild(pill);
      return w;
    };
    ratings.appendChild(mkPill('Inherent', step4.inherent_risk_rating));
    ratings.appendChild(mkPill('Residual', step4.residual_risk_rating));
    body.appendChild(ratings);
    body.appendChild(_domainMuted('Residual rating is owned by the Step 4 DPIA. Update it there if it changes.'));

    sec.appendChild(body);
    hdr.addEventListener('click', () => {
      const collapsed = body.classList.toggle('s9-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
    card.appendChild(sec);

    card.appendChild(_buildSaveRow('Save Activation Record', _handleSave));
    return card;
  }

  function _buildTestControlCard(tc, plan, planIdx) {
    const status = _testState.status[tc.pk_Test_Control_ID] || 'not_started';
    const card   = _el('div', 's7-ctrl-card');
    card.dataset.tcId = tc.pk_Test_Control_ID;

    const hdr = _el('div', 's7-ctrl-hdr');
    const srcBadge = _el('span', 's7-src-badge');
    srcBadge.textContent = 'EU AI Act';
    hdr.appendChild(srcBadge);
    const name = _el('span', 's7-ctrl-name');
    name.textContent = tc.jkName;
    hdr.appendChild(name);
    card.appendChild(hdr);

    if (tc.jkObjective) {
      const obj = _el('p', 's7-ctrl-obj');
      obj.textContent = tc.jkObjective;
      card.appendChild(obj);
    }

    const notesWrap = _el('div', 's7-ctrl-notes-wrap');
    const notesLbl  = _el('label', 's7-ctrl-notes-lbl');
    notesLbl.textContent = 'Evidence / Notes';
    notesWrap.appendChild(notesLbl);
    const textarea = document.createElement('textarea');
    textarea.className   = 's7-ctrl-notes';
    textarea.placeholder = 'Add Jira ticket URL or evidence notes…';
    textarea.rows        = 2;
    textarea.value       = _testState.notes[tc.pk_Test_Control_ID] || '';
    textarea.addEventListener('input', () => {
      _testState.notes[tc.pk_Test_Control_ID] = textarea.value;
      if (textarea.value && _testState.status[tc.pk_Test_Control_ID] === 'not_started') {
        _testState.status[tc.pk_Test_Control_ID] = 'in_progress';
        _syncTestCardStatus(card, 'in_progress', plan, planIdx);
      }
    });
    notesWrap.appendChild(textarea);
    card.appendChild(notesWrap);

    const statusRow = _el('div', 's7-ctrl-status-row');
    const statusLbl = _el('span', 's7-ctrl-status-lbl');
    statusLbl.textContent = 'Status';
    statusRow.appendChild(statusLbl);

    const sel = document.createElement('select');
    sel.className = 's7-ctrl-status-sel';
    _config.status_options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      if (opt.value === status) o.selected = true;
      sel.appendChild(o);
    });

    const pill = _el('span', `s7-ctrl-pill s7-ctrl-pill--${status}`);
    pill.textContent = _config.status_options.find(o => o.value === status)?.label || status;

    sel.addEventListener('change', () => {
      _testState.status[tc.pk_Test_Control_ID] = sel.value;
      _syncTestCardStatus(card, sel.value, plan, planIdx);
      if (plan.risk_id) _syncResidualPanel(plan.risk_id);
    });

    statusRow.appendChild(sel);
    statusRow.appendChild(pill);
    card.appendChild(statusRow);
    return card;
  }

  function _syncTestCardStatus(card, status, plan, planIdx) {
    const pill = card.querySelector('.s7-ctrl-pill');
    if (pill) {
      pill.className   = `s7-ctrl-pill s7-ctrl-pill--${status}`;
      pill.textContent = _config.status_options.find(o => o.value === status)?.label || status;
    }
    const sel = card.querySelector('.s7-ctrl-status-sel');
    if (sel) sel.value = status;
  }

  // ===========================================================
  function _actProgressCounts() {
    const evidenced = _controls.filter(c =>
      _actState[c.key]?.status === 'evidence_provided' || _actState[c.key]?.status === 'waived'
    ).length;
    return { evidenced, total: _controls.length };
  }

  function _updateActProgress() {
    const { evidenced, total } = _actProgressCounts();
    const pct = total ? Math.round((evidenced / total) * 100) : 0;
    const countEl = _container.querySelector('#s7a-progress-count');
    const fillEl  = _container.querySelector('#s7a-progress-fill');
    if (countEl) countEl.textContent = `${evidenced} / ${total} controls evidenced`;
    if (fillEl)  fillEl.style.width  = pct + '%';
  }

  function _buildActControlCard(ctrl, sourceType) {
    const card = _el('div', 's9-ctrl-card');
    card.dataset.key = ctrl.key;
    const st   = _actState[ctrl.key] || { notes: '', status: 'not_started' };
    const isFS = (ctrl.source || '').includes('Framework');

    const hdr = _el('div', 's9-ctrl-hdr');
    const srcBadge = _el('span', `s9-src-badge s9-src-badge--${isFS ? 'framework' : sourceType}`);
    srcBadge.textContent = isFS ? 'Self-certified' : sourceType === 'eu' ? 'EU AI Act' : sourceType === 'dpia' ? 'DPIA' : 'Compliance';
    hdr.appendChild(srcBadge);
    const name = _el('span', 's9-ctrl-name');
    name.textContent = ctrl.name;
    hdr.appendChild(name);
    card.appendChild(hdr);

    if (ctrl.objective) {
      const objWrap = _el('div', 's9-obj-wrap');
      const objLbl  = _el('span', 's9-field-label'); objLbl.textContent = 'Objective';
      const objText = _el('p', 's9-ctrl-obj'); objText.textContent = ctrl.objective;
      objWrap.appendChild(objLbl); objWrap.appendChild(objText);
      card.appendChild(objWrap);
    }

    const notesWrap = _el('div', 's9-notes-wrap');
    const notesLbl  = _el('label', 's9-field-label'); notesLbl.textContent = 'Evidence / Notes';
    const textarea  = document.createElement('textarea');
    textarea.className   = 's9-ctrl-notes';
    textarea.placeholder = 'Paste Jira ticket URL, PR link, or describe the evidence…';
    textarea.value       = st.notes;
    textarea.rows        = 3;
    textarea.addEventListener('input', () => {
      _actState[ctrl.key].notes = textarea.value;
      if (textarea.value.trim() && _actState[ctrl.key].status === 'not_started') {
        _actState[ctrl.key].status = 'in_progress';
        _syncActCard(card, 'in_progress');
        _updateActProgress();
      }
    });
    notesWrap.appendChild(notesLbl); notesWrap.appendChild(textarea);
    card.appendChild(notesWrap);

    const statusWrap = _el('div', 's9-status-wrap');
    const statusLbl  = _el('label', 's9-field-label'); statusLbl.textContent = 'Status';
    const select     = document.createElement('select');
    select.className = 's9-status-select';
    _config.status_options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      if (opt.value === st.status) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => {
      _actState[ctrl.key].status = select.value;
      _syncActCard(card, select.value);
      _updateActProgress();
      if (ctrl.risk_id) _syncResidualPanel(ctrl.risk_id);
    });
    const pill = _el('span', 's9-status-pill');
    _applyActPillStyle(pill, st.status);
    statusWrap.appendChild(statusLbl); statusWrap.appendChild(select); statusWrap.appendChild(pill);
    card.appendChild(statusWrap);
    return card;
  }

  function _syncActCard(cardEl, status) {
    const pill = cardEl.querySelector('.s9-status-pill');
    if (pill) _applyActPillStyle(pill, status);
    const sel = cardEl.querySelector('.s9-status-select');
    if (sel) sel.value = status;
  }

  // ---- HS-requirement activation card (Legal/Regulatory tab) --
  function _buildHsActCard(riskId, ref) {
    const key = _hsActKey(riskId, ref);
    const fsStmt = _fsByRef.get(_canonRef(ref)) || '';
    if (!_hsActState[key]) _hsActState[key] = { status: 'not_started', notes: fsStmt };
    const st = _hsActState[key];
    const h  = _hsByRef.get(ref);
    // True when the current note is exactly the framework statement (i.e. the
    // assessor hasn't edited it yet) — drives the "pre-filled" hint below.
    const prefilledFromFs = !!fsStmt && String(st.notes || '').trim() === fsStmt.trim();

    const card = _el('div', 's9-ctrl-card');
    const hdr  = _el('div', 's9-ctrl-hdr');
    hdr.appendChild(_el('span', 's9-src-badge s9-src-badge--eu', { textContent: WizUtils.fmtStdRef(ref) }));
    hdr.appendChild(_el('span', 's9-ctrl-name', { textContent: h?.standard_name || ref }));
    card.appendChild(hdr);

    if (h?.standard_text) {
      const objWrap = _el('div', 's9-obj-wrap');
      objWrap.appendChild(_el('span', 's9-field-label', { textContent: 'Requirement' }));
      objWrap.appendChild(_el('p', 's9-ctrl-obj', { textContent: h.standard_text }));
      card.appendChild(objWrap);
    }

    // What evidence to ask for depends on how the requirement is verified.
    const ctype = h?.coverage_type || 'Test';
    const tests = _tcByHsRef.get(ref) || [];
    let evLabel = 'Evidence / Notes';
    let evPlaceholder = 'Describe how this requirement is implemented and evidenced…';

    if (ctype === 'Test' && tests.length) {
      // The test proves the requirement operates as expected — ask for its result.
      const tWrap = _el('div', 's9-obj-wrap');
      tWrap.appendChild(_el('span', 's9-field-label', { textContent: tests.length > 1 ? 'Verification tests' : 'Verification test' }));
      tests.forEach(tc => {
        const line = _el('div', ''); line.style.margin = '6px 0';
        line.appendChild(_el('span', 's9-src-badge s9-src-badge--framework', { textContent: WizUtils.fmtStdRef(tc.control_ref) }));
        line.appendChild(_el('span', 's9-ctrl-name', { textContent: ' ' + (tc.jkName || '') }));
        if (tc.jkObjective) line.appendChild(_el('p', 's9-ctrl-obj', { textContent: tc.jkObjective }));
        tWrap.appendChild(line);
      });
      card.appendChild(tWrap);
      evLabel = 'Test result';
      evPlaceholder = 'Record the outcome and attach the test report or link proving the test passed…';
    } else if (ctype === 'Document') {
      evLabel = 'Document reference';
      evPlaceholder = 'Reference the external document that evidences this requirement (title, version, link)…';
    } else if (ctype === 'Workflow') {
      card.appendChild(_domainMuted('Evidenced by the governance workflow. Add a pointer to the relevant step or record if needed.'));
      evLabel = 'Evidence pointer';
      evPlaceholder = 'Optional — point to the workflow step or record that evidences this requirement…';
    }

    const notesWrap = _el('div', 's9-notes-wrap');
    notesWrap.appendChild(_el('label', 's9-field-label', { textContent: evLabel }));
    if (prefilledFromFs) {
      notesWrap.appendChild(_el('p', 's9-fs-prefill-hint', {
        textContent: 'Pre-filled from the framework self-certification shown in Step 6 — edit or confirm.'
      }));
    }
    const ta = document.createElement('textarea');
    ta.className = 's9-ctrl-notes'; ta.rows = prefilledFromFs ? 4 : 3; ta.value = st.notes;
    ta.placeholder = evPlaceholder;
    ta.addEventListener('input', () => {
      _hsActState[key].notes = ta.value;
      if (ta.value.trim() && _hsActState[key].status === 'not_started') {
        _hsActState[key].status = 'in_progress';
        _syncHsCard(card, 'in_progress');
        _deriveActFromHs(); _updateActProgress();
      }
    });
    notesWrap.appendChild(ta);
    card.appendChild(notesWrap);

    const statusWrap = _el('div', 's9-status-wrap');
    statusWrap.appendChild(_el('label', 's9-field-label', { textContent: 'Status' }));
    const select = document.createElement('select'); select.className = 's9-status-select';
    _config.status_options.forEach(opt => {
      const o = document.createElement('option'); o.value = opt.value; o.textContent = opt.label;
      if (opt.value === st.status) o.selected = true; select.appendChild(o);
    });
    select.addEventListener('change', () => {
      _hsActState[key].status = select.value;
      _syncHsCard(card, select.value);
      _deriveActFromHs(); _updateActProgress();
      _syncResidualPanel(riskId);
    });
    const pill = _el('span', 's9-status-pill'); _applyActPillStyle(pill, st.status);
    statusWrap.appendChild(select); statusWrap.appendChild(pill);
    card.appendChild(statusWrap);
    return card;
  }

  function _syncHsCard(cardEl, status) {
    const pill = cardEl.querySelector('.s9-status-pill'); if (pill) _applyActPillStyle(pill, status);
    const sel = cardEl.querySelector('.s9-status-select'); if (sel) sel.value = status;
  }

  function _applyActPillStyle(el, status) {
    const opt = _config.status_options.find(o => o.value === status);
    const col = _config.status_colors[status] || _config.status_colors.not_started;
    el.textContent      = opt?.label || status;
    el.style.background = col.bg;
    el.style.color      = col.text;
  }

  // ===========================================================
  // TAB 3 — RESIDUAL RISK
  // ---- Shared: residual risk complete check ------------------
  function _isRiskGroupComplete(riskId) {
    // Legal/Regulatory risks: residual unlocks once the risk's HS requirements
    // are activated (evidenced or waived) — there is no test section.
    if (_isLegalRisk(riskId)) {
      const refs = _legalRiskHsRefs(riskId);
      return refs.length === 0 || refs.every(ref => {
        const s = _hsActState[_hsActKey(riskId, ref)]?.status;
        return s === 'evidence_provided' || s === 'waived';
      });
    }
    // Tests: all test controls for this risk must be evidenced/waived
    const plan = _planData.find(p => p.risk_id === riskId);
    const testsDone = !plan || plan.test_controls.length === 0 || plan.test_controls.every(tc =>
      _testState.status[tc.pk_Test_Control_ID] === 'evidence_provided' ||
      _testState.status[tc.pk_Test_Control_ID] === 'waived'
    );
    // Activation: all activation controls for this risk must be evidenced/waived
    const actCtrls = _controls.filter(c => c.risk_id === riskId);
    const actDone  = actCtrls.length === 0 || actCtrls.every(c =>
      _actState[c.key]?.status === 'evidence_provided' ||
      _actState[c.key]?.status === 'waived'
    );
    return testsDone && actDone;
  }

  function _syncResidualPanel(riskId) {
    const panel = _container.querySelector(`[data-residual-risk="${riskId}"]`);
    if (!panel) return;
    const complete = _isRiskGroupComplete(riskId);
    panel.classList.toggle('s9-residual--locked', !complete);
    panel.querySelectorAll('select, textarea').forEach(el => { el.disabled = !complete; });
    const note = panel.querySelector('.s9-residual-lock-note');
    if (note) note.style.display = complete ? 'none' : '';
  }

  function _buildResidualPanel(riskId) {
    const complete = _isRiskGroupComplete(riskId);
    const saved    = _residualState[riskId] || { likelihood: '', impact: '', justification: '' };

    const panel = _el('div', `s9-residual${complete ? '' : ' s9-residual--locked'}`);
    panel.dataset.residualRisk = riskId;

    const hdr  = _el('div', 's9-residual-hdr');
    const ttl  = _el('span', 's9-residual-title'); ttl.textContent = 'Residual Risk Assessment';
    const note = _el('span', 's9-residual-lock-note');
    note.textContent   = 'Unlocks once this risk’s requirements are evidenced or waived';
    note.style.display = complete ? 'none' : '';
    hdr.appendChild(ttl); hdr.appendChild(note);
    panel.appendChild(hdr);

    const row    = _el('div', 's9-residual-row');
    const LEVELS = ['', 'low', 'medium', 'high', 'critical'];
    const levelPill = _el('span', 's9-residual-level-pill');
    _applyResidualLevel(levelPill, saved.likelihood, saved.impact);

    const mkSel = (lbl, currentVal, onChange) => {
      const wrap = _el('div', 's9-residual-field');
      const l    = _el('label', 's9-field-label'); l.textContent = lbl;
      const sel  = document.createElement('select');
      sel.className = 's9-residual-select';
      sel.disabled  = !complete;
      LEVELS.forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v ? v.charAt(0).toUpperCase() + v.slice(1) : '— Select —';
        if (v === currentVal) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => onChange(sel.value));
      wrap.appendChild(l); wrap.appendChild(sel);
      return wrap;
    };

    row.appendChild(mkSel('Likelihood', saved.likelihood, v => {
      _residualState[riskId].likelihood = v;
      _applyResidualLevel(levelPill, _residualState[riskId].likelihood, _residualState[riskId].impact);
    }));
    row.appendChild(mkSel('Impact', saved.impact, v => {
      _residualState[riskId].impact = v;
      _applyResidualLevel(levelPill, _residualState[riskId].likelihood, _residualState[riskId].impact);
    }));

    const lvlWrap = _el('div', 's9-residual-field');
    const lvlLbl  = _el('label', 's9-field-label'); lvlLbl.textContent = 'Risk Level';
    lvlWrap.appendChild(lvlLbl); lvlWrap.appendChild(levelPill);
    row.appendChild(lvlWrap);
    panel.appendChild(row);

    const jWrap = _el('div', 's9-residual-just');
    const jLbl  = _el('label', 's9-field-label'); jLbl.textContent = 'Justification';
    const jArea = document.createElement('textarea');
    jArea.className   = 's9-ctrl-notes';
    jArea.placeholder = 'Explain why residual risk is acceptable given the controls in place…';
    jArea.rows        = 2;
    jArea.value       = saved.justification;
    jArea.disabled    = !complete;
    jArea.addEventListener('input', () => { _residualState[riskId].justification = jArea.value; });
    jWrap.appendChild(jLbl); jWrap.appendChild(jArea);
    panel.appendChild(jWrap);

    return panel;
  }

  function _applyResidualLevel(el, likelihood, impact) {
    if (!likelihood || !impact) {
      el.textContent = '—'; el.style.background = '#262219'; el.style.color = '#8b8574'; return;
    }
    const level = _config.risk_matrix[likelihood]?.[impact] || '';
    const col   = _config.residual_colors[level] || { bg: '#262219', text: '#8b8574' };
    el.textContent      = level ? level.charAt(0).toUpperCase() + level.slice(1) : '—';
    el.style.background = col.bg;
    el.style.color      = col.text;
  }

  // ===========================================================
  // SHARED SAVE
  // ===========================================================
  function _buildSaveRow(label, handler) {
    const row = _el('div', 'wiz-action-row');
    const btn = document.createElement('button');
    btn.className = 'wiz-btn-primary';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> ${label}`;
    btn.addEventListener('click', handler);
    row.appendChild(btn);
    return row;
  }

  function _handleSave() {
    const rec = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-7'] = rec;
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 7 saved ✓');
    _renderSaveResults(rec);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};

    // Test plans (Tab 1)
    const plans = _planData.map(p => ({
      plan_ref:      p.risk_id,
      plan_name:     p.risk_name,
      risk_name:     p.risk_name,
      test_controls: p.test_controls.map(tc => ({
        test_control_id:            tc.pk_Test_Control_ID,
        control_ref:                tc.control_ref || '',
        control_name:               tc.jkName      || '',
        fk_Harmonised_Standard_IDs: tc.fk_Harmonised_Standard_IDs || '',
        notes:                      _testState.notes[tc.pk_Test_Control_ID]  || '',
        status:                     _testState.status[tc.pk_Test_Control_ID] || 'not_started'
      }))
    }));
    const allTests   = plans.reduce((a, p) => a.concat(p.test_controls), []);
    const evidTests  = allTests.filter(t => t.status === 'evidence_provided').length;
    const waivedTests = allTests.filter(t => t.status === 'waived').length;
    const pendTests  = allTests.length - evidTests - waivedTests;

    // Activation controls (Tab 2)
    const controls = _controls.map(c => ({
      key:       c.key,
      name:      c.name,
      objective: c.objective,
      source:    c.source,
      risk_id:   c.risk_id,
      risk_name: c.risk_name,
      notes:     _actState[c.key]?.notes  || '',
      status:    _actState[c.key]?.status || 'not_started'
    }));
    const { evidenced, total } = _actProgressCounts();

    // Legal HS-requirement activation — the treatment unit for legal risks
    const hs_activation = {};
    Object.keys(_hsActState).forEach(k => {
      const i = k.indexOf('::'); if (i < 0) return;
      const riskId = k.slice(0, i), ref = k.slice(i + 2);
      const st = _hsActState[k];
      if (st && (st.status !== 'not_started' || st.notes)) {
        (hs_activation[riskId] = hs_activation[riskId] || {})[ref] = { status: st.status, notes: st.notes || '' };
      }
    });

    // Residual risk (Tab 3)
    const residual_risks = {};
    Object.entries(_residualState).forEach(([riskId, rr]) => {
      if (rr.likelihood && rr.impact) {
        residual_risks[riskId] = {
          likelihood:    rr.likelihood,
          impact:        rr.impact,
          level:         _config.risk_matrix[rr.likelihood]?.[rr.impact] || '',
          justification: rr.justification || ''
        };
      }
    });

    return {
      step_id:                 'step-7',
      step_title:              'Residual risk',
      assessment_date:         today,
      assessed_by:             meta.assessed_by || '',
      use_case_id:             meta.use_case_id || '',
      // Tests
      total_tests:             allTests.length,
      evidence_provided_tests: evidTests,
      waived_tests:            waivedTests,
      pending_tests:           pendTests,
      plans,
      uncovered_controls: _uncovered.map(rc => ({
        control_id:     rc.control_id,
        control_name:   rc.control_name,
        control_source: rc.control_source
      })),
      // Activation
      total_controls:          total,
      evidenced_count:         evidenced,
      controls,
      // Legal HS-requirement activation
      hs_activation,
      // Residual
      residual_risks
    };
  }

  function _renderSaveResults(rec) {
    const area = _container.querySelector('.s7-shared-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'wiz10-result-card');
    const h    = _el('h3', 'wiz10-result-title'); h.textContent = 'Residual Risk Step Saved'; card.appendChild(h);
    const stats = _el('div', 'wiz10-result-stats');
    [
      [rec.total_tests,             'Total tests'],
      [rec.evidence_provided_tests, 'Tests evidenced'],
      [rec.total_controls,          'Total controls'],
      [rec.evidenced_count,         'Controls evidenced'],
      [Object.keys(rec.residual_risks).length, 'Residual risks recorded']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num); s.appendChild(n);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl;         s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    WizUtils.injectStyles('wiz7-base-styles', `
.wiz-shell{display:flex;flex-direction:column;height:100%}
.wiz-tab-strip{display:flex;gap:2px;padding:14px 24px 0;border-bottom:1px solid var(--color-border);background:var(--color-surface)}
.wiz-tab{padding:8px 16px;font-size:12px;font-weight:500;background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--color-text-secondary);font-family:inherit;transition:color .15s,border-color .15s;white-space:nowrap}
.wiz-tab:hover{color:var(--color-text-primary)}
.wiz-tab--active{color:var(--teal-600,#8ce3c6);border-bottom-color:var(--teal-600,#8ce3c6)}
.wiz-pane-wrap{flex:1;overflow-y:auto}
.wiz-pane{padding:24px;min-height:100%}
.wiz-pane--hidden{display:none}
.wiz-action-row{display:flex;gap:10px;margin-top:24px}
.wiz-btn-primary{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:var(--teal-600,#8ce3c6);color:#241d08;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:background .15s}
.wiz-btn-primary:hover{background:var(--teal-700,#8ce3c6)}
`);
    WizUtils.injectStyles('wiz10-styles', `
/* ---- Tab 1: test control card styles ---- */
.s7-src-badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:rgba(80,150,225,0.16);color:#a4ccf6;white-space:nowrap;flex-shrink:0}
.s7-ctrl-card{padding:14px 16px;border-bottom:1px solid var(--color-border)}
.s7-ctrl-card:last-child{border-bottom:none}
.s7-ctrl-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.s7-ctrl-name{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.s7-ctrl-obj{font-size:12px;color:var(--color-text-secondary);line-height:1.5;margin:0 0 10px}
.s7-ctrl-notes-wrap{margin-bottom:10px}
.s7-ctrl-notes-lbl{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin-bottom:4px}
.s7-ctrl-notes{width:100%;box-sizing:border-box;padding:8px 10px;font-size:12px;font-family:inherit;border:1px solid var(--color-border);border-radius:6px;resize:vertical;color:var(--color-text-primary);background:var(--color-bg,#fff);line-height:1.5}
.s7-ctrl-notes:focus{outline:none;border-color:var(--teal-500,#d4b860);box-shadow:0 0 0 2px rgba(20,184,166,.15)}
.s7-ctrl-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.s7-ctrl-status-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary)}
.s7-ctrl-status-sel{padding:4px 8px;font-size:12px;font-family:inherit;border:1px solid var(--color-border);border-radius:5px;background:var(--color-bg,#fff);color:var(--color-text-primary);cursor:pointer}
.s7-ctrl-status-sel:focus{outline:none;border-color:var(--teal-500,#d4b860)}
.s7-ctrl-pill{font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;white-space:nowrap}
.s7-ctrl-pill--not_started{background:#262219;color:#b1a992}
.s7-ctrl-pill--in_progress{background:rgba(212,184,96,0.16);color:#ecd489}
.s7-ctrl-pill--evidence_provided{background:rgba(52,199,120,0.16);color:#8cebb0}
.s7-ctrl-pill--waived{background:rgba(138,130,235,0.16);color:#bfb8ff}

/* ---- Shared plan/list styles ---- */
.wiz10-intro{font-size:13px;color:var(--color-text-secondary);margin-bottom:16px;line-height:1.6}
.wiz10-warn{background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:8px;padding:12px 16px;font-size:13px;color:#f3ab8a;margin-bottom:16px}
.wiz10-info{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:6px;padding:10px 14px;font-size:12px;color:#a4ccf6;margin-bottom:8px}
.wiz10-source-card{background:var(--color-bg-subtle,#211d15);border:1px solid var(--color-border);border-radius:8px;padding:14px 16px;margin-bottom:20px}
.wiz10-source-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-tertiary);margin:0 0 10px}
.wiz10-source-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.wiz10-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz10-cell-label{font-size:10px;color:var(--color-text-tertiary);font-weight:500;text-transform:uppercase;letter-spacing:.04em}
.wiz10-cell-value{font-size:18px;font-weight:700;color:var(--color-text-primary)}
.wiz10-cell-value--num{color:var(--teal-600,#8ce3c6)}
.wiz10-cell-value--warn{color:#e0b94a}
.wiz10-cell-value--ok{color:#6ee79f}
.wiz10-val-wrap{margin-bottom:16px}
.wiz10-val-ok{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(52,199,120,0.16);border:1px solid rgba(52,199,120,0.40);border-radius:6px;font-size:12px;color:#8cebb0;font-weight:500}
.wiz10-val-info{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:6px;font-size:12px;color:#a4ccf6}
.wiz10-plan-list{display:flex;flex-direction:column;gap:16px;margin-bottom:20px}
.wiz10-plan-sec{background:var(--color-bg,#fff);border:1px solid var(--color-border);border-radius:10px;overflow:hidden}
.wiz10-plan-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#211d15);border-bottom:1px solid var(--color-border);cursor:pointer;user-select:none;gap:10px}
.wiz10-plan-hdr:hover{background:var(--color-bg-hover,#262219)}
.wiz10-plan-hdr-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.wiz10-plan-hdr-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz10-plan-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz10-collapsed{display:none!important}
.wiz10-ctrl-list{display:flex;flex-direction:column;gap:1px;padding:0}
.wiz10-uncovered-sec{background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:10px;padding:14px 16px;margin-bottom:20px}
.wiz10-uncovered-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.wiz10-unc-icon{color:#e0b94a;display:flex;align-items:center}
.wiz10-unc-title{font-size:13px;font-weight:600;color:#ecd489}
.wiz10-unc-note{font-size:12px;color:#ecd489;margin:0 0 12px;line-height:1.5}
.wiz10-unc-list{display:flex;flex-direction:column;gap:6px}
.wiz10-unc-item{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--color-surface);border:1px solid rgba(224,120,80,0.40);border-radius:6px;flex-wrap:wrap}
.wiz10-unc-ctrl-name{font-size:12px;font-weight:500;color:var(--color-text-primary)}
.s7-shared-results{margin-top:24px}
.wiz10-result-card{background:var(--color-bg-subtle,#211d15);border:1px solid var(--color-border);border-radius:10px;padding:20px 24px}
.wiz10-result-title{font-size:15px;font-weight:700;color:var(--color-text-primary);margin:0 0 16px}
.wiz10-result-stats{display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap}

/* ---- Tab 2: activation styles (s9-* prefix) ---- */
.s9-warn{padding:14px 18px;background:rgba(212,184,96,0.16);border:1px solid #e0b94a;border-radius:8px;font-size:13px;color:#ecd489;margin:16px 0}
.s9-progress-wrap{margin:20px 0 24px;padding:14px 18px;background:var(--color-bg-secondary,#211d15);border:1px solid var(--color-border);border-radius:8px}
.s9-progress-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.s9-progress-lbl{font-size:12px;font-weight:600;color:var(--color-text-secondary)}
.s9-progress-count{font-size:12px;font-weight:700;color:var(--color-text-primary)}
.s9-progress-track{height:8px;background:var(--color-border);border-radius:4px;overflow:hidden}
.s9-progress-fill{height:100%;background:#8ce3c6;border-radius:4px;transition:width .3s ease}
.s9-risk-acc{border:1px solid var(--color-border);border-radius:8px;overflow:hidden;margin-bottom:10px}
.s9-risk-acc-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none;gap:8px}
.s9-risk-acc-hdr:hover{background:var(--color-bg-hover,#262219)}
.s9-risk-acc-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.s9-risk-acc-id{font-size:10px;font-weight:700;background:rgba(80,150,225,0.16);color:#a4ccf6;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0}
.s9-risk-acc-name{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.s9-risk-acc-count{font-size:11px;font-weight:500;color:var(--color-text-secondary);white-space:nowrap}
.s9-risk-acc-count--ok{color:#6ee79f;font-weight:700}
.s9-risk-acc-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.s9-risk-acc-body{padding:14px;display:flex;flex-direction:column;gap:0}
.s9-collapsed{display:none!important}
.s9-ctrl-card{border:1px solid var(--color-border);border-radius:8px;padding:14px 16px;margin-bottom:10px;background:var(--color-bg)}
.s9-ctrl-hdr{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.s9-ctrl-name{font-size:13px;font-weight:600;color:var(--color-text-primary);flex:1}
.s9-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;margin-top:2px}
.s9-src-badge--eu{background:rgba(80,150,225,0.16);color:#a4ccf6}
.s9-src-badge--compliance{background:rgba(138,130,235,0.16);color:#bfb8ff}
.s9-src-badge--dpia{background:rgba(93,202,165,0.16);color:#8ce3c6}
.s9-src-badge--framework{background:rgba(212,184,96,0.16);color:#ecd489}
.s9-obj-wrap{margin-bottom:10px}
.s9-field-label{display:block;font-size:11px;font-weight:600;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.s9-ctrl-obj{font-size:12px;color:var(--color-text-secondary);margin:0;line-height:1.5}
.s9-notes-wrap{margin-bottom:10px}
.s9-fs-prefill-hint{font-size:11px;color:#ecd489;margin:0 0 6px;line-height:1.4}
.s9-ctrl-notes{width:100%;padding:8px 10px;border:1px solid var(--color-border-mid,rgba(240,232,208,0.30));border-radius:6px;font-size:12px;font-family:inherit;color:var(--color-text-primary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.5}
.s9-ctrl-notes:focus{outline:none;border-color:#8ce3c6;box-shadow:0 0 0 2px rgba(13,148,136,.15)}
.s9-status-wrap{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.s9-status-select{padding:5px 8px;border:1px solid var(--color-border-mid,rgba(240,232,208,0.30));border-radius:6px;font-size:12px;color:var(--color-text-primary);background:var(--color-bg);cursor:pointer}
.s9-status-pill{font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;white-space:nowrap}
.s9-result-card{margin-top:20px;padding:16px 20px;background:var(--color-bg-secondary,#211d15);border:1px solid var(--color-border);border-radius:8px}
.s9-result-title{font-size:14px;font-weight:700;color:var(--color-text-primary);margin:0 0 12px}

/* ---- Tab 3: residual styles ---- */
.s9-residual{margin:12px 0 0;padding:12px 14px;border:1px solid rgba(93,202,165,0.45);border-radius:8px;background:rgba(93,202,165,0.10)}
.s9-residual--locked{background:#211d15;border-color:#2e2a1f;opacity:.75;pointer-events:none}
.s9-residual--locked .s9-residual-title{color:var(--color-text-tertiary)}
.s9-residual-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.s9-residual-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8ce3c6}
.s9-residual-lock-note{font-size:10px;color:var(--color-text-tertiary);font-style:italic}
.s9-residual-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}
.s9-residual-field{display:flex;flex-direction:column;gap:4px}
.s9-residual-select{padding:5px 8px;border:1px solid var(--color-border-mid,rgba(240,232,208,0.30));border-radius:5px;font-size:12px;font-family:inherit;background:var(--color-bg,#fff);color:var(--color-text-primary);cursor:pointer;min-width:120px}
.s9-residual-select:disabled{background:var(--color-bg-subtle,#211d15);cursor:default}
.s9-residual-level-pill{display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;text-align:center;min-width:70px}
.s9-residual-just{margin-top:0}
    `);
  }

})();
