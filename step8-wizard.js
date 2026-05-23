/* Step 8 — Risk Assessment Wizard
   Hierarchy: fieldGroup.jkName (from "1. Compliance Requirements") → risks → Attack Vectors
   Selection at risk level. Reads ai_Risk_Control_Framework.json.
   Identity from central _meta. Informed by Step 3 (filter) and Step 7 (DPIA data types).
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _framework = null, _record = null;
  let _step3Data = null, _step7Data = null;
  let _filteredFGItems = []; // [{fieldGroupName, risks:[{jkName,RiskDescription,role,attackVectors,fieldGroups}]}]

  const _state = {
    selected_risks: {} // riskName → boolean
  };

  let _searchQuery = '';

  // ---- Public API ---------------------------------------------
  window.mountStep8Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _framework  = null;
    _record     = null;
    _step3Data  = null;
    _step7Data  = null;
    _filteredFGItems = [];
    _state.selected_risks = {};
    _searchQuery = '';

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _framework = await res.json();
    } catch (e) {
      pw.innerHTML = `<p style="padding:24px;color:var(--danger-600,#dc2626)">Could not load ai_Risk_Control_Framework.json: ${e.message}</p>`;
      return;
    }

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

    _step3Data = _record?.['step-3'] ?? null;
    _step7Data = _record?.['step-7'] ?? null;

    // Restore prior selections
    const saved8 = _record?.['step-8'];
    if (saved8?.risks) {
      saved8.risks.forEach(r => { _state.selected_risks[r.risk_name] = r.selected; });
    }

    _filteredFGItems = _buildFGItems();

    // Default: select all risks if no prior state
    if (Object.keys(_state.selected_risks).length === 0) {
      _filteredFGItems.forEach(fg =>
        fg.risks.forEach(r => { _state.selected_risks[r.jkName] = true; })
      );
    }

    _renderPanes(pw);
  }

  // ---- Build RCN → fieldGroup name map from "1. Compliance Requirements" ---
  function _buildRcnToFGMap() {
    const map = {};
    (_framework?.['1. Compliance Requirements'] || []).forEach(article => {
      (article.Fields || []).forEach(field => {
        if (field.jkType === 'fieldGroup') {
          (field.controls || []).forEach(ctrl => {
            if (ctrl.requirement_control_number) {
              map[ctrl.requirement_control_number] = field.jkName;
            }
          });
        }
      });
    });
    return map;
  }

  // ---- Build filtered fieldGroup → risks structure -----------
  function _buildFGItems() {
    if (!_framework) return [];

    const rcnToFG = _buildRcnToFGMap();

    const applicable = _step3Data?.all_requirement_control_numbers
      ? new Set(_step3Data.all_requirement_control_numbers)
      : null;

    // Flatten all section items (risks exist in multiple sections)
    const allItems = Object.values(_framework).reduce(
      (acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []
    );

    // Map: fieldGroupName → risks[] — preserve insertion order
    const fgMap = new Map();

    for (const item of allItems) {
      for (const field of (item.Fields || [])) {
        if (field.jkType !== 'risk') continue;

        // Determine which fieldGroups this risk maps to (via applicable RCNs)
        const matchedFGs = new Set();
        const matchedControls = [];

        for (const ctrl of (field.controls || [])) {
          const rcns = (ctrl.requirement_control_number || '')
            .split(',').map(s => s.trim()).filter(Boolean);

          // A control is applicable if ANY of its RCNs is in the applicable set
          const ctrlApplicable = applicable ? rcns.some(r => applicable.has(r)) : true;
          if (!ctrlApplicable) continue;

          matchedControls.push(ctrl);

          // Map RCNs to fieldGroups
          rcns.forEach(rcn => {
            const fg = rcnToFG[rcn];
            if (fg) matchedFGs.add(fg);
          });
        }

        if (matchedControls.length === 0) continue;

        // Collect attack vectors from matched controls only
        const attackVectors = matchedControls
          .map(c => c.jkAttackVector)
          .filter(Boolean);

        const riskObj = {
          jkName:          field.jkName,
          RiskDescription: field.RiskDescription || '',
          role:            field.Role || '',
          attackVectors,
          fieldGroups:     Array.from(matchedFGs)
        };

        if (matchedFGs.size === 0) {
          // No fieldGroup match — skip unclassified
          continue;
        }

        // Add risk under each matched fieldGroup (risk may appear in multiple)
        matchedFGs.forEach(fg => {
          if (!fgMap.has(fg)) fgMap.set(fg, []);
          const arr = fgMap.get(fg);
          if (!arr.find(r => r.jkName === riskObj.jkName)) {
            arr.push(riskObj);
          }
        });
      }
    }

    return Array.from(fgMap.entries()).map(([fieldGroupName, risks]) => ({ fieldGroupName, risks }));
  }

  // ---- Tabs ---------------------------------------------------
  function _buildTabStrip() {
    const strip = _el('div', 'wiz-tab-strip');
    [['wizard', 'Step Wizard'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
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
    const wz  = _el('div', 'wiz-pane');  wz.dataset.pane  = 'wizard';
    const ref = _el('div', 'wiz-pane wiz-pane--hidden'); ref.dataset.pane = 'reference';
    wz.appendChild(_buildWizardPane());
    ref.appendChild(_buildReferencePane());
    pw.appendChild(wz); pw.appendChild(ref);
  }

  // ---- Wizard pane --------------------------------------------
  function _buildWizardPane() {
    const card = _el('div', 'step-detail-card');

    // Header
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

    // Deliverables
    if (_step.deliverables?.length) {
      card.appendChild(_sectionLabel('Deliverables'));
      const dl = _el('ul', 'deliverables-list');
      _step.deliverables.forEach(d => {
        const li = _el('li', 'deliverable-item'); li.textContent = d; dl.appendChild(li);
      });
      card.appendChild(dl);
    }

    // Input source summaries
    card.appendChild(_sectionLabel('Input Sources'));
    card.appendChild(_buildStep3Card());
    card.appendChild(_buildDpiaCard());

    // Risk list
    card.appendChild(_sectionLabel('Risk Assessment'));

    const uniqueRisks = new Set(_filteredFGItems.flatMap(fg => fg.risks.map(r => r.jkName)));
    const totalFGs    = _filteredFGItems.length;
    const totalRisks  = uniqueRisks.size;

    if (totalRisks === 0 && _step3Data) {
      const notice = _el('p', 'wiz8-notice');
      notice.textContent = 'No applicable risks found for this classification.';
      card.appendChild(notice);
    } else {
      const instr = _el('p', 'wiz8-instruction');
      instr.innerHTML = `<strong>${totalRisks} risk${totalRisks !== 1 ? 's' : ''}</strong> across <strong>${totalFGs} compliance control area${totalFGs !== 1 ? 's' : ''}</strong> ${_step3Data ? 'are applicable based on the Step 3 classification' : '(all risks shown — complete Step 3 first for filtered view)'}. Expand each risk to review its attack vectors and assess relevance. Check each risk that applies to your deployment.`;
      card.appendChild(instr);

      card.appendChild(_buildSearchBox());

      const riskList = _el('div', 'wiz8-risk-list');
      _filteredFGItems.forEach(fg => riskList.appendChild(_buildFGSection(fg)));
      card.appendChild(riskList);
    }

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 'wiz8-results'));
    return card;
  }

  // ---- Step 3 summary card ------------------------------------
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

  // ---- DPIA summary card --------------------------------------
  function _buildDpiaCard() {
    const card = _el('div', 'wiz8-source-card wiz8-source-card--dpia');
    if (!_step7Data) {
      const w = _el('div', 'wiz8-info');
      w.innerHTML = '<strong>Step 7 (DPIA) not yet completed.</strong> Complete the DPIA to include data inventory context. Risk assessment proceeds using Step 3 classifications only.';
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
    cell('Standard personal data', (di.standard_personal_data || []).length + ' types');
    cell('Special categories',     (di.special_category_data  || []).length + ' types');
    const rr = _step7Data.residual_risk_rating;
    cell('Residual risk', rr || '—', (rr === 'High' || rr === 'Very High') ? 'danger' : null);
    const adm = di.automated_decision_making || '';
    cell('Automated decisions', adm ? (adm.length > 40 ? adm.slice(0, 40) + '…' : adm) : '—');
    card.appendChild(grid); return card;
  }

  // ---- FieldGroup accordion (top level) -----------------------
  function _buildFGSection(fg) {
    const sec = _el('div', 'wiz8-fg');

    const header = _el('div', 'wiz8-fg-header');

    const left = _el('div', 'wiz8-fg-header-left');
    const nm = _el('span', 'wiz8-fg-name'); nm.textContent = fg.fieldGroupName; left.appendChild(nm);
    const rb = _el('span', 'wiz8-badge-risks');
    rb.textContent = `${fg.risks.length} risk${fg.risks.length !== 1 ? 's' : ''}`; left.appendChild(rb);
    header.appendChild(left);

    const right = _el('div', 'wiz8-fg-header-right');

    const selAll = document.createElement('button'); selAll.className = 'wiz8-sel-btn'; selAll.textContent = 'Select all';
    selAll.addEventListener('click', e => { e.stopPropagation(); _setFGSel(fg, true); }); right.appendChild(selAll);

    const deselAll = document.createElement('button'); deselAll.className = 'wiz8-sel-btn'; deselAll.textContent = 'Deselect all';
    deselAll.addEventListener('click', e => { e.stopPropagation(); _setFGSel(fg, false); }); right.appendChild(deselAll);

    const selCount = _el('span', 'wiz8-fg-sel-count'); right.appendChild(selCount);

    const chevron = _el('span', 'wiz8-chevron');
    chevron.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)'; // starts collapsed
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

  // ---- Risk card ----------------------------------------------
  function _buildRiskCard(risk) {
    const card = _el('div', 'wiz8-risk-card');
    card.dataset.riskName = risk.jkName;

    const riskHeader = _el('div', 'wiz8-risk-header');

    // Risk-level checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'wiz8-risk-cb';
    cb.dataset.riskName = risk.jkName;
    cb.checked = !!_state.selected_risks[risk.jkName];
    cb.addEventListener('change', e => {
      _state.selected_risks[risk.jkName] = e.target.checked;
      // Sync all checkboxes with the same risk name (risk may appear in multiple FGs)
      _container.querySelectorAll(`.wiz8-risk-cb[data-risk-name="${CSS.escape(risk.jkName)}"]`)
        .forEach(c => { c.checked = e.target.checked; });
      _updateAllFGBadges();
      _updateCountBadge();
    });
    riskHeader.appendChild(cb);

    const riskIcon = _el('span', 'wiz8-risk-icon');
    riskIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    riskHeader.appendChild(riskIcon);

    const riskName = _el('span', 'wiz8-risk-name'); riskName.textContent = risk.jkName; riskHeader.appendChild(riskName);

    if (risk.role) {
      const rb = _el('span', 'wiz8-role-badge'); rb.textContent = risk.role; riskHeader.appendChild(rb);
    }
    card.appendChild(riskHeader);

    // Risk description
    if (risk.RiskDescription) {
      const desc = _el('p', 'wiz8-risk-desc'); desc.textContent = risk.RiskDescription; card.appendChild(desc);
    }

    // Attack vectors (collapsible)
    if (risk.attackVectors.length > 0) {
      card.appendChild(_buildAttackVectorsDiv(risk.attackVectors));
    }

    return card;
  }

  // ---- Attack Vectors div -------------------------------------
  function _buildAttackVectorsDiv(attackVectors) {
    const wrap = _el('div', 'wiz8-av-wrap');

    const hdr = _el('div', 'wiz8-av-header');
    const icon = _el('span', 'wiz8-av-icon');
    icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
    hdr.appendChild(icon);
    const lbl = _el('span', 'wiz8-av-label');
    lbl.textContent = `Attack Vectors (${attackVectors.length})`; hdr.appendChild(lbl);
    const chevron = _el('span', 'wiz8-av-chevron');
    chevron.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
    chevron.style.transform = 'rotate(-90deg)'; hdr.appendChild(chevron);
    wrap.appendChild(hdr);

    const body = _el('div', 'wiz8-av-body wiz8-collapsed');
    attackVectors.forEach((av, i) => {
      const item = _el('div', 'wiz8-av-item');
      const num = _el('span', 'wiz8-av-num'); num.textContent = String(i + 1); item.appendChild(num);
      const txt = _el('p', 'wiz8-av-text'); txt.textContent = av; item.appendChild(txt);
      body.appendChild(item);
    });
    wrap.appendChild(body);

    hdr.addEventListener('click', () => {
      const collapsed = body.classList.toggle('wiz8-collapsed');
      chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
    return wrap;
  }

  // ---- Sync helpers -------------------------------------------
  function _syncAllCheckboxes() {
    _container.querySelectorAll('.wiz8-risk-cb').forEach(cb => {
      cb.checked = !!_state.selected_risks[cb.dataset.riskName];
    });
    _updateAllFGBadges();
    _updateCountBadge();
  }

  function _updateAllFGBadges() {
    _container.querySelectorAll('.wiz8-fg').forEach(el => _updateFGBadge(el));
  }

  function _updateFGBadge(secEl) {
    const all  = secEl.querySelectorAll('.wiz8-risk-cb');
    const chkd = secEl.querySelectorAll('.wiz8-risk-cb:checked');
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
    const uniqueRisks = new Set(_filteredFGItems.flatMap(fg => fg.risks.map(r => r.jkName)));
    const sel = Array.from(uniqueRisks).filter(n => _state.selected_risks[n]).length;
    const tot = uniqueRisks.size;
    const badge = _container.querySelector('#wiz8-count');
    if (badge) badge.textContent = `${sel} / ${tot} risks selected`;
  }

  // ---- Search box ---------------------------------------------
  function _buildSearchBox() {
    const wrap = _el('div', 'wiz8-search-wrap');

    const icon = _el('span', 'wiz8-search-icon');
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
    wrap.appendChild(icon);

    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'wiz8-search-input';
    inp.placeholder = 'Search risks and attack vectors… e.g. MFA, access control, logging, bias';
    inp.value = _searchQuery;

    const matchCount = _el('span', 'wiz8-search-count');
    const clearBtn = _el('button', 'wiz8-search-clear');
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
      inp.value = ''; _searchQuery = '';
      _applySearch('');
      clearBtn.style.display = 'none'; matchCount.textContent = '';
      inp.focus();
    });

    wrap.appendChild(inp); wrap.appendChild(clearBtn); wrap.appendChild(matchCount);
    return wrap;
  }

  function _applySearch(query) {
    const riskList = _container.querySelector('.wiz8-risk-list');
    if (!riskList) return;
    const q = query.trim().toLowerCase();
    if (!q) {
      riskList.querySelectorAll('.wiz8-fg, .wiz8-risk-card').forEach(el => el.classList.remove('wiz8-hidden'));
      return;
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const matches = text => tokens.every(t => text.toLowerCase().includes(t));

    riskList.querySelectorAll('.wiz8-fg').forEach(fgEl => {
      let fgVisible = false;
      const fgName = fgEl.querySelector('.wiz8-fg-name')?.textContent || '';
      const fgMatch = matches(fgName);

      fgEl.querySelectorAll('.wiz8-risk-card').forEach(riskEl => {
        const rn   = riskEl.querySelector('.wiz8-risk-name')?.textContent || '';
        const rd   = riskEl.querySelector('.wiz8-risk-desc')?.textContent || '';
        const avTx = Array.from(riskEl.querySelectorAll('.wiz8-av-text')).map(e => e.textContent).join(' ');

        const riskVisible = fgMatch || matches(rn + ' ' + rd + ' ' + avTx);
        riskEl.classList.toggle('wiz8-hidden', !riskVisible);

        if (riskVisible) {
          fgVisible = true;
          // Auto-expand attack vectors if they contain the match
          if (!fgMatch && !matches(rn + ' ' + rd) && matches(avTx)) {
            const avBody    = riskEl.querySelector('.wiz8-av-body');
            const avChevron = riskEl.querySelector('.wiz8-av-chevron');
            if (avBody)    avBody.classList.remove('wiz8-collapsed');
            if (avChevron) avChevron.style.transform = '';
          }
        }
      });

      fgEl.classList.toggle('wiz8-hidden', !fgVisible);
      if (fgVisible) {
        const body    = fgEl.querySelector('.wiz8-fg-body');
        const chevron = fgEl.querySelector('.wiz8-chevron');
        if (body)    body.classList.remove('wiz8-collapsed');
        if (chevron) chevron.style.transform = '';
      }
    });
  }

  function _countVisibleRisks() {
    const riskList = _container.querySelector('.wiz8-risk-list');
    if (!riskList) return '';
    const n = riskList.querySelectorAll('.wiz8-risk-card:not(.wiz8-hidden)').length;
    return n === 0 ? 'No matches' : `${n} risk${n !== 1 ? 's' : ''} match`;
  }

  // ---- Action row ---------------------------------------------
  function _buildActionRow() {
    const row   = _el('div', 'wiz-action-row');
    const left  = _el('div');
    const badge = document.createElement('span');
    badge.id = 'wiz8-count'; badge.className = 'wiz8-count-lg';
    const uniqueRisks = new Set(_filteredFGItems.flatMap(fg => fg.risks.map(r => r.jkName)));
    const sel = Array.from(uniqueRisks).filter(n => _state.selected_risks[n]).length;
    badge.textContent = `${sel} / ${uniqueRisks.size} risks selected`;
    left.appendChild(badge); row.appendChild(left);

    const right = _el('div', 'wiz8-action-right');
    const btn = document.createElement('button');
    btn.className = 'wiz-btn-primary'; btn.textContent = 'Save Risk Assessment';
    btn.addEventListener('click', _handleSave);
    right.appendChild(btn); row.appendChild(right);
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

    // Deduplicate risks by name (same risk may appear under multiple FGs)
    const uniqueMap = new Map();
    _filteredFGItems.forEach(fg => {
      fg.risks.forEach(r => {
        if (!uniqueMap.has(r.jkName)) {
          uniqueMap.set(r.jkName, {
            risk_name:           r.jkName,
            risk_description:    r.RiskDescription,
            field_groups:        r.fieldGroups,
            attack_vector_count: r.attackVectors.length,
            selected:            !!_state.selected_risks[r.jkName]
          });
        }
      });
    });

    const risks         = Array.from(uniqueMap.values());
    const selectedCount = risks.filter(r => r.selected).length;

    return {
      step_id:         'step-8',
      step_title:      'Risk assessment',
      assessment_date: today,
      assessed_by:     meta.assessed_by || '',
      use_case_id:     meta.use_case_id || '',
      source_classification: _step3Data ? {
        ai_act_outcome:  _step3Data.axis_b?.ai_act_outcome,
        governance_tier: _step3Data.axis_a?.tier,
        combined_outcome: _step3Data.combined_outcome?.outcome_label
      } : null,
      dpia_summary: _step7Data ? {
        residual_risk_rating:     _step7Data.residual_risk_rating,
        special_category_data:    _step7Data.data_types_identified?.special_category_data || [],
        automated_decision_making: _step7Data.data_types_identified?.automated_decision_making
      } : null,
      total_risks:    risks.length,
      selected_risks: selectedCount,
      excluded_risks: risks.length - selectedCount,
      risks
    };
  }

  // ---- Results area -------------------------------------------
  function _renderResults(rec8) {
    const area = _container.querySelector('.wiz8-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 'wiz8-result-card');

    const h = _el('h3', 'wiz8-result-title'); h.textContent = 'Risk Assessment Saved'; card.appendChild(h);

    const stats = _el('div', 'wiz8-result-stats');
    [
      [rec8.total_risks,    'Risks assessed'],
      [rec8.selected_risks, 'Risks confirmed'],
      [rec8.excluded_risks, 'Risks excluded']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 'wiz8-stat');
      const n = _el('span', 'wiz8-stat-num'); n.textContent = String(num);
      const l = _el('span', 'wiz8-stat-lbl'); l.textContent = lbl;
      s.appendChild(n); s.appendChild(l); stats.appendChild(s);
    });
    card.appendChild(stats);

    const note = _el('p', 'wiz8-result-note');
    note.innerHTML = `Risk assessment saved to record. <strong>${rec8.selected_risks} confirmed risk${rec8.selected_risks !== 1 ? 's' : ''}</strong> will feed into Step 9 (Control identification and risk treatment). Use the <strong>Save Record</strong> button in the sidebar to download the full system record.`;
    card.appendChild(note);

    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Reference pane -----------------------------------------
  function _buildReferencePane() {
    const card = _el('div', 'step-detail-card');
    const title = _el('h2', 'step-detail-title'); title.textContent = 'Risk Catalogue Reference'; card.appendChild(title);
    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Complete catalogue of all risks from the AI Risk Control Framework, grouped by compliance control area. The wizard view is filtered to risks applicable to the Step 3 classification.';
    card.appendChild(sub);

    const rcnToFG = _buildRcnToFGMap();
    const allItems = Object.values(_framework || {}).reduce((acc, val) => Array.isArray(val) ? acc.concat(val) : acc, []);

    const fgMap = new Map();
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
        const rn  = _el('p', 'wiz8-ref-risk-name'); rn.textContent = risk.jkName; rd.appendChild(rn);
        if (risk.RiskDescription) {
          const rdesc = _el('p', 'wiz8-ref-risk-desc');
          rdesc.textContent = risk.RiskDescription.length > 200 ? risk.RiskDescription.slice(0, 200) + '…' : risk.RiskDescription;
          rd.appendChild(rdesc);
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
/* ---- Shared wizard layout (if wiz7-styles not yet loaded) ---- */
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

