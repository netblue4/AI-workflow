/* Step 5 — Risk Assessment Wizard (Guided)
   Data sources: tbl_Risks.json, tbl_Risk_Controls.json, tbl_AI_Articles.json
   Guidance (analogues, applies-if, relevance, categories) loaded from step5-legal-risk-guidance.json.
   Selection at risk level. Identity from central _meta.
   Informed by Step 3 (RCN filter + relevance) and Step 7 (DPIA data types + relevance).
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _legalGuidance = null, _record = null, _detail = null;
  let _step3Data = null, _step7Data = null;
  let _filteredFGItems = []; // [{groupName, risks:[...]}]
  // tbl_ data stores
  let _tblRisks    = [];   // all rows from tbl_Risks.json
  let _tblControls = [];   // all rows from tbl_Risk_Controls.json
  let _tblArticles = [];   // all rows from tbl_AI_Articles.json
  let _controlsByRisk = new Map(); // pk_Risk_ID → [control, ...]
  let _articleById    = new Map(); // pk_AI_Article_ID → article

  const _state = {
    legal_risks: {}, // riskName → boolean (EU AI Act risks from guidance)
  };

  // Legal guided wizard state
  const _wizState = {
    step_index: 0,
    answers:    {}, // riskName → 'yes'|'partially'|'no'
    rationales: {}, // riskName → string
    complete:   false
  };

  // Category color palette — populated from step5-legal-risk-guidance.json after load
  const _FALLBACK_COLOR = { bg: '#f1f5f9', text: '#334155' };
  const _catColor = key => (_legalGuidance?.color_palette?.[key] || _FALLBACK_COLOR);

  // ---- Public API ---------------------------------------------
  window.mountStep5Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _legalGuidance  = null;
    _record         = null;
    _detail         = null;
    _step3Data      = null;
    _step7Data      = null;
    _filteredFGItems = [];
    _tblRisks        = [];
    _tblControls     = [];
    _tblArticles     = [];
    _controlsByRisk  = new Map();
    _articleById     = new Map();
    _state.legal_risks    = {};
    _wizState.step_index  = 0;
    _wizState.answers     = {};
    _wizState.rationales  = {};
    _wizState.complete    = false;

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
    // Load all tbl_ data sources and guidance files
    const [risksRes, ctrlsRes, artsRes, lgdRes, detailRes] = await Promise.allSettled([
      fetch('tbl_Risks.json'),
      fetch('tbl_Risk_Controls.json'),
      fetch('tbl_AI_Articles.json'),
      fetch('step5-legal-risk-guidance.json'),
      fetch('step-5.json'),
    ]);

    if (risksRes.status === 'rejected' || !risksRes.value.ok) {
      pw.innerHTML = `<p style="padding:24px;color:var(--danger-600,#dc2626)">Could not load tbl_Risks.json</p>`;
      return;
    }
    try {
      _tblRisks = await risksRes.value.json();
    } catch (_) { _tblRisks = []; }

    if (ctrlsRes.status === 'fulfilled' && ctrlsRes.value.ok) {
      try {
        _tblControls = await ctrlsRes.value.json();
        _controlsByRisk = new Map();
        _tblControls.forEach(c => {
          if (!_controlsByRisk.has(c.fk_Risk_ID)) _controlsByRisk.set(c.fk_Risk_ID, []);
          _controlsByRisk.get(c.fk_Risk_ID).push(c);
        });
      } catch (_) {}
    }

    if (artsRes.status === 'fulfilled' && artsRes.value.ok) {
      try {
        _tblArticles = await artsRes.value.json();
        _articleById = new Map();
        _tblArticles.forEach(a => _articleById.set(a.pk_AI_Article_ID, a));
      } catch (_) {}
    }

    if (lgdRes.status === 'fulfilled' && lgdRes.value.ok) {
      try { _legalGuidance = await lgdRes.value.json(); } catch (_) {}
    }

    if (detailRes.status === 'fulfilled' && detailRes.value.ok) {
      try { _detail = await detailRes.value.json(); } catch (_) {}
    }

    _record = WizUtils.loadRecord();

    _step3Data = _record?.['step-3'] ?? null;
    _step7Data = _record?.['step-4'] ?? null;

    // Restore prior wizard answers
    const saved8 = _record?.['step-5'];
    if (saved8?.legal_assessment?.risks) {
      saved8.legal_assessment.risks.forEach(r => {
        _state.legal_risks[r.risk_name] = r.selected;
      });
    }
    if (saved8?.legal_assessment?.wizard_answers) {
      Object.assign(_wizState.answers, saved8.legal_assessment.wizard_answers);
    }
    if (saved8?.legal_assessment?.wizard_rationales) {
      Object.assign(_wizState.rationales, saved8.legal_assessment.wizard_rationales);
    }

    _filteredFGItems = _buildFGItems();

    // Pre-populate wizard answers for risks whose article isn't triggered in Step 3
    if (_legalGuidance?.wizard_questions && _step3Data?.axis_b?.applicable_articles?.length) {
      _legalGuidance.wizard_questions.forEach(wq => {
        if (_wizState.answers[wq.risk_name] === undefined && _isArticleApplicable(wq.risk_name) === false) {
          _wizState.answers[wq.risk_name] = 'no';
        }
      });
    }

    // Default: select all legal risks if no prior legal state; pre-deselect non-applicable per Step 3
    if (Object.keys(_state.legal_risks).length === 0) {
      _filteredFGItems.forEach(fg =>
        fg.risks.forEach(r => {
          _state.legal_risks[r.jkName] = _isArticleApplicable(r.jkName) !== false;
        })
      );
    }

    _renderPanes(pw);
  }

  // ---- Build article → risks structure -----------------------
  // Groups EU AI Act risks by their parent article name.
  // Each risk belongs to exactly one article — no repetition.
  function _buildFGItems() {
    if (!_tblRisks.length) return [];

    const applicable = _step3Data?.all_requirement_control_numbers
      ? new Set(_step3Data.all_requirement_control_numbers) : null;

    const groupMap = new Map(); // article_name → [riskObj, ...]

    const euRisks = _tblRisks.filter(r => r.risk_source === 'EU_AI_Act');

    for (const risk of euRisks) {
      const controls = _controlsByRisk.get(risk.pk_Risk_ID) || [];

      // Apply RCN applicability filter from Step 3 using tbl_Risk_Controls.standard_ref
      const matchedControls = applicable
        ? controls.filter(ctrl => {
            const rcns = (ctrl.fk_Harmonised_Standard_IDs || '')
              .split(',').map(s => s.trim()).filter(Boolean);
            return rcns.some(r => applicable.has(r));
          })
        : controls;

      if (applicable && matchedControls.length === 0) continue;

      const articleName = _articleById.get(risk.fk_AI_Article_ID)?.article_name
        || risk.fk_AI_Article_ID;

      const riskObj = {
        jkName:          risk.risk_name,
        RiskDescription: risk.risk_description || '',
        role:            risk.risk_role || '',
        attackVectors:   matchedControls.map(c => c.jkAttackVector).filter(Boolean),
        stepName:        articleName
      };

      if (!groupMap.has(articleName)) groupMap.set(articleName, []);
      const arr = groupMap.get(articleName);
      if (!arr.find(r => r.jkName === riskObj.jkName)) arr.push(riskObj);
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

  // ---- Relevance computation (uses step5-legal-risk-guidance.json) ------
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

  // Returns the tbl_AI_Articles row for a legal risk by name
  function _getArticleForRisk(riskName) {
    const risk = _tblRisks.find(r => r.risk_name === riskName && r.risk_source === 'EU_AI_Act');
    if (!risk) return null;
    return _articleById.get(risk.fk_AI_Article_ID) || null;
  }

  // Returns null (no Step 3 data → no filtering), true (article triggered), or false (article not triggered)
  function _isArticleApplicable(riskName) {
    const applicableArticles = _step3Data?.axis_b?.applicable_articles;
    if (!applicableArticles?.length) return null;
    const article = _getArticleForRisk(riskName);
    if (!article) return null;
    const m = article.article_name.match(/^(Article \d+[a-zA-Z]*)/);
    if (!m) return null;
    return applicableArticles.some(a => a.article_number === m[1]);
  }

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    return WizUtils.buildTabStrip([
      ['legal', 'Legal/Regulatory Risk Assessment'],
      ['review', 'Review'],
      ['reference', 'Reference']
    ], _switchTab);
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

  // ── Ask JAKE collapsible (Stage 2) ────────────────────────────────────────

  function _buildAskJakeCollapsible() {
    const section = _el('div', 's5-jake-section');

    const header = _el('div', 's5-jake-header');
    const hLeft  = _el('div', 's5-jake-header-left');
    const title  = _sectionLabel('Ask JAKE to draft a risk assessment and control identification');
    title.style.marginBottom = '2px';
    const sub = _el('p', '');
    sub.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0';
    sub.textContent = 'Stage 2 prompt — covers Steps 5 (Risk Assessment) and 6 (Control Identification). Paste the Stage 1 report then this prompt into JAKE.';
    hLeft.append(title, sub);
    const hRight  = _el('div', 's5-jake-header-right');
    const chevron = _el('span', 's5-jake-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 's5-jake-body');
    body.style.display = 'none';

    const instruct = _el('div', 's5-jake-instructions');
    instruct.innerHTML = `
      <strong>How to use this prompt</strong>
      <ol style="margin:8px 0 0 18px;padding:0;font-size:12px;color:var(--color-text-secondary);line-height:1.9">
        <li>Complete the Step 3 and Step 4 wizards first — confirm the classification and DPIA before proceeding.</li>
        <li>Copy the prompt below.</li>
        <li>In JAKE, paste the full Stage 1 narrative report from Step 2, then paste this prompt after it.</li>
        <li>Save the JAKE risk assessment report as a PDF alongside this system record.</li>
        <li>Use the report to answer the questions in the Step 5 and Step 6 wizards.</li>
      </ol>`;
    body.appendChild(instruct);

    const promptWrap = _el('div', 's5-prompt-wrap');
    const copyBtn = _el('button', 'wiz-btn-primary');
    copyBtn.style.cssText = 'align-self:flex-start;font-size:12px;padding:7px 16px;margin-bottom:4px';
    copyBtn.textContent = 'Copy prompt';
    const promptArea = _el('textarea', 's5-prompt-area');
    promptArea.readOnly = true;
    promptArea.rows = 22;
    promptArea.value = _buildStep5Prompt();

    copyBtn.addEventListener('click', () => WizUtils.copyToClipboard(promptArea.value, copyBtn));

    promptWrap.append(copyBtn, promptArea);
    body.appendChild(promptWrap);
    section.appendChild(body);

    header.addEventListener('click', () => {
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? '' : 'none';
      chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
    });

    return section;
  }

  function _buildStep5Prompt() {
    return _detail?.jake_prompt || '';
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const legal  = _el('div', 'wiz-pane');                  legal.dataset.pane  = 'legal';
    const review = _el('div', 'wiz-pane wiz-pane--hidden'); review.dataset.pane = 'review';
    const ref    = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane    = 'reference';
    legal.appendChild(_buildAskJakeCollapsible());
    legal.appendChild(_buildLegalPane());
    review.appendChild(_buildCombinedReviewPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(legal); pw.appendChild(review); pw.appendChild(ref);
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
      p.innerHTML = 'No wizard questions defined. Add a <code>wizard_questions</code> array to <strong>step5-legal-risk-guidance.json</strong> to enable guided mode.';
      card.appendChild(p);
      return card;
    }
    const wrap = _el('div', 'wiz8-legal-wrap');
    const legalSaved = _record?.['step-5']?.legal_assessment?.completed;
    if (legalSaved) {
      const note = _el('div', 'wiz8-legal-saved-note');
      const date = _record['step-5'].legal_assessment.assessment_date || '';
      const count = _record['step-5'].legal_assessment.selected_count ?? 0;
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
    const catColors = _catColor(catColor);
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

    // Pre-filter banner — shown when Step 3 says this article isn't triggered
    if (_isArticleApplicable(wq.risk_name) === false) {
      const article = _getArticleForRisk(wq.risk_name);
      const artNum  = article?.article_name.match(/^(Article \d+[a-zA-Z]*)/)?.[1] || 'this article';
      const filterNote = _el('div', 'wiz8-prefilter-note');
      filterNote.innerHTML = `<strong>Pre-filtered by Step 3 classification:</strong> ${artNum} is not triggered for this system. Pre-answered "No" — override below if needed.`;
      qCard.appendChild(filterNote);
      qCard.classList.add('wiz8-q-card--prefiltered');
    }

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

    // Rationale textarea — pre-filled when an answer is clicked
    const appliesIf = riskG?.applies_if || [];
    const _genRationale = val => {
      if (!appliesIf.length) return '';
      const conditions = appliesIf.join('; ');
      if (val === 'yes')
        return `This risk applies to this AI system. The following conditions are present: ${conditions}.`;
      if (val === 'partially')
        return `This risk partially applies to this AI system. One or more of the following conditions may be present: ${conditions}.`;
      return `This risk is not applicable to this AI system. None of the following conditions apply: ${conditions}.`;
    };

    const rationaleTa = document.createElement('textarea');
    rationaleTa.className = 'wiz8-rationale-ta';
    rationaleTa.placeholder = 'Select an answer above to generate a rationale, or type your own…';
    rationaleTa.rows = 3;
    rationaleTa.value = _wizState.rationales[wq.risk_name] || '';
    rationaleTa.addEventListener('input', () => {
      _wizState.rationales[wq.risk_name] = rationaleTa.value;
    });

    [
      ['yes',       '✓  Yes, this risk applies',  'wiz8-q-btn--yes'],
      ['partially', '~  Partially applies',        'wiz8-q-btn--part'],
      ['no',        '✗  No / not applicable',      'wiz8-q-btn--no']
    ].forEach(([val, label, mod]) => {
      const btn = _el('button', `wiz8-q-btn ${mod}${answer === val ? ' wiz8-q-btn--selected' : ''}`);
      btn.textContent = label;
      btn.addEventListener('click', () => {
        _wizState.answers[wq.risk_name] = val;
        btnRow.querySelectorAll('.wiz8-q-btn').forEach(b => b.classList.remove('wiz8-q-btn--selected'));
        btn.classList.add('wiz8-q-btn--selected');
        // Pre-fill rationale if blank or previously auto-generated
        const existing = _wizState.rationales[wq.risk_name] || '';
        const prevGen  = ['yes', 'partially', 'no'].map(v => _genRationale(v));
        if (!existing || prevGen.includes(existing)) {
          _wizState.rationales[wq.risk_name] = _genRationale(val);
          rationaleTa.value = _wizState.rationales[wq.risk_name];
        }
        rationaleWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        rationaleTa.focus();
      });
      btnRow.appendChild(btn);
    });
    wrap.appendChild(btnRow);

    const rationaleWrap = _el('div', 'wiz8-rationale-wrap');
    const rationaleLbl = _el('label', 'wiz8-rationale-lbl');
    rationaleLbl.textContent = 'Rationale';
    rationaleWrap.appendChild(rationaleLbl);
    rationaleWrap.appendChild(rationaleTa);
    wrap.appendChild(rationaleWrap);

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

    const applicable    = wqs.filter(wq => ['yes', 'partially'].includes(_wizState.answers[wq.risk_name]));
    const excluded      = wqs.filter(wq => _wizState.answers[wq.risk_name] === 'no');
    const skipped       = wqs.filter(wq => !_wizState.answers[wq.risk_name]);
    const highApp       = applicable.filter(wq => _computeRelevance(wq.risk_name) === 'high');
    const preFiltered   = excluded.filter(wq => _isArticleApplicable(wq.risk_name) === false);

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
        const c = _catColor(_legalGuidance.categories?.[cat]?.color || 'slate');
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

    if (preFiltered.length) {
      card.appendChild(_sectionLabel('Pre-filtered by Step 3 Classification'));
      const pfNote = _el('div', 'wiz8-prefilter-summary');
      pfNote.innerHTML = `<strong>${preFiltered.length} risk${preFiltered.length !== 1 ? 's were' : ' was'} pre-answered "No"</strong> because the associated AI Act article is not triggered for this system. These are excluded from the assessment. Return to any question to override.`;
      card.appendChild(pfNote);
      const pfList = _el('div', 'wiz8-prefilter-list');
      preFiltered.forEach(wq => {
        const article = _getArticleForRisk(wq.risk_name);
        const artNum  = article?.article_name.match(/^(Article \d+[a-zA-Z]*)/)?.[1] || '';
        const row = _el('div', 'wiz8-prefilter-item');
        row.appendChild(_el('span', 'wiz8-prefilter-risk-name', { textContent: wq.risk_name }));
        if (artNum) row.appendChild(_el('span', 'wiz8-prefilter-art-tag', { textContent: artNum }));
        pfList.appendChild(row);
      });
      card.appendChild(pfList);
    }

    // Actions
    const actRow = _el('div', 'wiz-action-row');
    const applyBtn = document.createElement('button');
    applyBtn.className = 'wiz-btn-primary';
    applyBtn.textContent = 'Save Legal Assessment ✓';
    applyBtn.addEventListener('click', _handleSaveLegal);
    actRow.appendChild(applyBtn);

    const reviewBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--back');
    reviewBtn.textContent = '← Review & Edit Rationales';
    reviewBtn.style.marginLeft = 'auto';
    reviewBtn.addEventListener('click', () => {
      _wizState.step_index = 0;
      _wizState.complete   = false;
      _renderLegalPane();
    });
    actRow.appendChild(reviewBtn);

    const restartBtn = _el('button', 'wiz8-q-nav-btn');
    restartBtn.textContent = '↺ Start over';
    restartBtn.style.marginLeft = '8px';
    restartBtn.style.opacity = '0.7';
    restartBtn.addEventListener('click', () => {
      _wizState.step_index = 0;
      _wizState.answers    = {};
      _wizState.rationales = {};
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
    if (!_record['step-5']) _record['step-5'] = {};
    _record['step-5'].legal_assessment = _buildLegalOutputRecord();
    WizUtils.saveRecord(_record);
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
        rationale:     _wizState.rationales[wq.risk_name] || '',
        relevance:     _computeRelevance(wq.risk_name)
      };
    });
    const sel = risks.filter(r => r.selected).length;
    return {
      completed:          true,
      assessment_date:    today,
      wizard_answers:     { ..._wizState.answers },
      wizard_rationales:  { ..._wizState.rationales },
      total_risks:        wqs.length,
      selected_count:     sel,
      risks
    };
  }

  // ---- Combined Review pane -----------------------------------
  function _buildCombinedReviewPane() {
    const card = _el('div', 'step-detail-card');

    const title = _el('h2', 'step-detail-title');
    title.textContent = 'Risk Identification Review';
    card.appendChild(title);

    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Read-only view of the legal/regulatory assessment. Complete the Legal/Regulatory Risk Identification tab and save before proceeding to Step 9.';
    card.appendChild(sub);

    card.appendChild(_sectionLabel('Input Sources'));
    card.appendChild(_buildStep3Card());
    card.appendChild(_buildDpiaCard());

    card.appendChild(_sectionLabel('Legal / Regulatory Risk Assessment (EU AI Act)'));
    const saved8 = _record?.['step-5'];
    card.appendChild(_buildReviewSection(
      'Legal / Regulatory Risk Assessment (EU AI Act)',
      'Completed by the compliance / DPO team using the Legal/Regulatory Risk Identification tab.',
      saved8?.legal_assessment, 'legal'
    ));

    const legalDone = !!saved8?.legal_assessment?.completed;
    const gateRow   = _el('div', 'wiz8-review-gate');

    if (!legalDone) {
      const warn = _el('div', 'wiz8-review-warn');
      warn.innerHTML = `<strong>⚠ Incomplete:</strong> Legal/Regulatory assessment not yet saved. Complete the Legal/Regulatory Risk Identification tab before proceeding to Step 9.`;
      gateRow.appendChild(warn);
    } else {
      const ok = _el('div', 'wiz8-review-complete');
      const total = saved8.legal_assessment.selected_count || 0;
      ok.innerHTML = `<strong>✓ Assessment complete.</strong> ${total} risk${total !== 1 ? 's' : ''} confirmed. Proceed to Step 6 (Control Identification).`;
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
      empty.textContent = 'Open the Legal/Regulatory Risk Identification tab and save to populate this section.';
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
        const icon = _el('span', 'wiz8-review-risk-icon--legal');
        icon.textContent = '⚖';
        row.appendChild(icon);
        const nm = _el('span', 'wiz8-review-risk-name'); nm.textContent = r.risk_name || r.risk_id || ''; row.appendChild(nm);
        if (r.wizard_answer === 'partially') {
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
    const card = _el('div', 'wiz8-source-card wiz5-source-card--dpia');
    if (!_step7Data) {
      const w = _el('div', 'wiz8-info');
      w.innerHTML = '<strong>Step 4 (Data identification and DPIA) not yet completed.</strong> Complete the DPIA to sharpen relevance scoring with data inventory context.';
      card.appendChild(w); return card;
    }
    const lbl = _el('p', 'wiz8-source-label'); lbl.textContent = 'Step 4 — Data identification and DPIA'; card.appendChild(lbl);
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
    sub.textContent = 'Complete risk catalogue grouped by standard / requirement, with guidance from step5-legal-risk-guidance.json. Edit that file to adapt analogues, conditions, and relevance rules for your organisation.';
    card.appendChild(sub);

    // Category legend
    if (_legalGuidance?.categories) {
      card.appendChild(_sectionLabel('Risk Categories'));
      const legend = _el('div', 'wiz8-cat-legend');
      Object.entries(_legalGuidance.categories).forEach(([name, info]) => {
        const item = _el('div', 'wiz8-cat-legend-item');
        const tag  = _el('span', 'wiz8-cat-tag');
        tag.textContent = name;
        const c = _catColor(info.color || 'slate');
        tag.style.background = c.bg; tag.style.color = c.text;
        item.appendChild(tag);
        const desc = _el('span', 'wiz8-cat-legend-desc'); desc.textContent = info.description; item.appendChild(desc);
        legend.appendChild(item);
      });
      card.appendChild(legend);
    }

    card.appendChild(_sectionLabel('All Risks by Article'));

    // Group EU AI Act risks by article name from tbl_ data
    const stepMap = new Map(); // article_name → [{jkName, ...}]
    const euRisks = _tblRisks ? _tblRisks.filter(r => r.risk_source === 'EU_AI_Act') : [];
    for (const risk of euRisks) {
      const articleName = _articleById?.get(risk.fk_AI_Article_ID)?.article_name
        || risk.fk_AI_Article_ID;
      if (!stepMap.has(articleName)) stepMap.set(articleName, []);
      if (!stepMap.get(articleName).find(r => r.jkName === risk.risk_name)) {
        stepMap.get(articleName).push({ jkName: risk.risk_name });
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
          const c = _catColor(_legalGuidance.categories?.[g.category]?.color || 'slate');
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
    WizUtils.injectStyles('wiz5-styles', `
/* Source cards */
.wiz8-source-card{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz5-source-card--dpia{background:#faf5ff;border-color:#ddd6fe}
.wiz8-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#0284c7;margin:0 0 10px}
.wiz5-source-card--dpia .wiz8-source-label{color:#7c3aed}
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
.wiz8-q-btn-row{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.wiz8-rationale-wrap{margin-bottom:20px;border-top:1px solid var(--color-border,#e5e7eb);padding-top:14px;margin-top:4px}
.wiz8-rationale-lbl{display:block;font-size:12px;font-weight:700;color:var(--color-text-secondary,#374151);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
.wiz8-rationale-ta{width:100%;box-sizing:border-box;font-size:13px;font-family:inherit;color:var(--color-text-primary);border:1px solid var(--color-border,#e2e8f0);border-radius:6px;padding:10px 12px;line-height:1.6;resize:vertical;background:var(--color-bg-subtle,#f8fafc);min-height:80px}
.wiz8-rationale-ta:focus{outline:none;border-color:#0d9488;background:#fff}
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

/* ---- Source badges ---- */
.wiz8-diag-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;line-height:1.4}
.wiz8-diag-src-badge--eu{background:#dbeafe;color:#1e40af}

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

/* Pre-filter styles (Step 3 classification → legal risk filtering) */
.wiz8-q-card--prefiltered{opacity:.75;border-left:3px solid #fed7aa}
.wiz8-prefilter-note{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:9px 13px;font-size:12px;color:#92400e;line-height:1.55;margin-bottom:14px}
.wiz8-prefilter-summary{background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:10px 14px;font-size:12px;color:#92400e;line-height:1.6;margin-bottom:10px}
.wiz8-prefilter-list{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
.wiz8-prefilter-item{display:flex;align-items:center;gap:8px;padding:5px 10px;background:#fff;border:1px solid #fed7aa;border-radius:5px;flex-wrap:wrap}
.wiz8-prefilter-risk-name{font-size:12px;font-weight:600;color:var(--color-text-primary);flex:1;min-width:0}
.wiz8-prefilter-art-tag{font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px;background:#ffedd5;color:#9a3412;white-space:nowrap}

/* Ask JAKE collapsible */
.s5-jake-section{margin:16px 24px;border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.s5-jake-header{padding:12px 16px;background:var(--teal-50,#f0fdfa);cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:12px}
.s5-jake-header:hover{background:var(--teal-100,#ccfbf1)}
.s5-jake-header-left{flex:1}
.s5-jake-header-left .section-label{margin-bottom:0}
.s5-jake-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.s5-jake-body{padding:14px 16px;border-top:1px solid var(--color-border)}
.s5-jake-chevron{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
.s5-jake-instructions{font-size:12px;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:12px 14px;margin-bottom:14px;line-height:1.6}
.s5-prompt-wrap{display:flex;flex-direction:column;gap:8px}
.s5-prompt-area{width:100%;padding:12px;border:1px solid var(--color-border-mid);border-radius:6px;font-size:11px;font-family:var(--font-mono,monospace);color:var(--color-text-secondary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.6}
    `);
  }

})();
