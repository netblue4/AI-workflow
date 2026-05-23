/* Step 8 — Risk Assessment Wizard (Guided)
   Hierarchy: fieldGroup.jkName → risks → Attack Vectors
   Guidance (analogues, applies-if, relevance, categories) loaded from step8-guidance.json.
   Selection at risk level. Identity from central _meta.
   Informed by Step 3 (RCN filter + relevance) and Step 7 (DPIA data types + relevance).
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _framework = null, _guidance = null, _record = null;
  let _step3Data = null, _step7Data = null;
  let _filteredFGItems = []; // [{fieldGroupName, risks:[...]}]

  const _state = {
    selected_risks:  {},  // riskName → boolean
    relevance_filter: 'all' // 'all' | 'high'
  };

  // Guided wizard state
  const _wizState = {
    step_index: 0,      // current question index (0-based)
    answers:    {},     // riskName → 'yes'|'partially'|'no'
    complete:   false
  };

  let _searchQuery = '';

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
    _framework  = null;
    _guidance   = null;
    _record     = null;
    _step3Data  = null;
    _step7Data  = null;
    _filteredFGItems = [];
    _state.selected_risks  = {};
    _state.relevance_filter = 'all';
    _searchQuery = '';
    _wizState.step_index = 0;
    _wizState.answers    = {};
    _wizState.complete   = false;

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
    // Load framework and guidance in parallel
    const [fwRes, gdRes] = await Promise.allSettled([
      fetch('ai_Risk_Control_Framework.json'),
      fetch('step8-guidance.json')
    ]);

    if (fwRes.status === 'rejected' || !fwRes.value.ok) {
      pw.innerHTML = `<p style="padding:24px;color:var(--danger-600,#dc2626)">Could not load ai_Risk_Control_Framework.json</p>`;
      return;
    }
    _framework = await fwRes.value.json();

    if (gdRes.status === 'fulfilled' && gdRes.value.ok) {
      try { _guidance = await gdRes.value.json(); } catch (_) {}
    }

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

    _step3Data = _record?.['step-3'] ?? null;
    _step7Data = _record?.['step-7'] ?? null;

    // Restore prior selections + wizard answers
    const saved8 = _record?.['step-8'];
    if (saved8?.risks) {
      saved8.risks.forEach(r => { _state.selected_risks[r.risk_name] = r.selected; });
    }
    if (saved8?.wizard_answers) {
      Object.assign(_wizState.answers, saved8.wizard_answers);
      const wqs = _guidance?.wizard_questions;
      if (wqs && Object.keys(_wizState.answers).length >= wqs.length) {
        _wizState.complete = true;
      }
    }

    _filteredFGItems = _buildFGItems();

    // Default: select all if no prior state
    if (Object.keys(_state.selected_risks).length === 0) {
      _filteredFGItems.forEach(fg =>
        fg.risks.forEach(r => { _state.selected_risks[r.jkName] = true; })
      );
    }

    _renderPanes(pw);
  }

  // ---- RCN → fieldGroup name map ------------------------------
  function _buildRcnToFGMap() {
    const map = {};
    (_framework?.['1. Compliance Requirements'] || []).forEach(article => {
      (article.Fields || []).forEach(field => {
        if (field.jkType === 'fieldGroup') {
          (field.controls || []).forEach(ctrl => {
            if (ctrl.requirement_control_number) map[ctrl.requirement_control_number] = field.jkName;
          });
        }
      });
    });
    return map;
  }

  // ---- Build fieldGroup → risks structure ---------------------
  function _buildFGItems() {
    if (!_framework) return [];
    const rcnToFG  = _buildRcnToFGMap();
    const applicable = _step3Data?.all_requirement_control_numbers
      ? new Set(_step3Data.all_requirement_control_numbers) : null;
    const allItems = Object.values(_framework).reduce(
      (acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []
    );
    const fgMap = new Map();

    for (const item of allItems) {
      for (const field of (item.Fields || [])) {
        if (field.jkType !== 'risk') continue;
        const matchedFGs = new Set();
        const matchedControls = [];

        for (const ctrl of (field.controls || [])) {
          const rcns = (ctrl.requirement_control_number || '')
            .split(',').map(s => s.trim()).filter(Boolean);
          const applicable_ = applicable ? rcns.some(r => applicable.has(r)) : true;
          if (!applicable_) continue;
          matchedControls.push(ctrl);
          rcns.forEach(rcn => { const fg = rcnToFG[rcn]; if (fg) matchedFGs.add(fg); });
        }

        if (matchedControls.length === 0) continue;

        const attackVectors = matchedControls.map(c => c.jkAttackVector).filter(Boolean);
        const riskObj = {
          jkName:          field.jkName,
          RiskDescription: field.RiskDescription || '',
          role:            field.Role || '',
          attackVectors,
          fieldGroups:     Array.from(matchedFGs)
        };

        if (matchedFGs.size === 0) continue;
        matchedFGs.forEach(fg => {
          if (!fgMap.has(fg)) fgMap.set(fg, []);
          const arr = fgMap.get(fg);
          if (!arr.find(r => r.jkName === riskObj.jkName)) arr.push(riskObj);
        });
      }
    }

    // Sort risks within each fieldGroup: HIGH relevance first
    return Array.from(fgMap.entries()).map(([fieldGroupName, risks]) => ({
      fieldGroupName,
      risks: risks.slice().sort((a, b) => {
        const ra = _computeRelevance(a.jkName);
        const rb = _computeRelevance(b.jkName);
        if (ra === rb) return 0;
        return ra === 'high' ? -1 : 1;
      })
    }));
  }

  // ---- Relevance computation (uses step8-guidance.json) ------
  function _computeRelevance(riskName) {
    if (!_guidance) return 'unassessed';
    const g = _guidance.risks?.[riskName];
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
    [['guided', 'Guided'], ['browse', 'Browse All'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
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
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const guided = _el('div', 'wiz-pane');             guided.dataset.pane = 'guided';
    const browse = _el('div', 'wiz-pane wiz-pane--hidden'); browse.dataset.pane = 'browse';
    const ref    = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane    = 'reference';
    guided.appendChild(_buildGuidedPane());
    browse.appendChild(_buildWizardPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(guided); pw.appendChild(browse); pw.appendChild(ref);
  }

  // ---- Re-render guided pane in place -------------------------
  function _renderGuidedPane() {
    const pane = _container.querySelector('[data-pane="guided"]');
    if (!pane) return;
    pane.innerHTML = '';
    pane.appendChild(_buildGuidedPane());
  }

  // ---- Guided pane dispatcher ---------------------------------
  function _buildGuidedPane() {
    const wqs = _guidance?.wizard_questions;
    if (!wqs?.length) {
      const card = _el('div', 'step-detail-card');
      const p = _el('p', 'wiz8-notice');
      p.innerHTML = 'No wizard questions defined. Add a <code>wizard_questions</code> array to <strong>step8-guidance.json</strong> to enable guided mode.';
      card.appendChild(p);
      return card;
    }
    if (_wizState.complete) return _buildWizardSummary();
    return _buildQuestionScreen(_wizState.step_index);
  }

  // ---- Single question screen ---------------------------------
  function _buildQuestionScreen(idx) {
    const wqs   = _guidance.wizard_questions;
    const total = wqs.length;
    const wq    = wqs[idx];
    const riskG = _guidance.risks?.[wq.risk_name];
    const relevance = _computeRelevance(wq.risk_name);
    const category  = riskG?.category || null;
    const catColor  = category ? (_guidance.categories?.[category]?.color || 'slate') : 'slate';
    const catColors = _CAT_COLORS[catColor] || _CAT_COLORS.slate;
    const answer    = _wizState.answers[wq.risk_name] || null;

    const wrap = _el('div', 'wiz8-guided-wrap');

    // Progress bar
    const progWrap = _el('div', 'wiz8-guided-prog-wrap');
    const progMeta = _el('div', 'wiz8-guided-prog-meta');
    const progTitle = _el('span', 'wiz8-guided-prog-title');
    progTitle.textContent = 'Guided Risk Assessment';
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
      _renderGuidedPane();
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
      backBtn.addEventListener('click', () => { _wizState.step_index = idx - 1; _renderGuidedPane(); });
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
      nextBtn.addEventListener('click', () => { _wizState.step_index = idx + 1; _renderGuidedPane(); });
      navRight.appendChild(nextBtn);
    } else {
      const finBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--finish');
      finBtn.textContent = 'Finish ✓';
      finBtn.addEventListener('click', () => { _wizState.complete = true; _renderGuidedPane(); });
      navRight.appendChild(finBtn);
    }
    navRow.appendChild(navRight);
    wrap.appendChild(navRow);

    return wrap;
  }

  // ---- Summary screen (after wizard completes) ----------------
  function _buildWizardSummary() {
    const wqs = _guidance.wizard_questions;

    const applicable = wqs.filter(wq => ['yes', 'partially'].includes(_wizState.answers[wq.risk_name]));
    const excluded   = wqs.filter(wq => _wizState.answers[wq.risk_name] === 'no');
    const skipped    = wqs.filter(wq => !_wizState.answers[wq.risk_name]);
    const highApp    = applicable.filter(wq => _computeRelevance(wq.risk_name) === 'high');

    // Group applicable by category
    const byCategory = {};
    applicable.forEach(wq => {
      const cat = _guidance.risks?.[wq.risk_name]?.category || 'Other';
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
    tickTitle.textContent = 'Guided Assessment Complete';
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
        const c = _CAT_COLORS[_guidance.categories?.[cat]?.color || 'slate'] || _CAT_COLORS.slate;
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
      skipNote.textContent = `${skipped.length} risk${skipped.length !== 1 ? 's' : ''} skipped — they will keep their existing selection in Browse All.`;
      card.appendChild(skipNote);
    }

    // Actions
    const actRow = _el('div', 'wiz-action-row');
    const applyBtn = document.createElement('button');
    applyBtn.className = 'wiz-btn-primary';
    applyBtn.textContent = 'Apply to Risk Assessment →';
    applyBtn.addEventListener('click', _applyWizardAnswers);
    actRow.appendChild(applyBtn);

    const restartBtn = _el('button', 'wiz8-q-nav-btn wiz8-q-nav-btn--back');
    restartBtn.textContent = '↺  Start over';
    restartBtn.style.marginLeft = 'auto';
    restartBtn.addEventListener('click', () => {
      _wizState.step_index = 0;
      _wizState.answers    = {};
      _wizState.complete   = false;
      _renderGuidedPane();
    });
    actRow.appendChild(restartBtn);
    card.appendChild(actRow);

    wrap.appendChild(card);
    return wrap;
  }

  // ---- Apply wizard answers to Browse All ---------------------
  function _applyWizardAnswers() {
    const wqs = _guidance?.wizard_questions || [];
    wqs.forEach(wq => {
      const ans = _wizState.answers[wq.risk_name];
      if (ans === 'yes' || ans === 'partially') {
        _state.selected_risks[wq.risk_name] = true;
      } else if (ans === 'no') {
        _state.selected_risks[wq.risk_name] = false;
      }
      // 'skip' / undefined → leave existing selection unchanged
    });
    _syncAllCheckboxes();
    _switchTab('browse');

    // Banner confirmation at top of Browse All
    const browsePane = _container.querySelector('[data-pane="browse"]');
    if (browsePane) {
      const existing = browsePane.querySelector('.wiz8-applied-banner');
      if (existing) existing.remove();
      const applied = wqs.filter(wq => ['yes', 'partially'].includes(_wizState.answers[wq.risk_name])).length;
      const banner = _el('div', 'wiz8-applied-banner');
      banner.innerHTML = `✓ Guided assessment applied — <strong>${applied} risk${applied !== 1 ? 's' : ''}</strong> confirmed as applicable. Review the selections below, then click <strong>Save Risk Assessment</strong>.`;
      const firstCard = browsePane.querySelector('.step-detail-card');
      if (firstCard) firstCard.insertBefore(banner, firstCard.firstChild);
      setTimeout(() => banner?.remove(), 10000);
    }
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

    if (_step.deliverables?.length) {
      card.appendChild(_sectionLabel('Deliverables'));
      const dl = _el('ul', 'deliverables-list');
      _step.deliverables.forEach(d => {
        const li = _el('li', 'deliverable-item'); li.textContent = d; dl.appendChild(li);
      });
      card.appendChild(dl);
    }

    card.appendChild(_sectionLabel('Input Sources'));
    card.appendChild(_buildStep3Card());
    card.appendChild(_buildDpiaCard());

    card.appendChild(_sectionLabel('Risk Assessment'));

    const uniqueRisks = new Set(_filteredFGItems.flatMap(fg => fg.risks.map(r => r.jkName)));
    const highCount   = Array.from(uniqueRisks).filter(n => _computeRelevance(n) === 'high').length;
    const totalFGs    = _filteredFGItems.length;
    const totalRisks  = uniqueRisks.size;

    if (totalRisks === 0 && _step3Data) {
      const notice = _el('p', 'wiz8-notice');
      notice.textContent = 'No applicable risks found for this classification.';
      card.appendChild(notice);
    } else {
      // Summary line
      const instr = _el('p', 'wiz8-instruction');
      const guidanceSuffix = _guidance ? '' : ' (install step8-guidance.json for relevance scoring and guidance)';
      instr.innerHTML = `<strong>${totalRisks} risk${totalRisks !== 1 ? 's' : ''}</strong> across <strong>${totalFGs} compliance control area${totalFGs !== 1 ? 's' : ''}</strong>${_step3Data ? '' : ' (all risks — complete Step 3 for filtered view)'}. ${highCount > 0 ? `<strong class="wiz8-high-count">${highCount} HIGH-relevance</strong> risks identified for your system. ` : ''}Review each risk below.${guidanceSuffix}`;
      card.appendChild(instr);

      // Filter bar
      if (_guidance) card.appendChild(_buildFilterBar());

      // Search box
      card.appendChild(_buildSearchBox());

      // Risk list
      const riskList = _el('div', 'wiz8-risk-list');
      _filteredFGItems.forEach(fg => riskList.appendChild(_buildFGSection(fg)));
      card.appendChild(riskList);
    }

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'wiz8-results'));
    return card;
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

  // ---- Filter bar ---------------------------------------------
  function _buildFilterBar() {
    const bar = _el('div', 'wiz8-filter-bar');
    const lbl = _el('span', 'wiz8-filter-label'); lbl.textContent = 'Show:'; bar.appendChild(lbl);

    const allBtn = document.createElement('button');
    allBtn.className = `wiz8-filter-btn${_state.relevance_filter === 'all' ? ' wiz8-filter-btn--active' : ''}`;
    allBtn.textContent = 'All risks';
    allBtn.addEventListener('click', () => {
      _state.relevance_filter = 'all';
      _syncFilterButtons();
      _applyRelevanceFilter();
    });
    bar.appendChild(allBtn);

    const highBtn = document.createElement('button');
    highBtn.className = `wiz8-filter-btn wiz8-filter-btn--high${_state.relevance_filter === 'high' ? ' wiz8-filter-btn--active' : ''}`;
    highBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>HIGH relevance only`;
    highBtn.addEventListener('click', () => {
      _state.relevance_filter = 'high';
      _syncFilterButtons();
      _applyRelevanceFilter();
    });
    bar.appendChild(highBtn);

    return bar;
  }

  function _syncFilterButtons() {
    const bar = _container.querySelector('.wiz8-filter-bar');
    if (!bar) return;
    const [allBtn, highBtn] = bar.querySelectorAll('.wiz8-filter-btn');
    if (allBtn)  allBtn.classList.toggle('wiz8-filter-btn--active',  _state.relevance_filter === 'all');
    if (highBtn) highBtn.classList.toggle('wiz8-filter-btn--active', _state.relevance_filter === 'high');
  }

  function _applyRelevanceFilter() {
    const riskList = _container.querySelector('.wiz8-risk-list');
    if (!riskList) return;
    const filterHigh = _state.relevance_filter === 'high';

    riskList.querySelectorAll('.wiz8-fg').forEach(fgEl => {
      let fgHasVisible = false;
      fgEl.querySelectorAll('.wiz8-risk-card').forEach(riskEl => {
        const relevance = riskEl.dataset.relevance;
        const hide = filterHigh && relevance !== 'high';
        riskEl.classList.toggle('wiz8-filter-hidden', hide);
        if (!hide) fgHasVisible = true;
      });
      fgEl.classList.toggle('wiz8-filter-hidden', filterHigh && !fgHasVisible);
    });
  }

  // ---- FieldGroup accordion (top level) -----------------------
  function _buildFGSection(fg) {
    const highInFG = fg.risks.filter(r => _computeRelevance(r.jkName) === 'high').length;
    const sec = _el('div', 'wiz8-fg');

    const header = _el('div', 'wiz8-fg-header');
    const left   = _el('div', 'wiz8-fg-header-left');
    const nm = _el('span', 'wiz8-fg-name'); nm.textContent = fg.fieldGroupName; left.appendChild(nm);
    const rb = _el('span', 'wiz8-badge-risks');
    rb.textContent = `${fg.risks.length} risk${fg.risks.length !== 1 ? 's' : ''}`; left.appendChild(rb);
    if (highInFG > 0) {
      const hb = _el('span', 'wiz8-badge-high');
      hb.textContent = `${highInFG} HIGH`; left.appendChild(hb);
    }
    header.appendChild(left);

    const right = _el('div', 'wiz8-fg-header-right');
    const selAll = document.createElement('button'); selAll.className = 'wiz8-sel-btn'; selAll.textContent = 'Select all';
    selAll.addEventListener('click', e => { e.stopPropagation(); _setFGSel(fg, true); }); right.appendChild(selAll);
    const deselAll = document.createElement('button'); deselAll.className = 'wiz8-sel-btn'; deselAll.textContent = 'Deselect all';
    deselAll.addEventListener('click', e => { e.stopPropagation(); _setFGSel(fg, false); }); right.appendChild(deselAll);
    const selCount = _el('span', 'wiz8-fg-sel-count'); right.appendChild(selCount);
    const chevron = _el('span', 'wiz8-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)';
    right.appendChild(chevron);
    header.appendChild(right);
    sec.appendChild(header);

    const body = _el('div', 'wiz8-fg-body wiz8-collapsed');
    fg.risks.forEach(risk => body.appendChild(_buildRiskCard(risk)));
    sec.appendChild(body);
    _updateFGBadge(sec);

    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('wiz8-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
    return sec;
  }

  function _setFGSel(fg, selected) {
    fg.risks.forEach(r => { _state.selected_risks[r.jkName] = selected; });
    _syncAllCheckboxes();
  }

  // ---- Risk card (with guidance) ------------------------------
  function _buildRiskCard(risk) {
    const relevance = _computeRelevance(risk.jkName);
    const guidance  = _guidance?.risks?.[risk.jkName];
    const category  = guidance?.category || null;
    const catColor  = category
      ? (_guidance?.categories?.[category]?.color || 'slate')
      : 'slate';
    const catColors = _CAT_COLORS[catColor] || _CAT_COLORS.slate;

    const card = _el('div', 'wiz8-risk-card');
    card.dataset.riskName  = risk.jkName;
    card.dataset.relevance = relevance;

    // ---- Header row: checkbox + icon + name + category + relevance ----
    const riskHeader = _el('div', 'wiz8-risk-header');

    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wiz8-risk-cb';
    cb.dataset.riskName = risk.jkName;
    cb.checked = !!_state.selected_risks[risk.jkName];
    cb.addEventListener('change', e => {
      _state.selected_risks[risk.jkName] = e.target.checked;
      _container.querySelectorAll(`.wiz8-risk-cb[data-risk-name="${CSS.escape(risk.jkName)}"]`)
        .forEach(c => { c.checked = e.target.checked; });
      _updateAllFGBadges(); _updateCountBadge();
    });
    riskHeader.appendChild(cb);

    const riskIcon = _el('span', 'wiz8-risk-icon');
    riskIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    riskHeader.appendChild(riskIcon);

    const riskName = _el('span', 'wiz8-risk-name'); riskName.textContent = risk.jkName; riskHeader.appendChild(riskName);

    // Category tag (from guidance JSON)
    if (category) {
      const catTag = _el('span', 'wiz8-cat-tag');
      catTag.textContent = category;
      catTag.style.background = catColors.bg;
      catTag.style.color = catColors.text;
      riskHeader.appendChild(catTag);
    }

    // Relevance badge
    if (relevance !== 'unassessed') {
      const relBadge = _el('span', `wiz8-rel-badge wiz8-rel-badge--${relevance}`);
      relBadge.textContent = relevance === 'high' ? '▲ HIGH' : '◆ MEDIUM';
      riskHeader.appendChild(relBadge);
    }

    if (risk.role) {
      const rb = _el('span', 'wiz8-role-badge'); rb.textContent = risk.role; riskHeader.appendChild(rb);
    }
    card.appendChild(riskHeader);

    // ---- Traditional IT analogue --------------------------------
    if (guidance?.traditional_analog) {
      const analogRow = _el('div', 'wiz8-analog-row');
      const analogIcon = _el('span', 'wiz8-analog-icon');
      analogIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      analogRow.appendChild(analogIcon);
      const analogText = _el('span', 'wiz8-analog-text');
      analogText.textContent = guidance.traditional_analog;
      analogRow.appendChild(analogText);
      card.appendChild(analogRow);
    }

    // ---- Applies-if checklist -----------------------------------
    if (guidance?.applies_if?.length) {
      const aiWrap = _el('div', 'wiz8-applies-wrap');
      const aiLabel = _el('p', 'wiz8-applies-label');
      aiLabel.textContent = 'Applies if any of:';
      aiWrap.appendChild(aiLabel);
      const aiList = _el('ul', 'wiz8-applies-list');
      guidance.applies_if.forEach(condition => {
        const li = _el('li', 'wiz8-applies-item'); li.textContent = condition; aiList.appendChild(li);
      });
      aiWrap.appendChild(aiList);
      card.appendChild(aiWrap);
    }

    // ---- Detailed risk description (collapsible) ----------------
    if (risk.RiskDescription) {
      card.appendChild(_buildCollapsibleDesc(risk.RiskDescription));
    }

    // ---- Attack Vectors (collapsible) ---------------------------
    if (risk.attackVectors.length > 0) {
      card.appendChild(_buildAttackVectorsDiv(risk.attackVectors));
    }

    return card;
  }

  function _buildCollapsibleDesc(text) {
    const wrap    = _el('div', 'wiz8-desc-wrap');
    const hdr     = _el('div', 'wiz8-desc-header');
    const icon    = _el('span', 'wiz8-desc-icon');
    icon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    hdr.appendChild(icon);
    const lbl = _el('span', 'wiz8-desc-label'); lbl.textContent = 'Detailed risk description'; hdr.appendChild(lbl);
    const chv = _el('span', 'wiz8-desc-chevron');
    chv.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chv.style.transform = 'rotate(-90deg)'; hdr.appendChild(chv);
    wrap.appendChild(hdr);
    const body = _el('div', 'wiz8-desc-body wiz8-collapsed');
    const p = _el('p', 'wiz8-risk-desc-text'); p.textContent = text; body.appendChild(p);
    wrap.appendChild(body);
    hdr.addEventListener('click', () => {
      const col = body.classList.toggle('wiz8-collapsed');
      chv.style.transform = col ? 'rotate(-90deg)' : '';
    });
    return wrap;
  }

  function _buildAttackVectorsDiv(attackVectors) {
    const wrap = _el('div', 'wiz8-av-wrap');
    const hdr  = _el('div', 'wiz8-av-header');
    const icon = _el('span', 'wiz8-av-icon');
    icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    hdr.appendChild(icon);
    const lbl = _el('span', 'wiz8-av-label');
    lbl.textContent = `Attack Vectors (${attackVectors.length})`; hdr.appendChild(lbl);
    const chv = _el('span', 'wiz8-av-chevron');
    chv.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chv.style.transform = 'rotate(-90deg)'; hdr.appendChild(chv);
    wrap.appendChild(hdr);
    const body = _el('div', 'wiz8-av-body wiz8-collapsed');
    attackVectors.forEach((av, i) => {
      const item = _el('div', 'wiz8-av-item');
      const num  = _el('span', 'wiz8-av-num'); num.textContent = String(i + 1); item.appendChild(num);
      const txt  = _el('p', 'wiz8-av-text'); txt.textContent = av; item.appendChild(txt);
      body.appendChild(item);
    });
    wrap.appendChild(body);
    hdr.addEventListener('click', () => {
      const col = body.classList.toggle('wiz8-collapsed');
      chv.style.transform = col ? 'rotate(-90deg)' : '';
    });
    return wrap;
  }

  // ---- Sync helpers -------------------------------------------
  function _syncAllCheckboxes() {
    _container.querySelectorAll('.wiz8-risk-cb').forEach(cb => {
      cb.checked = !!_state.selected_risks[cb.dataset.riskName];
    });
    _updateAllFGBadges(); _updateCountBadge();
  }

  function _updateAllFGBadges() {
    _container.querySelectorAll('.wiz8-fg').forEach(el => _updateFGBadge(el));
  }

  function _updateFGBadge(secEl) {
    const all   = secEl.querySelectorAll('.wiz8-risk-cb');
    const chkd  = secEl.querySelectorAll('.wiz8-risk-cb:checked');
    const badge = secEl.querySelector('.wiz8-fg-sel-count');
    if (!badge) return;
    const sel = chkd.length, tot = all.length;
    badge.textContent = `${sel} / ${tot}`;
    badge.className = sel === 0
      ? 'wiz8-fg-sel-count wiz8-fg-sel-count--none'
      : sel === tot
        ? 'wiz8-fg-sel-count wiz8-fg-sel-count--all'
        : 'wiz8-fg-sel-count wiz8-fg-sel-count--partial';
  }

  function _updateCountBadge() {
    const unique = new Set(_filteredFGItems.flatMap(fg => fg.risks.map(r => r.jkName)));
    const sel = Array.from(unique).filter(n => _state.selected_risks[n]).length;
    const badge = _container.querySelector('#wiz8-count');
    if (badge) badge.textContent = `${sel} / ${unique.size} risks confirmed`;
  }

  // ---- Search box ---------------------------------------------
  function _buildSearchBox() {
    const wrap = _el('div', 'wiz8-search-wrap');
    const icon = _el('span', 'wiz8-search-icon');
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    wrap.appendChild(icon);
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'wiz8-search-input';
    inp.placeholder = 'Search risks, analogues, applies-if, attack vectors… e.g. MFA, bias, logging';
    inp.value = _searchQuery;
    const matchCount = _el('span', 'wiz8-search-count');
    const clearBtn   = _el('button', 'wiz8-search-clear');
    clearBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    clearBtn.style.display = _searchQuery ? 'flex' : 'none';
    clearBtn.title = 'Clear search';
    inp.addEventListener('input', e => {
      _searchQuery = e.target.value;
      _applySearch(_searchQuery);
      clearBtn.style.display = _searchQuery ? 'flex' : 'none';
      matchCount.textContent = _searchQuery ? _countVisibleRisks() : '';
    });
    clearBtn.addEventListener('click', () => {
      inp.value = ''; _searchQuery = ''; _applySearch('');
      clearBtn.style.display = 'none'; matchCount.textContent = ''; inp.focus();
    });
    wrap.appendChild(inp); wrap.appendChild(clearBtn); wrap.appendChild(matchCount);
    return wrap;
  }

  function _applySearch(query) {
    const riskList = _container.querySelector('.wiz8-risk-list');
    if (!riskList) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      riskList.querySelectorAll('.wiz8-fg, .wiz8-risk-card').forEach(el => el.classList.remove('wiz8-search-hidden'));
      _updateVisibilityAfterSearch();
      return;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const matches = text => tokens.every(t => text.toLowerCase().includes(t));

    riskList.querySelectorAll('.wiz8-fg').forEach(fgEl => {
      let fgVisible = false;
      const fgName  = fgEl.querySelector('.wiz8-fg-name')?.textContent || '';

      fgEl.querySelectorAll('.wiz8-risk-card').forEach(riskEl => {
        const rn     = riskEl.querySelector('.wiz8-risk-name')?.textContent || '';
        const analog = riskEl.querySelector('.wiz8-analog-text')?.textContent || '';
        const applyT = Array.from(riskEl.querySelectorAll('.wiz8-applies-item')).map(e => e.textContent).join(' ');
        const avTx   = Array.from(riskEl.querySelectorAll('.wiz8-av-text')).map(e => e.textContent).join(' ');
        const descTx = riskEl.querySelector('.wiz8-risk-desc-text')?.textContent || '';
        const catT   = riskEl.querySelector('.wiz8-cat-tag')?.textContent || '';

        const fullText = rn + ' ' + analog + ' ' + applyT + ' ' + avTx + ' ' + descTx + ' ' + fgName + ' ' + catT;
        const visible  = matches(fullText);
        riskEl.classList.toggle('wiz8-search-hidden', !visible);
        if (visible) {
          fgVisible = true;
          // Auto-expand attack vectors if they match
          if (!matches(rn + ' ' + analog + ' ' + applyT) && matches(avTx)) {
            const avBody = riskEl.querySelector('.wiz8-av-body');
            const avChv  = riskEl.querySelector('.wiz8-av-chevron');
            if (avBody) avBody.classList.remove('wiz8-collapsed');
            if (avChv)  avChv.style.transform = '';
          }
        }
      });

      fgEl.classList.toggle('wiz8-search-hidden', !fgVisible);
      if (fgVisible) {
        const body = fgEl.querySelector('.wiz8-fg-body');
        const chv  = fgEl.querySelector('.wiz8-chevron');
        if (body) body.classList.remove('wiz8-collapsed');
        if (chv)  chv.style.transform = '';
      }
    });

    _updateVisibilityAfterSearch();
  }

  function _updateVisibilityAfterSearch() {
    // Re-apply relevance filter on top of search results
    _applyRelevanceFilter();
  }

  function _countVisibleRisks() {
    const riskList = _container.querySelector('.wiz8-risk-list');
    if (!riskList) return '';
    const n = riskList.querySelectorAll('.wiz8-risk-card:not(.wiz8-search-hidden):not(.wiz8-filter-hidden)').length;
    return n === 0 ? 'No matches' : `${n} risk${n !== 1 ? 's' : ''} match`;
  }

  // ---- Action row ---------------------------------------------
  function _buildActionRow() {
    const row  = _el('div', 'wiz-action-row');
    const left = _el('div');
    const badge = document.createElement('span');
    badge.id = 'wiz8-count'; badge.className = 'wiz8-count-lg';
    const unique = new Set(_filteredFGItems.flatMap(fg => fg.risks.map(r => r.jkName)));
    const sel = Array.from(unique).filter(n => _state.selected_risks[n]).length;
    badge.textContent = `${sel} / ${unique.size} risks confirmed`;
    left.appendChild(badge); row.appendChild(left);
    const right = _el('div', 'wiz8-action-right');
    const btn = document.createElement('button');
    btn.className = 'wiz-btn-primary'; btn.textContent = 'Save Risk Assessment';
    btn.addEventListener('click', _handleSave); right.appendChild(btn); row.appendChild(right);
    return row;
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    const rec8 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-8'] = rec8;
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 8 saved ✓');
    _renderResults(rec8);
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};
    const uniqueMap = new Map();
    _filteredFGItems.forEach(fg => {
      fg.risks.forEach(r => {
        if (!uniqueMap.has(r.jkName)) {
          const guidance = _guidance?.risks?.[r.jkName];
          uniqueMap.set(r.jkName, {
            risk_name:           r.jkName,
            risk_description:    r.RiskDescription,
            category:            guidance?.category || null,
            field_groups:        r.fieldGroups,
            relevance:           _computeRelevance(r.jkName),
            attack_vector_count: r.attackVectors.length,
            selected:            !!_state.selected_risks[r.jkName]
          });
        }
      });
    });
    const risks         = Array.from(uniqueMap.values());
    const selectedCount = risks.filter(r => r.selected).length;
    const highSelected  = risks.filter(r => r.selected && r.relevance === 'high').length;
    return {
      step_id: 'step-8', step_title: 'Risk assessment',
      assessment_date: today,
      assessed_by:  meta.assessed_by || '',
      use_case_id:  meta.use_case_id || '',
      source_classification: _step3Data ? {
        ai_act_outcome:  _step3Data.axis_b?.ai_act_outcome,
        governance_tier: _step3Data.axis_a?.tier,
        combined_outcome: _step3Data.combined_outcome?.outcome_label
      } : null,
      dpia_summary: _step7Data ? {
        residual_risk_rating:      _step7Data.residual_risk_rating,
        special_category_data:     _step7Data.data_types_identified?.special_category_data || [],
        automated_decision_making: _step7Data.data_types_identified?.automated_decision_making
      } : null,
      total_risks: risks.length,
      selected_risks: selectedCount,
      high_relevance_selected: highSelected,
      excluded_risks: risks.length - selectedCount,
      wizard_answers: Object.keys(_wizState.answers).length ? { ..._wizState.answers } : null,
      risks
    };
  }

  function _renderResults(rec8) {
    const area = _container.querySelector('.wiz8-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'wiz8-result-card');
    const h = _el('h3', 'wiz8-result-title'); h.textContent = 'Risk Assessment Saved'; card.appendChild(h);
    const stats = _el('div', 'wiz8-result-stats');
    [
      [rec8.total_risks,             'Total risks'],
      [rec8.selected_risks,          'Confirmed applicable'],
      [rec8.high_relevance_selected, 'HIGH-relevance confirmed'],
      [rec8.excluded_risks,          'Excluded as not applicable']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl;
      s.appendChild(n); s.appendChild(l); stats.appendChild(s);
    });
    card.appendChild(stats);
    const note = _el('p', 'wiz8-result-note');
    note.innerHTML = `Risk assessment saved. <strong>${rec8.selected_risks} confirmed risk${rec8.selected_risks !== 1 ? 's' : ''}</strong> (including <strong>${rec8.high_relevance_selected} HIGH-relevance</strong>) will feed into Step 9 (Control identification). Use <strong>Save Record</strong> in the sidebar to download the full system record.`;
    card.appendChild(note);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane -----------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');
    const title = _el('h2', 'step-detail-title'); title.textContent = 'Risk Catalogue Reference'; card.appendChild(title);
    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Complete risk catalogue grouped by compliance control area, with guidance from step8-guidance.json. Edit that file to adapt analogues, conditions, and relevance rules for your organisation.';
    card.appendChild(sub);

    // Category legend
    if (_guidance?.categories) {
      card.appendChild(_sectionLabel('Risk Categories'));
      const legend = _el('div', 'wiz8-cat-legend');
      Object.entries(_guidance.categories).forEach(([name, info]) => {
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

    card.appendChild(_sectionLabel('All Risks by Compliance Control Area'));

    const rcnToFG  = _buildRcnToFGMap();
    const allItems = Object.values(_framework || {}).reduce((acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []);
    const fgMap    = new Map();
    allItems.forEach(item => {
      (item.Fields || []).filter(f => f.jkType === 'risk').forEach(risk => {
        const fgs = new Set();
        (risk.controls || []).forEach(ctrl => {
          (ctrl.requirement_control_number || '').split(',').map(s => s.trim()).forEach(rcn => {
            const fg = rcnToFG[rcn]; if (fg) fgs.add(fg);
          });
        });
        fgs.forEach(fg => {
          if (!fgMap.has(fg)) fgMap.set(fg, []);
          if (!fgMap.get(fg).find(r => r.jkName === risk.jkName)) fgMap.get(fg).push(risk);
        });
      });
    });

    fgMap.forEach((risks, fgName) => {
      const sec = _el('div', 'wiz8-ref-fg');
      const h3  = _el('div', 'wiz8-ref-fg-header');
      const nm  = _el('span', 'wiz8-ref-fg-name'); nm.textContent = fgName; h3.appendChild(nm);
      const cnt = _el('span', 'wiz8-count-badge'); cnt.textContent = `${risks.length} risk${risks.length !== 1 ? 's' : ''}`; h3.appendChild(cnt);
      sec.appendChild(h3);
      risks.forEach(risk => {
        const rd  = _el('div', 'wiz8-ref-risk');
        const g   = _guidance?.risks?.[risk.jkName];
        const rnh = _el('div', 'wiz8-ref-risk-header');
        const rn  = _el('p', 'wiz8-ref-risk-name'); rn.textContent = risk.jkName; rnh.appendChild(rn);
        if (g?.category) {
          const catTag = _el('span', 'wiz8-cat-tag');
          catTag.textContent = g.category;
          const c = _CAT_COLORS[_guidance.categories?.[g.category]?.color || 'slate'] || _CAT_COLORS.slate;
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