/* ---- Source cards ---- */
.wiz8-source-card{background:var(--info-50,#f0f9ff);border:1px solid var(--info-200,#bae6fd);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz8-source-card--dpia{background:var(--purple-50,#faf5ff);border-color:var(--purple-200,#ddd6fe)}
.wiz8-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--info-600,#0284c7);margin:0 0 10px}
.wiz8-source-card--dpia .wiz8-source-label{color:var(--purple-600,#7c3aed)}
.wiz8-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.wiz8-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz8-cell-label{font-size:11px;color:var(--color-text-tertiary);font-weight:500}
.wiz8-cell-value{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz8-cell-value--badge{font-size:11px;font-weight:700;text-transform:uppercase;background:var(--teal-100,#ccfbf1);color:var(--teal-700,#0f766e);padding:2px 8px;border-radius:10px;display:inline-block}
.wiz8-cell-value--num{font-size:18px;font-weight:700;color:var(--teal-600,#0d9488)}
.wiz8-cell-value--danger{font-size:13px;font-weight:700;color:var(--danger-700,#b91c1c)}
.wiz8-warn{background:var(--warning-50,#fffbeb);border:1px solid var(--warning-200,#fde68a);border-radius:6px;padding:10px 14px;font-size:13px;color:var(--warning-800,#92400e);line-height:1.55}
.wiz8-info{background:var(--info-50,#f0f9ff);border:1px solid var(--info-200,#bae6fd);border-radius:6px;padding:10px 14px;font-size:13px;color:var(--info-800,#075985);line-height:1.55}
.wiz8-instruction{font-size:13px;color:var(--color-text-secondary);margin:0 0 16px;line-height:1.6}
.wiz8-notice{font-size:13px;color:var(--color-text-tertiary);padding:20px 0}

/* ---- FieldGroup accordion (top level) ---- */
.wiz8-fg{border:1px solid var(--color-border);border-radius:8px;overflow:hidden;margin-bottom:10px}
.wiz8-fg-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none;gap:10px}
.wiz8-fg-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz8-fg-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.wiz8-fg-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz8-badge-risks{font-size:11px;font-weight:600;background:var(--danger-100,#fee2e2);color:var(--danger-700,#b91c1c);padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-fg-header-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz8-sel-btn{font-size:11px;font-weight:500;color:var(--teal-600,#0d9488);background:none;border:1px solid var(--teal-200,#99f6e4);border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.wiz8-sel-btn:hover{background:var(--teal-50,#f0fdfa)}
.wiz8-fg-sel-count{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center}
.wiz8-fg-sel-count--all{background:var(--success-100,#dcfce7);color:var(--success-700,#15803d)}
.wiz8-fg-sel-count--partial{background:var(--warning-100,#fef3c7);color:var(--warning-700,#b45309)}
.wiz8-fg-sel-count--none{background:var(--danger-100,#fee2e2);color:var(--danger-700,#b91c1c)}
.wiz8-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz8-fg-body{padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.wiz8-collapsed{display:none}

/* ---- Risk card ---- */
.wiz8-risk-card{background:#fff;border:1px solid var(--color-border);border-radius:8px;padding:14px 16px}
.wiz8-risk-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.wiz8-risk-cb{flex-shrink:0;accent-color:var(--teal-600,#0d9488);width:15px;height:15px;cursor:pointer;margin-top:1px}
.wiz8-risk-icon{display:flex;color:var(--danger-500,#ef4444);flex-shrink:0}
.wiz8-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary);flex:1}
.wiz8-role-badge{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:var(--purple-100,#ede9fe);color:var(--purple-700,#6d28d9);padding:2px 7px;border-radius:4px;white-space:nowrap}
.wiz8-risk-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0 0 10px;padding:10px 12px;background:var(--danger-50,#fef2f2);border-left:3px solid var(--danger-200,#fecaca);border-radius:0 4px 4px 0}

/* ---- Attack vectors ---- */
.wiz8-av-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-top:4px}
.wiz8-av-header{display:flex;align-items:center;gap:7px;padding:8px 12px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none}
.wiz8-av-header:hover{background:var(--color-bg-hover,#f1f5f9)}
.wiz8-av-icon{display:flex;color:var(--amber-600,#d97706);flex-shrink:0}
.wiz8-av-label{font-size:12px;font-weight:600;color:var(--amber-800,#92400e);flex:1}
.wiz8-av-chevron{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz8-av-body{padding:12px 14px;display:flex;flex-direction:column;gap:12px;background:var(--amber-50,#fffbeb)}
.wiz8-av-item{display:flex;gap:10px;align-items:flex-start}
.wiz8-av-num{font-size:11px;font-weight:700;color:var(--amber-700,#b45309);background:var(--amber-100,#fef3c7);padding:2px 7px;border-radius:10px;white-space:nowrap;flex-shrink:0;margin-top:2px}
.wiz8-av-text{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0}

/* ---- Search box ---- */
.wiz8-search-wrap{display:flex;align-items:center;gap:6px;margin-bottom:14px;background:#fff;border:1px solid var(--color-border);border-radius:6px;padding:0 10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.wiz8-search-icon{display:flex;color:var(--color-text-tertiary);flex-shrink:0}
.wiz8-search-input{flex:1;border:none;outline:none;padding:10px 0;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:transparent}
.wiz8-search-input::placeholder{color:var(--color-text-tertiary)}
.wiz8-search-clear{display:flex;align-items:center;justify-content:center;background:var(--color-bg-subtle,#f8fafc);border:1px solid var(--color-border);border-radius:4px;width:20px;height:20px;cursor:pointer;color:var(--color-text-tertiary);flex-shrink:0;padding:0}
.wiz8-search-clear:hover{color:var(--color-text-primary)}
.wiz8-search-count{font-size:11px;color:var(--color-text-tertiary);white-space:nowrap}
.wiz8-hidden{display:none!important}
.wiz8-risk-list{display:flex;flex-direction:column}

/* ---- Count and action ---- */
.wiz8-count-badge{font-size:11px;font-weight:600;background:var(--teal-100,#ccfbf1);color:var(--teal-700,#0f766e);padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-action-right{display:flex;gap:8px}
.wiz8-count-lg{font-size:13px;font-weight:600;color:var(--teal-700,#0f766e)}

/* ---- Results card ---- */
.wiz8-results{margin-top:16px}
.wiz8-result-card{background:var(--success-50,#f0fdf4);border:1px solid var(--success-200,#bbf7d0);border-radius:8px;padding:20px}
.wiz8-result-title{font-size:14px;font-weight:700;color:var(--success-700,#15803d);margin:0 0 14px}
.wiz8-result-stats{display:flex;gap:28px;margin-bottom:14px;flex-wrap:wrap}
.wiz8-stat{display:flex;flex-direction:column;gap:2px}
.wiz8-stat-num{font-size:26px;font-weight:700;color:var(--success-700,#15803d);line-height:1}
.wiz8-stat-lbl{font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
.wiz8-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* ---- Reference pane ---- */
.wiz8-ref-fg{margin-bottom:28px}
.wiz8-ref-fg-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid var(--color-border)}
.wiz8-ref-fg-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz8-ref-risk{margin-bottom:10px;padding-left:12px;border-left:3px solid var(--danger-200,#fecaca)}
.wiz8-ref-risk-name{font-size:12px;font-weight:700;color:var(--danger-700,#b91c1c);margin:0 0 4px}
.wiz8-ref-risk-desc{font-size:11px;color:var(--color-text-secondary);margin:0;line-height:1.55}
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
