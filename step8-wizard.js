/* Step 8 — Risk Assessment Wizard (Guided)
   Grouping: article.StepName → risks → Attack Vectors (each risk appears exactly once)
   Guidance (analogues, applies-if, relevance, categories) loaded from step8-legal-risk-guidance.json and step8-technical-risk-guidance.json.
   Selection at risk level. Identity from central _meta.
   Informed by Step 3 (RCN filter + relevance) and Step 7 (DPIA data types + relevance).
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _framework = null, _legalGuidance = null, _techGuidance = null, _record = null;
  let _step3Data = null, _step7Data = null;
  let _filteredFGItems = []; // [{groupName, risks:[...]}]

  const _state = {
    technical_risks: {},  // pk_Risk_ID → boolean (OWASP risks from tbl_Risks.json)
    legal_risks:     {},  // riskName → boolean  (EU AI Act risks from guidance)
  };

  // Guided wizard state
  const _wizState = {
    step_index: 0,      // current question index (0-based)
    answers:    {},     // riskName → 'yes'|'partially'|'no'
    complete:   false
  };

  let _diagData = null; // { risks, controls, tasks } loaded from tbl_* files
  const _diagState = { selectedBox: null };

  // Category color palette — maps JSON color keys to CSS values
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

  // ---- Public API ---------------------------------------------
  window.mountStep8Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _framework     = null;
    _legalGuidance = null;
    _techGuidance  = null;
    _record        = null;
    _step3Data  = null;
    _step7Data  = null;
    _filteredFGItems = [];
    _state.technical_risks = {};
    _state.legal_risks     = {};
    _wizState.step_index = 0;
    _wizState.answers    = {};
    _wizState.complete   = false;
    _diagData = null;
    _diagState.selectedBox = null;

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
    // Load framework, guidance files, and diagram data in parallel
    const [fwRes, lgdRes, tgdRes, risksRes, ctrlsRes, tasksRes] = await Promise.allSettled([
      fetch('ai_Risk_Control_Framework.json'),
      fetch('step8-legal-risk-guidance.json'),
      fetch('step8-technical-risk-guidance.json'),
      fetch('tbl_Risks.json'),
      fetch('tbl_Risk_Controls.json'),
      fetch('tbl_Control_Task_Code.json')
    ]);

    if (fwRes.status === 'rejected' || !fwRes.value.ok) {
      pw.innerHTML = `<p style="padding:24px;color:var(--danger-600,#dc2626)">Could not load ai_Risk_Control_Framework.json</p>`;
      return;
    }
    _framework = await fwRes.value.json();

    if (lgdRes.status === 'fulfilled' && lgdRes.value.ok) {
      try { _legalGuidance = await lgdRes.value.json(); } catch (_) {}
    }
    if (tgdRes.status === 'fulfilled' && tgdRes.value.ok) {
      try { _techGuidance = await tgdRes.value.json(); } catch (_) {}
    }

    if (risksRes.status === 'fulfilled' && risksRes.value.ok &&
        ctrlsRes.status === 'fulfilled' && ctrlsRes.value.ok &&
        tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
      try {
        const [risks, controls, tasks] = await Promise.all([
          risksRes.value.json(),
          ctrlsRes.value.json(),
          tasksRes.value.json()
        ]);
        _diagData = { risks, controls, tasks };
      } catch (_) {}
    }

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

    _step3Data = _record?.['step-3'] ?? null;
    _step7Data = _record?.['step-7'] ?? null;

    // Restore prior selections + wizard answers (additive — never overwrites sibling sub-object)
    const saved8 = _record?.['step-8'];
    if (saved8?.technical_assessment?.risks) {
      saved8.technical_assessment.risks.forEach(r => {
        _state.technical_risks[r.risk_id] = r.selected;
      });
    }
    if (saved8?.legal_assessment?.risks) {
      saved8.legal_assessment.risks.forEach(r => {
        _state.legal_risks[r.risk_name] = r.selected;
      });
    }
    if (saved8?.legal_assessment?.wizard_answers) {
      Object.assign(_wizState.answers, saved8.legal_assessment.wizard_answers);
      const wqs = _legalGuidance?.wizard_questions;
      if (wqs && Object.keys(_wizState.answers).length >= wqs.length) {
        _wizState.complete = true;
      }
    }

    _filteredFGItems = _buildFGItems();

    // Default: select all OWASP risks if no prior technical state
    if (_diagData && Object.keys(_state.technical_risks).length === 0) {
      _diagData.risks
        .filter(r => r.risk_source === 'OWASP')
        .forEach(r => { _state.technical_risks[r.pk_Risk_ID] = true; });
    }
    // Default: select all legal risks if no prior legal state
    if (Object.keys(_state.legal_risks).length === 0) {
      _filteredFGItems.forEach(fg =>
        fg.risks.forEach(r => { _state.legal_risks[r.jkName] = true; })
      );
    }

    _renderPanes(pw);
  }

  // ---- Build StepName → risks structure ----------------------
  // Groups risks by their parent article's StepName.
  // Each risk belongs to exactly one StepName — no repetition.
  function _buildFGItems() {
    if (!_framework) return [];

    const applicable = _step3Data?.all_requirement_control_numbers
      ? new Set(_step3Data.all_requirement_control_numbers) : null;

    const groupMap = new Map(); // StepName → [riskObj, ...]

    for (const section of Object.values(_framework)) {
      if (!Array.isArray(section)) continue;
      for (const article of section) {
        const stepName = article.StepName;
        if (!stepName) continue;

        for (const field of (article.Fields || [])) {
          if (field.jkType !== 'risk') continue;

          // Apply RCN applicability filter from Step 3
          const matchedControls = [];
          for (const ctrl of (field.controls || [])) {
            const rcns = (ctrl.requirement_control_number || '')
              .split(',').map(s => s.trim()).filter(Boolean);
            const isApplicable = applicable ? rcns.some(r => applicable.has(r)) : true;
            if (isApplicable) matchedControls.push(ctrl);
          }
          if (matchedControls.length === 0) continue;

          const attackVectors = matchedControls.map(c => c.jkAttackVector).filter(Boolean);
          const riskObj = {
            jkName:          field.jkName,
            RiskDescription: field.RiskDescription || '',
            role:            field.Role || '',
            attackVectors,
            stepName                          // which standard group this risk belongs to
          };

          if (!groupMap.has(stepName)) groupMap.set(stepName, []);
          const arr = groupMap.get(stepName);
          if (!arr.find(r => r.jkName === riskObj.jkName)) arr.push(riskObj);
        }
      }
    }

    // Sort risks within each group: HIGH relevance first
    return Array.from(groupMap.entries()).map(([groupName, risks]) => ({
      groupName,
      risks: risks.slice().sort((a, b) => {
        const ra = _computeRelevance(a.jkName);
        const rb = _computeRelevance(b.jkName);
        if (ra === rb) return 0;
        return ra === 'high' ? -1 : 1;
      })
    }));
  }

  // ---- Relevance computation (uses step8-legal-risk-guidance.json) ------
  function _computeRelevance(riskName) {
    if (!_legalGuidance) return 'unassessed';
    const g = _legalGuidance.risks?.[riskName];
    if (!g) return 'unassessed';
    if (!_step3Data && !_step7Data) return 'unassessed';

    const rf = g.relevance_factors || {};
    let isHigh = false;

    // Step 3: AI Act outcome
    if (rf.high_if_step3_ai_act_outcome?.length && _step3Data) {
      const outcome = _step3Data.axis_b?.ai_act_outcome || '';
      if (rf.high_if_step3_ai_act_outcome.includes(outcome)) isHigh = true;
    }

    if (_step7Data) {
      const di = _step7Data.data_types_identified || {};

      // Automated decision-making
      if (rf.high_if_step7_automated_decisions_contains?.length) {
        const adm = di.automated_decision_making || '';
        if (rf.high_if_step7_automated_decisions_contains.some(v => adm.includes(v))) isHigh = true;
      }

      // Special-category data (filter out "None" option)
      if (rf.high_if_step7_has_special_categories) {
        const sc = (di.special_category_data || []).filter(x => !x.startsWith('None'));
        if (sc.length > 0) isHigh = true;
      }

      // Standard personal data
      if (rf.high_if_step7_has_personal_data) {
        if ((di.standard_personal_data || []).length > 0) isHigh = true;
      }

      // Training data used (personal data)
      if (rf.high_if_step7_training_data_used) {
        const tdu = di.training_data_use || '';
        if (tdu && !tdu.startsWith('No') && !tdu.startsWith('Not applicable')) isHigh = true;
      }
    }

    return isHigh ? 'high' : 'medium';
  }

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    const strip = _el('div', 'wiz-tab-strip');
    [['diagram', 'RAG Technical Risk Identification'], ['legal', 'Legal/Regulatory Risk Identification'], ['review', 'Combined Review'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
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
    // Always rebuild Combined Review so it reflects latest saved state
    if (id === 'review') {
      const pane = _container.querySelector('[data-pane="review"]');
      if (pane) { pane.innerHTML = ''; pane.appendChild(_buildCombinedReviewPane()); }
    }
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const diag   = _el('div', 'wiz-pane');                  diag.dataset.pane   = 'diagram';
    const legal  = _el('div', 'wiz-pane wiz-pane--hidden'); legal.dataset.pane  = 'legal';
    const review = _el('div', 'wiz-pane wiz-pane--hidden'); review.dataset.pane = 'review';
    const ref    = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane    = 'reference';
    diag.appendChild(_buildDiagramPane());
    legal.appendChild(_buildLegalPane());
    review.appendChild(_buildCombinedReviewPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(diag); pw.appendChild(legal); pw.appendChild(review); pw.appendChild(ref);
  }

  // ---- RAG Diagram: box definitions ---------------------------
  const _DIAGRAM_BOXES = [
    {
      id: 'user_interface',
      label: 'User Interface',
      sublabel: 'Query · Guardrails · Response',
      components: ['Query Processor', 'Input Guardrail', 'Response Interface', 'Output Guardrail', 'Downstream Systems'],
      cssRow: 1, cssColStart: 1, cssColSpan: 2
    },
    {
      id: 'orchestrator_llm',
      label: 'Orchestrator / LLM',
      sublabel: 'Reasoning · Execution · System Prompt',
      components: ['Orchestrator', 'Generator (LLM)', 'System Prompt Manager'],
      cssRow: 2, cssColStart: 1, cssColSpan: 2
    },
    {
      id: 'retriever',
      label: 'Retriever',
      sublabel: 'Context assembly · Embeddings',
      components: ['Retriever', 'Context Assembler', 'Embedding Model'],
      cssRow: 3, cssColStart: 1, cssColSpan: 1
    },
    {
      id: 'api_layer',
      label: 'API / Integration Layer',
      sublabel: 'Gateway · Tools · Rate limits',
      components: ['API Gateway', 'External Tool Interface', 'Rate Limiter'],
      cssRow: 3, cssColStart: 2, cssColSpan: 1
    },
    {
      id: 'vector_store',
      label: 'Vector Store',
      sublabel: 'Semantic index · Embeddings store',
      components: ['Vector Store'],
      cssRow: 4, cssColStart: 1, cssColSpan: 1
    },
    {
      id: 'knowledge_base',
      label: 'Knowledge Base',
      sublabel: 'Documents · Data ingestion',
      components: ['Data Store', 'Data Pipeline'],
      cssRow: 5, cssColStart: 1, cssColSpan: 1
    },
    {
      id: 'external_sources',
      label: 'External Data Sources',
      sublabel: 'Models · Build · Infrastructure',
      components: ['Training Pipeline', 'Model Registry', 'Build Pipeline', 'Container Runtime', 'Infrastructure Layer'],
      cssRow: 5, cssColStart: 2, cssColSpan: 1
    }
  ];

  // ---- RAG Diagram: data helpers ------------------------------
  function _diagGetOwaspIdsForBox(box) {
    if (!_diagData) return new Set();
    const comps = new Set(box.components);
    const ids = new Set();
    _diagData.risks
      .filter(r => r.risk_source === 'OWASP')
      .forEach(r => {
        if ((r.owasp_rag_components || []).some(c => comps.has(c))) ids.add(r.owasp_id);
      });
    return ids;
  }

  function _diagGetRisksForBox(box) {
    if (!_diagData) return [];
    const owaspIds = _diagGetOwaspIdsForBox(box);
    if (owaspIds.size === 0) return [];
    return _diagData.risks.filter(r => r.risk_source === 'OWASP' && owaspIds.has(r.owasp_id));
  }

  function _diagGetControlsForRisk(risk) {
    if (!_diagData) return [];
    return _diagData.controls.filter(c => c.fk_Risk_ID === risk.pk_Risk_ID);
  }

  function _diagGetTasksForControl(ctrl) {
    if (!_diagData) return [];
    return _diagData.tasks.filter(t => t.fk_Risk_Control_ID === ctrl.pk_Risk_Control_ID);
  }

  // ---- RAG Diagram: pane builder ------------------------------
  function _buildDiagramPane() {
    const wrap = _el('div', 'wiz8-diag-wrap');

    // Left panel: interactive diagram
    const left = _el('div', 'wiz8-diag-left');

    const hdr = _el('div', 'wiz8-diag-hdr');
    const hdrTitle = _el('h3', 'wiz8-diag-hdr-title');
    hdrTitle.textContent = 'RAG Architecture — Technical Risk Identification (OWASP LLM Top 10)';
    hdr.appendChild(hdrTitle);
    const hdrSub = _el('p', 'wiz8-diag-hdr-sub');
    hdrSub.textContent = 'Click a component to explore OWASP risks and controls. Check each risk that applies to your system.';
    hdr.appendChild(hdrSub);
    left.appendChild(hdr);

    const grid = _el('div', 'wiz8-diag-grid');
    _DIAGRAM_BOXES.forEach(box => grid.appendChild(_buildDiagBox(box)));
    left.appendChild(grid);

    const legend = _el('div', 'wiz8-diag-legend');
    const legItem = _el('span', 'wiz8-diag-leg-item');
    legItem.innerHTML = `<span class="wiz8-diag-rbadge wiz8-diag-rbadge--demo">5</span>&nbsp;= OWASP risk count`;
    legend.appendChild(legItem);
    left.appendChild(legend);

    // Save row
    const saveRow = _el('div', 'wiz8-tech-save-row');
    const countBadge = _el('span', 'wiz8-tech-count');
    countBadge.id = 'wiz8-tech-count';
    saveRow.appendChild(countBadge);
    const saveBtn = _el('button', 'wiz-btn-primary');
    saveBtn.textContent = 'Save Technical Assessment';
    saveBtn.addEventListener('click', _handleSaveTechnical);
    saveRow.appendChild(saveBtn);
    left.appendChild(saveRow);

    wrap.appendChild(left);

    // Right panel: detail
    const right = _el('div', 'wiz8-diag-right');
    right.id = 'wiz8-diag-detail';
    _renderDiagDetail(right, null);
    wrap.appendChild(right);

    _updateTechCountBadge();
    return wrap;
  }

  function _buildDiagBox(box) {
    const owaspCount = _diagGetOwaspIdsForBox(box).size;
    const isSelected = _diagState.selectedBox === box.id;
    const el = _el('div', `wiz8-diag-box${isSelected ? ' wiz8-diag-box--selected' : ''}`);
    el.dataset.boxId = box.id;
    el.style.gridRow    = String(box.cssRow);
    el.style.gridColumn = `${box.cssColStart} / span ${box.cssColSpan}`;

    const inner = _el('div', 'wiz8-diag-box-inner');
    const nm  = _el('span', 'wiz8-diag-box-name'); nm.textContent  = box.label;
    const sub = _el('span', 'wiz8-diag-box-sub');  sub.textContent = box.sublabel;
    inner.appendChild(nm); inner.appendChild(sub);
    el.appendChild(inner);

    if (owaspCount > 0) {
      const badge = _el('span', 'wiz8-diag-rbadge');
      badge.textContent = String(owaspCount);
      badge.title = `${owaspCount} OWASP risk${owaspCount !== 1 ? 's' : ''}`;
      el.appendChild(badge);
    }

    el.addEventListener('click', () => {
      _diagState.selectedBox = box.id;
      _container.querySelectorAll('.wiz8-diag-box').forEach(b =>
        b.classList.toggle('wiz8-diag-box--selected', b.dataset.boxId === box.id));
      const det = _container.querySelector('#wiz8-diag-detail');
      if (det) _renderDiagDetail(det, box.id);
    });
    return el;
  }

  function _renderDiagDetail(panel, boxId) {
    panel.innerHTML = '';

    if (!boxId) {
      const ph = _el('div', 'wiz8-diag-ph');
      ph.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:.3"><rect x="2" y="3" width="9" height="7" rx="1.5"/><rect x="13" y="3" width="9" height="7" rx="1.5"/><rect x="2" y="14" width="9" height="7" rx="1.5"/><rect x="13" y="14" width="9" height="7" rx="1.5"/></svg>`;
      const msg = _el('p', 'wiz8-diag-ph-msg');
      msg.textContent = 'Click a component in the diagram to explore its OWASP LLM Top 10 risks, controls, and implementation tasks.';
      ph.appendChild(msg);
      panel.appendChild(ph);
      return;
    }

    const box = _DIAGRAM_BOXES.find(b => b.id === boxId);
    if (!box) return;

    // Header
    const hdr = _el('div', 'wiz8-diag-det-hdr');
    const title = _el('h3', 'wiz8-diag-det-title'); title.textContent = box.label;
    hdr.appendChild(title);
    const chips = _el('div', 'wiz8-diag-det-chips');
    box.components.forEach(c => {
      const chip = _el('span', 'wiz8-diag-chip'); chip.textContent = c; chips.appendChild(chip);
    });
    hdr.appendChild(chips);
    panel.appendChild(hdr);

    const risks = _diagGetRisksForBox(box);

    if (risks.length === 0) {
      const empty = _el('p', 'wiz8-diag-det-empty');
      empty.textContent = 'No OWASP risks found for this component.';
      panel.appendChild(empty);
      return;
    }

    const countLine = _el('p', 'wiz8-diag-det-count');
    countLine.textContent = `${risks.length} risk${risks.length !== 1 ? 's' : ''} — click a card to expand controls`;
    panel.appendChild(countLine);

    risks.forEach(risk => panel.appendChild(_buildDiagRiskCard(risk)));
  }

  function _buildDiagRiskCard(risk) {
    const isOwasp = risk.risk_source === 'OWASP';
    const card = _el('div', `wiz8-diag-risk-card${isOwasp ? ' wiz8-diag-risk-card--owasp' : ' wiz8-diag-risk-card--eu'}`);

    // Look up technical guidance for OWASP risks
    const techG     = isOwasp ? _techGuidance?.risks?.[risk.risk_name] : null;
    const category  = techG?.category || null;
    const catColor  = category ? (_techGuidance?.categories?.[category]?.color || 'slate') : 'slate';
    const catColors = _CAT_COLORS[catColor] || _CAT_COLORS.slate;

    const rh = _el('div', 'wiz8-diag-risk-hdr');
    if (isOwasp) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'wiz8-diag-risk-cb';
      cb.dataset.riskId = risk.pk_Risk_ID;
      cb.checked = !!_state.technical_risks[risk.pk_Risk_ID];
      cb.title = 'Mark as applicable to this system';
      cb.addEventListener('change', e => {
        _state.technical_risks[risk.pk_Risk_ID] = e.target.checked;
        _updateTechCountBadge();
      });
      rh.appendChild(cb);
    }
    const srcBadge = _el('span', `wiz8-diag-src-badge${isOwasp ? ' wiz8-diag-src-badge--owasp' : ' wiz8-diag-src-badge--eu'}`);
    srcBadge.textContent = isOwasp ? `OWASP ${risk.owasp_id}` : 'EU AI Act';
    rh.appendChild(srcBadge);
    const rn = _el('span', 'wiz8-diag-risk-name'); rn.textContent = risk.risk_name;
    rh.appendChild(rn);
    if (category) {
      const catTag = _el('span', 'wiz8-cat-tag');
      catTag.textContent = category;
      catTag.style.background = catColors.bg; catTag.style.color = catColors.text;
      rh.appendChild(catTag);
    }
    card.appendChild(rh);

    // Component chips (OWASP only — they have the explicit component list)
    if (isOwasp && risk.owasp_rag_components?.length) {
      const compRow = _el('div', 'wiz8-diag-comp-row');
      risk.owasp_rag_components.forEach(c => {
        const t = _el('span', 'wiz8-diag-comp-tag'); t.textContent = c; compRow.appendChild(t);
      });
      card.appendChild(compRow);
    }

    // Question text (OWASP risks with tech guidance)
    if (techG?.question) {
      const qText = _el('p', 'wiz8-q-text');
      qText.textContent = techG.question;
      card.appendChild(qText);
    }

    // Applies-if conditions (OWASP risks with tech guidance)
    if (techG?.applies_if?.length) {
      const aiWrap  = _el('div', 'wiz8-applies-wrap');
      const aiLabel = _el('p', 'wiz8-applies-label');
      aiLabel.textContent = 'This risk applies if any of:';
      aiWrap.appendChild(aiLabel);
      const aiList = _el('ul', 'wiz8-applies-list');
      techG.applies_if.forEach(cond => {
        const li = _el('li', 'wiz8-applies-item'); li.textContent = cond; aiList.appendChild(li);
      });
      aiWrap.appendChild(aiList);
      card.appendChild(aiWrap);
    }

    // Description (truncated) — shown only as fallback when no tech guidance question is available
    if (risk.risk_description && !techG?.question) {
      const desc = _el('p', 'wiz8-diag-risk-desc');
      const s = risk.risk_description;
      desc.textContent = s.length > 200 ? s.slice(0, 200) + '…' : s;
      card.appendChild(desc);
    }

    return card;
  }

  function _buildDiagCtrlSection(controls) {
    const wrap = _el('div', 'wiz8-diag-ctrl-wrap');
    const hdr  = _el('div', 'wiz8-diag-ctrl-hdr');
    const icon = _el('span', 'wiz8-diag-ctrl-icon');
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    hdr.appendChild(icon);
    const lbl = _el('span', 'wiz8-diag-ctrl-lbl');
    lbl.textContent = `${controls.length} control${controls.length !== 1 ? 's' : ''}`;
    hdr.appendChild(lbl);
    const chv = _el('span', 'wiz8-diag-ctrl-chv');
    chv.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chv.style.transform = 'rotate(-90deg)';
    hdr.appendChild(chv);
    wrap.appendChild(hdr);

    const body = _el('div', 'wiz8-diag-ctrl-body wiz8-collapsed');

    controls.forEach(ctrl => {
      const row = _el('div', 'wiz8-diag-ctrl-row');
      const rh  = _el('div', 'wiz8-diag-ctrl-row-hdr');
      const cid = _el('span', 'wiz8-diag-ctrl-id'); cid.textContent = ctrl.pk_Risk_Control_ID;
      const cnm = _el('span', 'wiz8-diag-ctrl-name'); cnm.textContent = ctrl.jkName || '';
      rh.appendChild(cid); rh.appendChild(cnm);
      row.appendChild(rh);
      if (ctrl.jkObjective) {
        const obj = _el('p', 'wiz8-diag-ctrl-obj'); obj.textContent = ctrl.jkObjective; row.appendChild(obj);
      }
      // Implementation tasks
      const tasks = _diagGetTasksForControl(ctrl);
      if (tasks.length > 0) {
        const tw = _el('div', 'wiz8-diag-tasks');
        const tl = _el('p', 'wiz8-diag-tasks-lbl');
        tl.textContent = `${tasks.length} implementation task${tasks.length !== 1 ? 's' : ''}:`;
        tw.appendChild(tl);
        tasks.forEach(t => {
          const tr = _el('div', 'wiz8-diag-task-row');
          const tn = _el('span', 'wiz8-diag-task-num'); tn.textContent = String(t.task_number || '');
          const tt = _el('p', 'wiz8-diag-task-text'); tt.textContent = t.task || '';
          tr.appendChild(tn); tr.appendChild(tt);
          tw.appendChild(tr);
        });
        row.appendChild(tw);
      }
      body.appendChild(row);
    });

    wrap.appendChild(body);
    hdr.addEventListener('click', () => {
      const col = body.classList.toggle('wiz8-collapsed');
      chv.style.transform = col ? 'rotate(-90deg)' : '';
    });
    return wrap;
  }

  // ---- Technical assessment save helpers ----------------------
  function _updateTechCountBadge() {
    const badge = _container.querySelector('#wiz8-tech-count');
    if (!badge) return;
    const total = _diagData ? _diagData.risks.filter(r => r.risk_source === 'OWASP').length : 0;
    const sel = Object.values(_state.technical_risks).filter(Boolean).length;
    badge.textContent = `${sel} / ${total} technical risks confirmed`;
  }

  function _handleSaveTechnical() {
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    if (!_record['step-8']) _record['step-8'] = {};
    _record['step-8'].technical_assessment = _buildTechnicalOutputRecord();
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Technical assessment saved ✓');
    const existing = _container.querySelector('.wiz8-tech-saved-banner');
    if (existing) existing.remove();
    const banner = _el('div', 'wiz8-tech-saved-banner');
    const sel = Object.values(_state.technical_risks).filter(Boolean).length;
    banner.innerHTML = `✓ Technical assessment saved — <strong>${sel} OWASP risk${sel !== 1 ? 's' : ''}</strong> confirmed. Switch to <strong>Combined Review</strong> to see both assessments together.`;
    const left = _container.querySelector('.wiz8-diag-left');
    if (left) left.insertBefore(banner, left.firstChild);
    setTimeout(() => banner?.remove(), 10000);
  }

  function _buildTechnicalOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const risks = _diagData
      ? _diagData.risks.filter(r => r.risk_source === 'OWASP').map(r => ({
          risk_id:     r.pk_Risk_ID,
          owasp_id:    r.owasp_id,
          risk_name:   r.risk_name,
          risk_source: 'OWASP',
          selected:    !!_state.technical_risks[r.pk_Risk_ID]
        }))
      : [];
    const sel = risks.filter(r => r.selected).length;
    return { completed: true, assessment_date: today, total_risks: risks.length, selected_count: sel, risks };
  }

  // ---- Re-render legal pane in place --------------------------
  function _renderLegalPane() {
    const pane = _container.querySelector('[data-pane="legal"]');
    if (!pane) return;
    pane.innerHTML = '';
    pane.appendChild(_buildLegalPane());
  }

  // ---- Legal pane dispatcher ----------------------------------
  function _buildLegalPane() {
    const wqs = _legalGuidance?.wizard_questions;
    if (!wqs?.length) {
      const card = _el('div', 'step-detail-card');
      const p = _el('p', 'wiz8-notice');
      p.innerHTML = 'No wizard questions defined. Add a <code>wizard_questions</code> array to <strong>step8-legal-risk-guidance.json</strong> to enable guided mode.';
      card.appendChild(p);
      return card;
    }
    const wrap = _el('div', 'wiz8-legal-wrap');
    const legalSaved = _record?.['step-8']?.legal_assessment?.completed;
    if (legalSaved) {
      const note = _el('div', 'wiz8-legal-saved-note');
      const date = _record['step-8'].legal_assessment.assessment_date || '';
      const count = _record['step-8'].legal_assessment.selected_count ?? 0;
      note.innerHTML = `✓ Legal/regulatory assessment last saved on <strong>${date}</strong> — <strong>${count} risk${count !== 1 ? 's' : ''}</strong> confirmed. Complete the wizard again to update, or switch to <strong>Combined Review</strong>.`;
      wrap.appendChild(note);
    }
    wrap.appendChild(_wizState.complete ? _buildWizardSummary() : _buildQuestionScreen(_wizState.step_index));
    return wrap;
  }

  // ---- Single question screen ---------------------------------
  function _buildQuestionScreen(idx) {
    const wqs   = _legalGuidance.wizard_questions;
    const total = wqs.length;
    const wq    = wqs[idx];
    const riskG = _legalGuidance.risks?.[wq.risk_name];
    const relevance = _computeRelevance(wq.risk_name);
    const category  = riskG?.category || null;
    const catColor  = category ? (_legalGuidance.categories?.[category]?.color || 'slate') : 'slate';
    const catColors = _CAT_COLORS[catColor] || _CAT_COLORS.slate;
    const answer    = _wizState.answers[wq.risk_name] || null;

    const wrap = _el('div', 'wiz8-guided-wrap');

    // Progress bar
    const progWrap = _el('div', 'wiz8-guided-prog-wrap');
    const progMeta = _el('div', 'wiz8-guided-prog-meta');
    const progTitle = _el('span', 'wiz8-guided-prog-title');
    progTitle.textContent = 'Legal/Regulatory Risk Assessment';
    const progLabel = _el('span', 'wiz8-guided-prog-label');
    progLabel.textContent = `${idx + 1} of ${total}`;
    progMeta.appendChild(progTitle); progMeta.appendChild(progLabel);
    const progBar  = _el('div', 'wiz8-guided-prog-bar');
    const progFill = _el('div', 'wiz8-guided-prog-fill');
    progFill.style.width = Math.round((idx / total) * 100) + '%';
    progBar.appendChild(progFill);
    progWrap.appendChild(progMeta); progWrap.appendChild(progBar);
    wrap.appendChild(progWrap);

    // Question card
    const qCard = _el('div', 'wiz8-q-card');
    if (relevance === 'high') qCard.classList.add('wiz8-q-card--high');

    // Meta row: category + relevance
    const qMeta = _el('div', 'wiz8-q-meta');
    if (category) {
      const catTag = _el('span', 'wiz8-cat-tag');
      catTag.textContent = category;
      catTag.style.background = catColors.bg; catTag.style.color = catColors.text;
      qMeta.appendChild(catTag);
    }
    if (relevance !== 'unassessed') {
      const relBadge = _el('span', `wiz8-rel-badge wiz8-rel-badge--${relevance}`);
      relBadge.textContent = relevance === 'high' ? '▲ HIGH' : '◆ MEDIUM';
      qMeta.appendChild(relBadge);
    }
    qCard.appendChild(qMeta);

    // Risk name
    const rName = _el('h3', 'wiz8-q-risk-name');
    rName.textContent = wq.risk_name; qCard.appendChild(rName);

    // Interrogative question text
    const qText = _el('p', 'wiz8-q-text');
    qText.textContent = wq.question; qCard.appendChild(qText);

    // Applies-if conditions
    if (riskG?.applies_if?.length) {
      const aiWrap  = _el('div', 'wiz8-applies-wrap');
      const aiLabel = _el('p', 'wiz8-applies-label');
      aiLabel.textContent = 'This risk applies if any of:';
      aiWrap.appendChild(aiLabel);
      const aiList = _el('ul', 'wiz8-applies-list');
      riskG.applies_if.forEach(cond => {
        const li = _el('li', 'wiz8-applies-item'); li.textContent = cond; aiList.appendChild(li);
      });
      aiWrap.appendChild(aiList);
      qCard.appendChild(aiWrap);
    }

    // Traditional analogue
    if (riskG?.traditional_analog) {
      const analogRow  = _el('div', 'wiz8-analog-row');
      const analogIcon = _el('span', 'wiz8-analog-icon');
      analogIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      analogRow.appendChild(analogIcon);
      const analogText = _el('span', 'wiz8-analog-text');
      analogText.textContent = riskG.traditional_analog;
      analogRow.appendChild(analogText);
      qCard.appendChild(analogRow);
    }

    wrap.appendChild(qCard);

    // Answer label
    const ansLabel = _el('p', 'wiz8-q-answer-label');
    ansLabel.textContent = 'Does this risk apply to your system?';
    wrap.appendChild(ansLabel);

    // Answer buttons
    const btnRow = _el('div', 'wiz8-q-btn-row');

    const advance = () => {
      if (idx < total - 1) {
        _wizState.step_index = idx + 1;
      } else {
        _wizState.complete = true;
      }
      _renderLegalPane();
    };

    [
      ['yes',       '✓  Yes, this risk applies',  'wiz8-q-btn--yes'],
      ['partially', '~  Partially applies',        'wiz8-q-btn--part'],
      ['no',        '✗  No / not applicable',      'wiz8-q-btn--no']
    ].forEach(([val, label, mod]) => {
      const btn = _el('button', `wiz8-q-btn ${mod}${answer === val ? ' wiz8-q-btn--selected' : ''}`);
      btn.textContent = label;
      btn.addEventListener('click', () => { _wizState.answers[wq.risk_name] = val; advance(); });
      btnRow.appendChild(btn);
    });
    wrap.appendChild(btnRow);

    // Navigation row
    const navRow = _el('div', 'wiz8-q-nav-row');
    if (idx > 0) {
      const backBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--back');
      backBtn.textContent = '← Back';
      backBtn.addEventListener('click', () => { _wizState.step_index = idx - 1; _renderLegalPane(); });
      navRow.appendChild(backBtn);
    } else {
      navRow.appendChild(_el('span', '')); // left spacer
    }

    const navRight = _el('div', 'wiz8-q-nav-right');
    const posLabel = _el('span', 'wiz8-q-nav-pos');
    posLabel.textContent = `${idx + 1} / ${total}`;
    navRight.appendChild(posLabel);

    if (idx < total - 1) {
      const nextBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--next');
      nextBtn.textContent = 'Next →';
      nextBtn.addEventListener('click', () => { _wizState.step_index = idx + 1; _renderLegalPane(); });
      navRight.appendChild(nextBtn);
    } else {
      const finBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--finish');
      finBtn.textContent = 'Finish ✓';
      finBtn.addEventListener('click', () => { _wizState.complete = true; _renderLegalPane(); });
      navRight.appendChild(finBtn);
    }
    navRow.appendChild(navRight);
    wrap.appendChild(navRow);

    return wrap;
  }

  // ---- Summary screen (after wizard completes) ----------------
  function _buildWizardSummary() {
    const wqs = _legalGuidance.wizard_questions;

    const applicable = wqs.filter(wq => ['yes', 'partially'].includes(_wizState.answers[wq.risk_name]));
    const excluded   = wqs.filter(wq => _wizState.answers[wq.risk_name] === 'no');
    const skipped    = wqs.filter(wq => !_wizState.answers[wq.risk_name]);
    const highApp    = applicable.filter(wq => _computeRelevance(wq.risk_name) === 'high');

    // Group applicable by category
    const byCategory = {};
    applicable.forEach(wq => {
      const cat = _legalGuidance.risks?.[wq.risk_name]?.category || 'Other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(wq);
    });

    const wrap = _el('div', 'wiz8-guided-wrap');
    const card = _el('div', 'step-detail-card');

    // Heading
    const tickRow = _el('div', 'wiz8-summary-tick-row');
    const tickIcon = _el('span', 'wiz8-summary-tick-icon');
    tickIcon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    const tickTitle = _el('h2', 'wiz8-summary-title');
    tickTitle.textContent = 'Legal/Regulatory Assessment Complete';
    tickRow.appendChild(tickIcon); tickRow.appendChild(tickTitle);
    card.appendChild(tickRow);

    // Stats
    const stats = _el('div', 'wiz8-summary-stats');
    [
      [applicable.length, 'Risks identified',       '#15803d'],
      [highApp.length,    'HIGH relevance',          '#b91c1c'],
      [excluded.length,   'Excluded',                '#64748b'],
      [skipped.length,    'Skipped',                 '#94a3b8']
    ].forEach(([num, lbl, col]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num); n.style.color = col;
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl;
      s.appendChild(n); s.appendChild(l); stats.appendChild(s);
    });
    card.appendChild(stats);

    // Category breakdown
    if (Object.keys(byCategory).length) {
      card.appendChild(_sectionLabel('Identified Risks by Category'));
      const catList = _el('div', 'wiz8-summary-cat-list');
      Object.entries(byCategory).forEach(([cat, risks]) => {
        const row = _el('div', 'wiz8-summary-cat-row');
        const catTag = _el('span', 'wiz8-cat-tag');
        catTag.textContent = cat;
        const c = _CAT_COLORS[_legalGuidance.categories?.[cat]?.color || 'slate'] || _CAT_COLORS.slate;
        catTag.style.background = c.bg; catTag.style.color = c.text;
        row.appendChild(catTag);
        const names = _el('span', 'wiz8-summary-risk-names');
        names.textContent = risks.map(wq =>
          wq.risk_name + (_wizState.answers[wq.risk_name] === 'partially' ? ' (partial)' : '')
        ).join(' · ');
        row.appendChild(names);
        catList.appendChild(row);
      });
      card.appendChild(catList);
    }

    if (skipped.length) {
      const skipNote = _el('p', 'wiz8-summary-skip-note');
      skipNote.textContent = `${skipped.length} risk${skipped.length !== 1 ? 's' : ''} skipped — unanswered questions will default to not applicable.`;
      card.appendChild(skipNote);
    }

    // Actions
    const actRow = _el('div', 'wiz-action-row');
    const applyBtn = document.createElement('button');
    applyBtn.className = 'wiz-btn-primary';
    applyBtn.textContent = 'Save Legal Assessment ✓';
    applyBtn.addEventListener('click', _handleSaveLegal);
    actRow.appendChild(applyBtn);

    const restartBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--back');
    restartBtn.textContent = '↺  Start over';
    restartBtn.style.marginLeft = 'auto';
    restartBtn.addEventListener('click', () => {
      _wizState.step_index = 0;
      _wizState.answers    = {};
      _wizState.complete   = false;
      _renderLegalPane();
    });
    actRow.appendChild(restartBtn);
    card.appendChild(actRow);

    wrap.appendChild(card);
    return wrap;
  }

  // ---- Legal assessment save helpers --------------------------
  function _handleSaveLegal() {
    const wqs = _legalGuidance?.wizard_questions || [];
    wqs.forEach(wq => {
      const ans = _wizState.answers[wq.risk_name];
      if (ans === 'yes' || ans === 'partially') _state.legal_risks[wq.risk_name] = true;
      else if (ans === 'no') _state.legal_risks[wq.risk_name] = false;
    });
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    if (!_record['step-8']) _record['step-8'] = {};
    _record['step-8'].legal_assessment = _buildLegalOutputRecord();
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Legal assessment saved ✓');
    _renderLegalPane();
  }

  function _buildLegalOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const wqs = _legalGuidance?.wizard_questions || [];
    const risks = wqs.map(wq => {
      const ans = _wizState.answers[wq.risk_name] || 'skipped';
      return {
        risk_name:     wq.risk_name,
        risk_source:   'EU_AI_Act',
        selected:      ans === 'yes' || ans === 'partially',
        wizard_answer: ans,
        relevance:     _computeRelevance(wq.risk_name)
      };
    });
    const sel = risks.filter(r => r.selected).length;
    return {
      completed:       true,
      assessment_date: today,
      wizard_answers:  { ..._wizState.answers },
      total_risks:     wqs.length,
      selected_count:  sel,
      risks
    };
  }

  // ---- Combined Review pane -----------------------------------
  function _buildCombinedReviewPane() {
    const card = _el('div', 'step-detail-card');

    const title = _el('h2', 'step-detail-title');
    title.textContent = 'Combined Risk Assessment Review';
    card.appendChild(title);

    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Read-only view of both assessments. Complete each role-specific tab to populate both sections, then proceed to Step 9.';
    card.appendChild(sub);

    card.appendChild(_sectionLabel('Input Sources'));
    card.appendChild(_buildStep3Card());
    card.appendChild(_buildDpiaCard());

    card.appendChild(_sectionLabel('Technical Risk Assessment (OWASP LLM Top 10)'));
    const saved8 = _record?.['step-8'];
    card.appendChild(_buildReviewSection(
      'Technical Risk Assessment (OWASP LLM Top 10)',
      'Completed by the engineering / security team using the RAG Technical Risk Identification tab.',
      saved8?.technical_assessment, 'technical'
    ));

    card.appendChild(_sectionLabel('Legal / Regulatory Risk Assessment (EU AI Act)'));
    card.appendChild(_buildReviewSection(
      'Legal / Regulatory Risk Assessment (EU AI Act)',
      'Completed by the compliance / DPO team using the Legal/Regulatory Risk Identification tab.',
      saved8?.legal_assessment, 'legal'
    ));

    const techDone  = !!saved8?.technical_assessment?.completed;
    const legalDone = !!saved8?.legal_assessment?.completed;
    const gateRow   = _el('div', 'wiz8-review-gate');

    if (!techDone || !legalDone) {
      const warn = _el('div', 'wiz8-review-warn');
      const pending = [!techDone && 'Technical', !legalDone && 'Legal/Regulatory'].filter(Boolean);
      warn.innerHTML = `<strong>⚠ Incomplete:</strong> ${pending.join(' and ')} assessment${pending.length > 1 ? 's' : ''} not yet saved. Complete ${pending.length > 1 ? 'both tabs' : 'that tab'} before proceeding to Step 9. Download the system record to share with the other team if needed.`;
      gateRow.appendChild(warn);
    } else {
      const ok = _el('div', 'wiz8-review-complete');
      const total = (saved8.technical_assessment.selected_count || 0) + (saved8.legal_assessment.selected_count || 0);
      ok.innerHTML = `<strong>✓ Both assessments complete.</strong> ${total} total risk${total !== 1 ? 's' : ''} confirmed. Proceed to Step 9 (Control Identification).`;
      gateRow.appendChild(ok);
    }
    card.appendChild(gateRow);
    return card;
  }

  function _buildReviewSection(title, subtitle, assessment, type) {
    const sec = _el('div', 'wiz8-review-sec');

    const hdr = _el('div', 'wiz8-review-sec-hdr');
    const statusBadge = _el('span', `wiz8-review-status${assessment?.completed ? ' wiz8-review-status--done' : ' wiz8-review-status--pending'}`);
    statusBadge.textContent = assessment?.completed ? `✓ Saved ${assessment.assessment_date || ''}` : '⚠ Not yet saved';
    hdr.appendChild(statusBadge);
    sec.appendChild(hdr);

    const subEl = _el('p', 'wiz8-review-sec-sub'); subEl.textContent = subtitle; sec.appendChild(subEl);

    if (!assessment?.risks?.length) {
      const empty = _el('p', 'wiz8-review-empty');
      empty.textContent = `Open the ${type === 'technical' ? 'RAG Technical Risk Identification' : 'Legal/Regulatory Risk Identification'} tab and save to populate this section.`;
      sec.appendChild(empty);
      return sec;
    }

    const selRisks = assessment.risks.filter(r => r.selected);
    const notSel   = (assessment.total_risks || 0) - (assessment.selected_count ?? selRisks.length);
    const stats    = _el('div', 'wiz8-review-stats');
    [
      [assessment.total_risks,                         'Total risks'],
      [assessment.selected_count ?? selRisks.length,   'Confirmed applicable'],
      [notSel,                                         'Not applicable']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl;
      s.appendChild(n); s.appendChild(l); stats.appendChild(s);
    });
    sec.appendChild(stats);

    if (selRisks.length > 0) {
      const list = _el('div', 'wiz8-review-risk-list');
      selRisks.forEach(r => {
        const row  = _el('div', 'wiz8-review-risk-row');
        const icon = _el('span', type === 'technical' ? 'wiz8-review-risk-icon--tech' : 'wiz8-review-risk-icon--legal');
        icon.textContent = type === 'technical' ? '⚙' : '⚖';
        row.appendChild(icon);
        const nm = _el('span', 'wiz8-review-risk-name'); nm.textContent = r.risk_name || r.risk_id || ''; row.appendChild(nm);
        if (type === 'technical' && r.owasp_id) {
          const badge = _el('span', 'wiz8-diag-src-badge wiz8-diag-src-badge--owasp');
          badge.textContent = `OWASP ${r.owasp_id}`; row.appendChild(badge);
        }
        if (type === 'legal' && r.wizard_answer === 'partially') {
          const badge = _el('span', 'wiz8-review-partial-badge');
          badge.textContent = 'partial'; row.appendChild(badge);
        }
        list.appendChild(row);
      });
      sec.appendChild(list);
    }
    return sec;
  }

  // ---- Source cards -------------------------------------------
  function _buildStep3Card() {
    const card = _el('div', 'wiz8-source-card');
    if (!_step3Data) {
      const w = _el('div', 'wiz8-warn');
      w.innerHTML = '<strong>Step 3 not yet completed.</strong> Complete Step 3 (System classification) to filter risks to only those applicable to your system. All risks are currently shown.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz8-source-label'); lbl.textContent = 'Step 3 — EU AI Act Classification'; card.appendChild(lbl);
    const grid = _el('div', 'wiz8-source-grid');
    const cell = (label, value, mod) => {
      const c = _el('div', 'wiz8-source-cell');
      const l = _el('span', 'wiz8-cell-label'); l.textContent = label; c.appendChild(l);
      const v = _el('span', mod ? `wiz8-cell-value wiz8-cell-value--${mod}` : 'wiz8-cell-value');
      v.textContent = value || '—'; c.appendChild(v); grid.appendChild(c);
    };
    cell('AI Act Outcome',      _step3Data.axis_b?.ai_act_outcome, 'badge');
    cell('Governance Tier',     _step3Data.axis_a?.tier_label || _step3Data.axis_a?.tier);
    cell('Combined Outcome',    _step3Data.combined_outcome?.outcome_label);
    cell('Applicable Controls', String(_step3Data.all_requirement_control_numbers?.length ?? 0), 'num');
    card.appendChild(grid); return card;
  }

  function _buildDpiaCard() {
    const card = _el('div', 'wiz8-source-card wiz8-source-card--dpia');
    if (!_step7Data) {
      const w = _el('div', 'wiz8-info');
      w.innerHTML = '<strong>Step 7 (DPIA) not yet completed.</strong> Complete the DPIA to sharpen relevance scoring with data inventory context.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz8-source-label'); lbl.textContent = 'Step 7 — DPIA Data Inventory'; card.appendChild(lbl);
    const di   = _step7Data.data_types_identified || {};
    const grid = _el('div', 'wiz8-source-grid');
    const cell = (label, value, mod) => {
      const c = _el('div', 'wiz8-source-cell');
      const l = _el('span', 'wiz8-cell-label'); l.textContent = label; c.appendChild(l);
      const v = _el('span', mod ? `wiz8-cell-value wiz8-cell-value--${mod}` : 'wiz8-cell-value');
      v.textContent = value || '—'; c.appendChild(v); grid.appendChild(c);
    };
    cell('Personal data types', (di.standard_personal_data || []).length + ' types');
    cell('Special categories',  (di.special_category_data  || []).filter(x => !x.startsWith('None')).length + ' types');
    const rr = _step7Data.residual_risk_rating;
    cell('Residual risk', rr || '—', (rr === 'High' || rr === 'Very High') ? 'danger' : null);
    const adm = di.automated_decision_making || '';
    cell('Automated decisions', adm ? (adm.length > 38 ? adm.slice(0, 38) + '…' : adm) : '—');
    card.appendChild(grid); return card;
  }


  // ---- Reference pane -----------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');
    const title = _el('h2', 'step-detail-title'); title.textContent = 'Risk Catalogue Reference'; card.appendChild(title);
    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Complete risk catalogue grouped by standard / requirement, with guidance from step8-legal-risk-guidance.json. Edit that file to adapt analogues, conditions, and relevance rules for your organisation.';
    card.appendChild(sub);

    // Category legend
    if (_legalGuidance?.categories) {
      card.appendChild(_sectionLabel('Risk Categories'));
      const legend = _el('div', 'wiz8-cat-legend');
      Object.entries(_legalGuidance.categories).forEach(([name, info]) => {
        const item = _el('div', 'wiz8-cat-legend-item');
        const tag  = _el('span', 'wiz8-cat-tag');
        tag.textContent = name;
        const c = _CAT_COLORS[info.color] || _CAT_COLORS.slate;
        tag.style.background = c.bg; tag.style.color = c.text;
        item.appendChild(tag);
        const desc = _el('span', 'wiz8-cat-legend-desc'); desc.textContent = info.description; item.appendChild(desc);
        legend.appendChild(item);
      });
      card.appendChild(legend);
    }

    card.appendChild(_sectionLabel('All Risks by Standard / Requirement'));

    // Group by StepName (same logic as Browse All — no fieldGroup duplication)
    const stepMap = new Map(); // StepName → [risk field, ...]
    for (const section of Object.values(_framework || {})) {
      if (!Array.isArray(section)) continue;
      for (const article of section) {
        const stepName = article.StepName;
        if (!stepName) continue;
        for (const field of (article.Fields || [])) {
          if (field.jkType !== 'risk') continue;
          if (!stepMap.has(stepName)) stepMap.set(stepName, []);
          if (!stepMap.get(stepName).find(r => r.jkName === field.jkName)) {
            stepMap.get(stepName).push(field);
          }
        }
      }
    }

    stepMap.forEach((risks, stepName) => {
      const sec = _el('div', 'wiz8-ref-fg');
      const h3  = _el('div', 'wiz8-ref-fg-header');
      const nm  = _el('span', 'wiz8-ref-fg-name'); nm.textContent = stepName; h3.appendChild(nm);
      const cnt = _el('span', 'wiz8-count-badge'); cnt.textContent = `${risks.length} risk${risks.length !== 1 ? 's' : ''}`; h3.appendChild(cnt);
      sec.appendChild(h3);
      risks.forEach(risk => {
        const rd  = _el('div', 'wiz8-ref-risk');
        const g   = _legalGuidance?.risks?.[risk.jkName];
        const rnh = _el('div', 'wiz8-ref-risk-header');
        const rn  = _el('p', 'wiz8-ref-risk-name'); rn.textContent = risk.jkName; rnh.appendChild(rn);
        if (g?.category) {
          const catTag = _el('span', 'wiz8-cat-tag');
          catTag.textContent = g.category;
          const c = _CAT_COLORS[_legalGuidance.categories?.[g.category]?.color || 'slate'] || _CAT_COLORS.slate;
          catTag.style.background = c.bg; catTag.style.color = c.text;
          rnh.appendChild(catTag);
        }
        rd.appendChild(rnh);
        if (g?.traditional_analog) {
          const an = _el('p', 'wiz8-ref-analog'); an.textContent = '💡 ' + g.traditional_analog; rd.appendChild(an);
        }
        sec.appendChild(rd);
      });
      card.appendChild(sec);
    });

    return card;
  }

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    if (document.getElementById('wiz8-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz8-styles';
    s.textContent = `
/* Shared base layout */
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

/* Source cards */
.wiz8-source-card{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz8-source-card--dpia{background:#faf5ff;border-color:#ddd6fe}
.wiz8-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#0284c7;margin:0 0 10px}
.wiz8-source-card--dpia .wiz8-source-label{color:#7c3aed}
.wiz8-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.wiz8-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz8-cell-label{font-size:11px;color:var(--color-text-tertiary);font-weight:500}
.wiz8-cell-value{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz8-cell-value--badge{font-size:11px;font-weight:700;text-transform:uppercase;background:#ccfbf1;color:#0f766e;padding:2px 8px;border-radius:10px;display:inline-block}
.wiz8-cell-value--num{font-size:18px;font-weight:700;color:var(--teal-600,#0d9488)}
.wiz8-cell-value--danger{font-size:13px;font-weight:700;color:#b91c1c}
.wiz8-warn{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;font-size:13px;color:#92400e;line-height:1.55}
.wiz8-info{background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 14px;font-size:13px;color:#075985;line-height:1.55}
.wiz8-instruction{font-size:13px;color:var(--color-text-secondary);margin:0 0 12px;line-height:1.6}
.wiz8-high-count{color:#b91c1c}
.wiz8-notice{font-size:13px;color:var(--color-text-tertiary);padding:20px 0}

/* Filter bar */
.wiz8-filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.wiz8-filter-label{font-size:12px;font-weight:600;color:var(--color-text-secondary)}
.wiz8-filter-btn{padding:5px 12px;font-size:12px;font-weight:500;border:1px solid var(--color-border);border-radius:20px;cursor:pointer;background:#fff;color:var(--color-text-secondary);font-family:inherit;transition:background .15s,border-color .15s;display:inline-flex;align-items:center}
.wiz8-filter-btn:hover{background:var(--color-bg-subtle,#f8fafc)}
.wiz8-filter-btn--active{background:#f8fafc;border-color:var(--teal-400,#2dd4bf);color:var(--teal-700,#0f766e);font-weight:600}
.wiz8-filter-btn--high.wiz8-filter-btn--active{background:#fee2e2;border-color:#fca5a5;color:#b91c1c}

/* FieldGroup accordion */
.wiz8-fg{border:1px solid var(--color-border);border-radius:8px;overflow:hidden;margin-bottom:10px}
.wiz8-fg-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none;gap:10px}
.wiz8-fg-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz8-fg-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.wiz8-fg-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz8-badge-risks{font-size:11px;font-weight:600;background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-badge-high{font-size:11px;font-weight:700;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-fg-header-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz8-sel-btn{font-size:11px;font-weight:500;color:var(--teal-600,#0d9488);background:none;border:1px solid #99f6e4;border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.wiz8-sel-btn:hover{background:#f0fdfa}
.wiz8-fg-sel-count{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center}
.wiz8-fg-sel-count--all{background:#dcfce7;color:#15803d}
.wiz8-fg-sel-count--partial{background:#fef3c7;color:#b45309}
.wiz8-fg-sel-count--none{background:#fee2e2;color:#b91c1c}
.wiz8-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz8-fg-body{padding:12px 14px;display:flex;flex-direction:column;gap:14px}
.wiz8-collapsed{display:none}
.wiz8-hidden,.wiz8-filter-hidden,.wiz8-search-hidden{display:none!important}

/* Risk card */
.wiz8-risk-card{background:#fff;border:1px solid var(--color-border);border-radius:8px;padding:14px 16px}
.wiz8-risk-card[data-relevance="high"]{border-left:3px solid #fca5a5}

/* Risk header */
.wiz8-risk-header{display:flex;align-items:center;gap:7px;margin-bottom:10px;flex-wrap:wrap}
.wiz8-risk-cb{flex-shrink:0;accent-color:var(--teal-600,#0d9488);width:15px;height:15px;cursor:pointer;margin-top:1px}
.wiz8-risk-icon{display:flex;color:#ef4444;flex-shrink:0}
.wiz8-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary);flex:1;min-width:140px}
.wiz8-role-badge{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:#ede9fe;color:#6d28d9;padding:2px 7px;border-radius:4px;white-space:nowrap}

/* Category tag */
.wiz8-cat-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}

/* Relevance badge */
.wiz8-rel-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0;letter-spacing:.03em}
.wiz8-rel-badge--high{background:#fee2e2;color:#b91c1c}
.wiz8-rel-badge--medium{background:#f1f5f9;color:#475569}

/* Traditional IT analogue */
.wiz8-analog-row{display:flex;gap:7px;align-items:flex-start;margin-bottom:10px;padding:9px 12px;background:#f8fafc;border-radius:6px;border:1px solid var(--color-border)}
.wiz8-analog-icon{display:flex;color:#0284c7;flex-shrink:0;margin-top:1px}
.wiz8-analog-text{font-size:12px;color:#334155;line-height:1.6;font-style:italic}

/* Applies-if checklist */
.wiz8-applies-wrap{margin-bottom:10px}
.wiz8-applies-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:0 0 6px}
.wiz8-applies-list{margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.wiz8-applies-item{font-size:12px;color:var(--color-text-secondary);line-height:1.55;padding:5px 10px 5px 28px;background:#fff;border:1px solid var(--color-border);border-radius:5px;position:relative}
.wiz8-applies-item::before{content:"✓";position:absolute;left:8px;color:#0d9488;font-weight:700;font-size:11px;top:6px}

/* Collapsible description */
.wiz8-desc-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-bottom:6px}
.wiz8-desc-header{display:flex;align-items:center;gap:6px;padding:7px 11px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none}
.wiz8-desc-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz8-desc-icon{display:flex;color:var(--color-text-tertiary);flex-shrink:0}
.wiz8-desc-label{font-size:12px;font-weight:600;color:var(--color-text-secondary);flex:1}
.wiz8-desc-chevron{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz8-desc-body{padding:12px 14px}
.wiz8-risk-desc-text{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0}

/* Attack vectors */
.wiz8-av-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-top:4px}
.wiz8-av-header{display:flex;align-items:center;gap:7px;padding:7px 11px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none}
.wiz8-av-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz8-av-icon{display:flex;color:#d97706;flex-shrink:0}
.wiz8-av-label{font-size:12px;font-weight:600;color:#92400e;flex:1}
.wiz8-av-chevron{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz8-av-body{padding:12px 14px;display:flex;flex-direction:column;gap:12px;background:#fffbeb}
.wiz8-av-item{display:flex;gap:10px;align-items:flex-start}
.wiz8-av-num{font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;padding:2px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0;margin-top:2px}
.wiz8-av-text{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0}

/* Search */
.wiz8-search-wrap{display:flex;align-items:center;gap:6px;margin-bottom:10px;background:#fff;border:1px solid var(--color-border);border-radius:6px;padding:0 10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.wiz8-search-icon{display:flex;color:var(--color-text-tertiary);flex-shrink:0}
.wiz8-search-input{flex:1;border:none;outline:none;padding:10px 0;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:transparent}
.wiz8-search-input::placeholder{color:var(--color-text-tertiary)}
.wiz8-search-clear{display:flex;align-items:center;justify-content:center;background:var(--color-bg-subtle,#f8fafc);border:1px solid var(--color-border);border-radius:4px;width:20px;height:20px;cursor:pointer;color:var(--color-text-tertiary);flex-shrink:0;padding:0}
.wiz8-search-clear:hover{color:var(--color-text-primary)}
.wiz8-search-count{font-size:11px;color:var(--color-text-tertiary);white-space:nowrap}
.wiz8-risk-list{display:flex;flex-direction:column}

/* Count/action */
.wiz8-count-badge{font-size:11px;font-weight:600;background:#ccfbf1;color:#0f766e;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-action-right{display:flex;gap:8px}
.wiz8-count-lg{font-size:13px;font-weight:600;color:var(--teal-700,#0f766e)}

/* Results */
.wiz8-results{margin-top:16px}
.wiz8-result-card{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px}
.wiz8-result-title{font-size:14px;font-weight:700;color:#15803d;margin:0 0 14px}
.wiz8-result-stats{display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap}
.wiz8-stat{display:flex;flex-direction:column;gap:2px}
.wiz8-stat-num{font-size:24px;font-weight:700;color:#15803d;line-height:1}
.wiz8-stat-lbl{font-size:10px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
.wiz8-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* Guided wizard */
.wiz8-guided-wrap{max-width:680px;margin:0 auto;padding:24px}
.wiz8-guided-prog-wrap{margin-bottom:24px}
.wiz8-guided-prog-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.wiz8-guided-prog-title{font-size:14px;font-weight:700;color:var(--color-text-primary)}
.wiz8-guided-prog-label{font-size:12px;color:var(--color-text-tertiary);font-weight:500}
.wiz8-guided-prog-bar{height:6px;background:var(--color-border);border-radius:3px;overflow:hidden}
.wiz8-guided-prog-fill{height:100%;background:var(--teal-500,#14b8a6);border-radius:3px;transition:width .3s ease}
.wiz8-q-card{background:#fff;border:1px solid var(--color-border);border-radius:10px;padding:20px 22px;margin-bottom:18px}
.wiz8-q-card--high{border-left:3px solid #fca5a5}
.wiz8-q-meta{display:flex;align-items:center;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.wiz8-q-risk-name{font-size:16px;font-weight:700;color:var(--color-text-primary);margin:0 0 10px;line-height:1.35}
.wiz8-q-text{font-size:14px;font-weight:600;color:var(--teal-700,#0f766e);line-height:1.55;margin:0 0 16px;padding:12px 14px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:7px}
.wiz8-q-answer-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-secondary);margin:0 0 10px}
.wiz8-q-btn-row{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
.wiz8-q-btn{width:100%;padding:13px 18px;font-size:13px;font-weight:600;border:2px solid var(--color-border);border-radius:8px;cursor:pointer;text-align:left;background:#fff;color:var(--color-text-primary);font-family:inherit;transition:background .12s,border-color .12s}
.wiz8-q-btn:hover{background:var(--color-bg-subtle,#f8fafc);border-color:var(--teal-300,#5eead4)}
.wiz8-q-btn--yes.wiz8-q-btn--selected{background:#f0fdf4;border-color:#4ade80;color:#15803d}
.wiz8-q-btn--part.wiz8-q-btn--selected{background:#fffbeb;border-color:#fcd34d;color:#92400e}
.wiz8-q-btn--no.wiz8-q-btn--selected{background:#f8fafc;border-color:#94a3b8;color:#475569}
.wiz8-q-nav-row{display:flex;align-items:center;justify-content:space-between;padding-top:4px}
.wiz8-q-nav-right{display:flex;align-items:center;gap:10px}
.wiz8-q-nav-pos{font-size:11px;color:var(--color-text-tertiary)}
.wiz8-q-nav-btn{padding:8px 16px;font-size:12px;font-weight:600;border:1px solid var(--color-border);border-radius:6px;cursor:pointer;background:#fff;color:var(--color-text-secondary);font-family:inherit;transition:background .12s}
.wiz8-q-nav-btn:hover{background:var(--color-bg-subtle,#f8fafc)}
.wiz8-q-nav-btn--next,.wiz8-q-nav-btn--finish{background:var(--teal-600,#0d9488);color:#fff;border-color:var(--teal-600,#0d9488)}
.wiz8-q-nav-btn--next:hover,.wiz8-q-nav-btn--finish:hover{background:var(--teal-700,#0f766e)}

/* Summary screen */
.wiz8-summary-tick-row{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.wiz8-summary-tick-icon{color:#15803d;display:flex;flex-shrink:0}
.wiz8-summary-title{font-size:18px;font-weight:700;color:var(--color-text-primary);margin:0}
.wiz8-summary-stats{display:flex;gap:28px;margin-bottom:20px;flex-wrap:wrap}
.wiz8-summary-cat-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}
.wiz8-summary-cat-row{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;background:var(--color-bg-subtle,#f8fafc);border-radius:6px}
.wiz8-summary-risk-names{font-size:12px;color:var(--color-text-secondary);line-height:1.5;padding-top:1px}
.wiz8-summary-skip-note{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0 0 16px}

/* Applied banner */
.wiz8-applied-banner{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:10px 14px;font-size:13px;color:#166534;margin-bottom:16px;line-height:1.5}

/* Reference pane */
.wiz8-cat-legend{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
.wiz8-cat-legend-item{display:flex;align-items:flex-start;gap:10px}
.wiz8-cat-legend-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.5}
.wiz8-ref-fg{margin-bottom:28px}
.wiz8-ref-fg-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid var(--color-border)}
.wiz8-ref-fg-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz8-ref-risk{margin-bottom:12px;padding-left:12px;border-left:3px solid #fecaca}
.wiz8-ref-risk-header{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}
.wiz8-ref-risk-name{font-size:12px;font-weight:700;color:#b91c1c;margin:0}
.wiz8-ref-analog{font-size:11px;color:var(--color-text-secondary);margin:0;line-height:1.55;font-style:italic}

/* ---- RAG Diagram tab ---- */
/* Two-panel wrapper */
.wiz8-diag-wrap{display:flex;height:100%;min-height:600px}
.wiz8-diag-left{width:40%;min-width:260px;border-right:1px solid var(--color-border);overflow-y:auto;padding:18px 16px;flex-shrink:0;background:var(--color-bg,#fff)}
.wiz8-diag-right{flex:1;overflow-y:auto;padding:20px 22px;background:var(--color-bg-subtle,#f8fafc)}

/* Left panel header */
.wiz8-diag-hdr{margin-bottom:12px}
.wiz8-diag-hdr-title{font-size:12px;font-weight:700;color:var(--color-text-primary);margin:0 0 3px;line-height:1.4}
.wiz8-diag-hdr-sub{font-size:11px;color:var(--color-text-tertiary);margin:0}

/* Filter toggle */
.wiz8-diag-filter-bar{display:flex;align-items:center;gap:5px;margin-bottom:12px;flex-wrap:wrap}
.wiz8-diag-filter-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-secondary);white-space:nowrap;margin-right:2px}
.wiz8-diag-filter-btn{padding:3px 9px;font-size:11px;font-weight:500;border:1px solid var(--color-border);border-radius:20px;cursor:pointer;background:#fff;color:var(--color-text-secondary);font-family:inherit;transition:background .12s,border-color .12s,color .12s}
.wiz8-diag-filter-btn:hover{background:var(--color-bg-subtle,#f8fafc)}
.wiz8-diag-filter-btn--active{background:#f0fdfa;border-color:var(--teal-400,#2dd4bf);color:var(--teal-700,#0f766e);font-weight:700}

/* Diagram grid */
.wiz8-diag-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:10px}
.wiz8-diag-box{border:2px solid var(--color-border);border-radius:8px;padding:11px 13px;cursor:pointer;position:relative;background:#fff;transition:border-color .15s,background .15s;user-select:none}
.wiz8-diag-box:hover{border-color:var(--teal-300,#5eead4);background:#f0fdfa}
.wiz8-diag-box--selected{border-color:var(--teal-600,#0d9488)!important;background:#f0fdfa!important;box-shadow:0 0 0 3px rgba(13,148,136,.12)}
.wiz8-diag-box-inner{display:flex;flex-direction:column;gap:3px}
.wiz8-diag-box-name{font-size:11px;font-weight:700;color:var(--color-text-primary);line-height:1.3}
.wiz8-diag-box-sub{font-size:9px;color:var(--color-text-tertiary);line-height:1.4}

/* Risk count badges on boxes */
.wiz8-diag-rbadge{position:absolute;top:-8px;right:-8px;background:#ef4444;color:#fff;border-radius:10px;min-width:18px;height:18px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #fff;line-height:1;z-index:1}
.wiz8-diag-rbadge--demo{position:static;display:inline-flex;vertical-align:middle;min-width:16px;height:16px;font-size:9px;padding:0 3px;border-width:1px;margin-right:1px}

/* Legend */
.wiz8-diag-legend{font-size:10px;color:var(--color-text-tertiary);display:flex;align-items:center;gap:4px;padding-top:8px;border-top:1px solid var(--color-border)}
.wiz8-diag-leg-item{display:inline-flex;align-items:center;gap:3px}

/* Right panel: placeholder */
.wiz8-diag-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;text-align:center;gap:14px;color:var(--color-text-tertiary)}
.wiz8-diag-ph-msg{font-size:13px;color:var(--color-text-tertiary);max-width:300px;line-height:1.65;margin:0}

/* Right panel: detail header */
.wiz8-diag-det-hdr{border-bottom:1px solid var(--color-border);padding-bottom:12px;margin-bottom:14px}
.wiz8-diag-det-title{font-size:15px;font-weight:700;color:var(--color-text-primary);margin:0 0 8px}
.wiz8-diag-det-chips{display:flex;flex-wrap:wrap;gap:4px}
.wiz8-diag-chip{font-size:10px;font-weight:600;background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4;border-radius:10px;padding:2px 8px;white-space:nowrap}
.wiz8-diag-det-count{font-size:12px;color:var(--color-text-secondary);margin:0 0 10px;line-height:1.5}
.wiz8-diag-det-empty{font-size:13px;color:var(--color-text-tertiary);padding:24px 0;text-align:center}

/* Risk cards in detail panel */
.wiz8-diag-risk-card{background:#fff;border:1px solid var(--color-border);border-radius:8px;padding:12px 14px;margin-bottom:8px}
.wiz8-diag-risk-card--owasp{border-left:3px solid #fb923c}
.wiz8-diag-risk-card--eu{border-left:3px solid #60a5fa}
.wiz8-diag-risk-hdr{display:flex;align-items:flex-start;gap:7px;margin-bottom:7px;flex-wrap:wrap}
.wiz8-diag-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;line-height:1.4}
.wiz8-diag-src-badge--owasp{background:#ffedd5;color:#9a3412}
.wiz8-diag-src-badge--eu{background:#dbeafe;color:#1e40af}
.wiz8-diag-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary);line-height:1.35;flex:1;min-width:100px}
.wiz8-diag-comp-row{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
.wiz8-diag-comp-tag{font-size:9px;font-weight:600;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;padding:1px 6px;white-space:nowrap}
.wiz8-diag-risk-desc{font-size:11px;color:var(--color-text-secondary);line-height:1.6;margin:0 0 8px}

/* Controls accordion in risk cards */
.wiz8-diag-ctrl-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-top:4px}
.wiz8-diag-ctrl-hdr{display:flex;align-items:center;gap:7px;padding:7px 11px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none}
.wiz8-diag-ctrl-hdr:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz8-diag-ctrl-icon{display:flex;color:#0d9488;flex-shrink:0}
.wiz8-diag-ctrl-lbl{font-size:12px;font-weight:600;color:#0f766e;flex:1}
.wiz8-diag-ctrl-chv{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz8-diag-ctrl-body{padding:12px 14px;display:flex;flex-direction:column;gap:14px;background:#fff}
.wiz8-diag-ctrl-row{border-left:3px solid #99f6e4;padding-left:10px}
.wiz8-diag-ctrl-row-hdr{display:flex;align-items:flex-start;gap:7px;margin-bottom:5px;flex-wrap:wrap}
.wiz8-diag-ctrl-id{font-size:10px;font-weight:700;background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4;border-radius:4px;padding:2px 6px;white-space:nowrap;flex-shrink:0;line-height:1.4}
.wiz8-diag-ctrl-name{font-size:12px;font-weight:700;color:var(--color-text-primary);line-height:1.4;flex:1;min-width:80px}
.wiz8-diag-ctrl-obj{font-size:11px;color:var(--color-text-secondary);line-height:1.6;margin:4px 0 0}

/* Implementation tasks */
.wiz8-diag-tasks{background:var(--color-bg-subtle,#f8fafc);border-radius:5px;padding:8px 10px;margin-top:8px}
.wiz8-diag-tasks-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:0 0 6px}
.wiz8-diag-task-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}
.wiz8-diag-task-row:last-child{margin-bottom:0}
.wiz8-diag-task-num{font-size:10px;font-weight:700;background:#e0e7ff;color:#4338ca;border-radius:10px;padding:1px 6px;white-space:nowrap;flex-shrink:0;margin-top:2px}
.wiz8-diag-task-text{font-size:11px;color:var(--color-text-secondary);line-height:1.55;margin:0}

/* ---- Technical save row ---- */
.wiz8-tech-save-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:10px 12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:7px;flex-wrap:wrap}
.wiz8-tech-count{font-size:12px;font-weight:600;color:var(--teal-700,#0f766e)}
.wiz8-diag-risk-cb{flex-shrink:0;accent-color:var(--teal-600,#0d9488);width:15px;height:15px;cursor:pointer;margin-top:1px}
.wiz8-tech-saved-banner{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:10px 14px;font-size:13px;color:#166534;margin-bottom:10px;line-height:1.5}

/* ---- Legal pane ---- */
.wiz8-legal-wrap{display:flex;flex-direction:column}
.wiz8-legal-saved-note{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:10px 14px;font-size:13px;color:#166534;line-height:1.5;margin:12px 24px 0}

/* ---- Combined Review pane ---- */
.wiz8-review-sec{border:1px solid var(--color-border);border-radius:8px;padding:16px 18px;margin-bottom:16px}
.wiz8-review-sec-hdr{display:flex;align-items:center;justify-content:flex-end;margin-bottom:6px}
.wiz8-review-status{font-size:11px;font-weight:700;padding:3px 9px;border-radius:10px;white-space:nowrap}
.wiz8-review-status--done{background:#dcfce7;color:#15803d}
.wiz8-review-status--pending{background:#fef3c7;color:#92400e}
.wiz8-review-sec-sub{font-size:12px;color:var(--color-text-secondary);line-height:1.55;margin:0 0 12px;font-style:italic}
.wiz8-review-empty{font-size:13px;color:var(--color-text-tertiary);padding:8px 0;margin:0}
.wiz8-review-stats{display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap}
.wiz8-review-risk-list{display:flex;flex-direction:column;gap:5px}
.wiz8-review-risk-row{display:flex;align-items:center;gap:7px;padding:5px 8px;background:var(--color-bg-subtle,#f8fafc);border-radius:5px;flex-wrap:wrap}
.wiz8-review-risk-name{font-size:12px;font-weight:600;color:var(--color-text-primary);flex:1;min-width:120px}
.wiz8-review-risk-icon--tech{font-size:14px;color:#0d9488;flex-shrink:0}
.wiz8-review-risk-icon--legal{font-size:14px;color:#1d4ed8;flex-shrink:0}
.wiz8-review-partial-badge{font-size:10px;font-weight:700;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:8px;white-space:nowrap;flex-shrink:0}
.wiz8-review-gate{margin-top:20px}
.wiz8-review-warn{background:#fffbeb;border:1px solid #fde68a;border-radius:7px;padding:12px 16px;font-size:13px;color:#92400e;line-height:1.6}
.wiz8-review-complete{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;padding:12px 16px;font-size:13px;color:#166534;line-height:1.6}
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

})();
