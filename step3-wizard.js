// step3-wizard.js
// Interactive classification wizard for Step 3 — System Classification.
//
// Layout pattern (reused across all step wizards):
//   Tab 1 — "Step Wizard"    : interactive inputs that produce the step deliverables
//   Tab 2 — "Reference"      : read-only overview of the step's JSON data
//
// Produces a downloadable system-record.json. Uploading the file restores all answers.

(function () {
  'use strict';

  // ── Module state ─────────────────────────────────────────────────────────────

  let _detail = null;
  let _stylesInjected = false;

  let _state = {
    axis_a_tier: null,         // 'tier_1' | 'tier_2'
    gate_answers: {},          // { G1_Q1: 'yes'|'no', G5_Q0: 'provider'|'deployer', … }
    organisation_role: null,   // 'provider' | 'deployer'
    art25_override: false,     // true if user acknowledged Art.25 warning and elected to continue as Deployer
    result: null
  };

  let _record = {};       // full system record, grows as steps are completed

  // ── Public API ────────────────────────────────────────────────────────────────

  window.mountStep3Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _detail = detail;
    _injectStyles();

    try {
      const saved = sessionStorage.getItem('ai_workflow_system_record');
      if (saved) _record = JSON.parse(saved);
    } catch (_) {}
    if (_record['step-3']) _restoreState(_record['step-3']);

    container.innerHTML = '';
    const card = _el('div', 'step-detail-card');

    // ── Step header (shared across both tabs) ────────────────────────────────
    const eyebrow = _el('div', 'step-detail-eyebrow');
    eyebrow.append(
      _el('span', `step-detail-number color-${colorKey}`, { textContent: step.number }),
      _el('span', 'step-detail-phase-label', { textContent: phaseTitle })
    );
    const titleEl = _el('h1', 'step-detail-title', { textContent: step.title });
    const meta = _el('div', 'step-detail-meta');
    meta.appendChild(_el('span', 'owner-tag', {
      innerHTML: `${(typeof ICONS !== 'undefined' ? ICONS[step.ownerIcon] : '') || ''}&nbsp;${step.owners.join(', ')}`
    }));
    (step.requirements || []).forEach(r =>
      meta.appendChild(_el('span', 'badge sr', { textContent: r }))
    );
    const applicMap = { all: 'all', tier2: 'tier2', ops: 'ops', 'personal-data': 'pdata' };
    meta.appendChild(_el('span', `badge ${applicMap[step.applicabilityKey] || 'all'}`, { textContent: step.applicability }));
    const summary = _el('p', 'step-detail-summary', { textContent: detail.classification_model.description });
    card.append(eyebrow, titleEl, meta, summary);

    // ── Tab strip ────────────────────────────────────────────────────────────
    const tabStrip = _buildTabStrip();
    card.appendChild(tabStrip);

    // ── Wizard tab (default) ─────────────────────────────────────────────────
    const wizardPane = _buildWizardPane(detail);
    wizardPane.id = 'wiz-pane-wizard';

    // ── Reference tab ────────────────────────────────────────────────────────
    const referencePane = _buildReferencePane(detail);
    referencePane.id = 'wiz-pane-reference';
    referencePane.style.display = 'none';

    card.append(wizardPane, referencePane);

    // Tab switching
    tabStrip.querySelectorAll('.wiz-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        tabStrip.querySelectorAll('.wiz-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const showWizard = btn.dataset.tab === 'wizard';
        wizardPane.style.display   = showWizard ? 'block' : 'none';
        referencePane.style.display = showWizard ? 'none' : 'block';
      });
    });

    container.appendChild(card);

    _updateGateVisibility();

    if (_state.result) {
      const rc = wizardPane.querySelector('#wiz-results');
      if (rc) _renderResults(rc, _state.result);
    }
  };

  // ── Tab strip ─────────────────────────────────────────────────────────────────

  function _buildTabStrip() {
    const strip = _el('div', 'wiz-tab-strip');
    [['wizard', 'Step Wizard'], ['reference', 'Reference']].forEach(([key, label], i) => {
      const btn = _el('button', 'wiz-tab' + (i === 0 ? ' active' : ''), { textContent: label });
      btn.dataset.tab = key;
      strip.appendChild(btn);
    });
    return strip;
  }

  // ── Wizard pane ───────────────────────────────────────────────────────────────

  function _buildWizardPane(detail) {
    const pane = _el('div', '');

    pane.appendChild(_buildAxisASection(detail.axis_a_classification));
    pane.appendChild(_buildAxisBSection(detail.axis_b_classification));

    // Action row
    const actionRow = _el('div', 'wiz-action-row');

    const classifyBtn = _el('button', 'wiz-btn-primary', { textContent: 'Classify System' });
    classifyBtn.addEventListener('click', () => _handleClassify(pane, detail));

    actionRow.append(classifyBtn);
    pane.appendChild(actionRow);

    const resultsContainer = _el('div', '');
    resultsContainer.id = 'wiz-results';
    pane.appendChild(resultsContainer);

    return pane;
  }

  // ── Reference pane ────────────────────────────────────────────────────────────

  function _buildReferencePane(detail) {
    const pane = _el('div', '');
    const cm    = detail.classification_model;
    const axisA = detail.axis_a_classification;
    const axisB = detail.axis_b_classification;
    const matrix = detail.combined_outcome_matrix;

    // Axis A
    pane.appendChild(_sectionLabel('Axis A — Internal governance tier'));
    pane.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:10px', textContent: cm.axis_a.purpose }));
    axisA.tiers.forEach(t => {
      const c = _el('div', 'ov-tier-card');
      c.innerHTML = `
        <p style="font-size:13px;font-weight:500;color:var(--color-text-primary);margin-bottom:4px">${t.label}</p>
        <p style="font-size:12px;color:var(--color-text-secondary);margin-bottom:8px">${t.definition}</p>
        <div style="margin-bottom:8px">${t.examples.map(e => `<span class="ov-chip">${e}</span>`).join('')}</div>
        <span class="badge ${t.change_board_required ? 'tier2' : 'all'}">${t.change_board_required ? 'Change Board required' : 'ISG fast-track'}</span>`;
      pane.appendChild(c);
    });
    pane.appendChild(_el('div', 'gate-note warning', { style: 'margin-top:4px;margin-bottom:24px', textContent: `Escalation rule: ${axisA.escalation_rule}` }));

    // Axis B gate summary
    pane.appendChild(_sectionLabel('Axis B — EU AI Act legal risk tier'));
    pane.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:10px', textContent: cm.axis_b.purpose }));
    axisB.gates.forEach(g => {
      const row = _el('div', 'ov-gate-row');
      row.innerHTML = `
        <span class="badge pdata" style="min-width:28px;text-align:center;flex-shrink:0">${g.gate_id}</span>
        <div>
          <p style="font-size:13px;font-weight:500;color:var(--color-text-primary);margin-bottom:2px">${g.gate_name}</p>
          <p style="font-size:12px;color:var(--color-text-secondary)">${g.gate_purpose}</p>
          ${g.short_circuit ? `<p class="gate-note danger" style="margin-top:6px;font-size:11px">${g.short_circuit}</p>` : ''}
        </div>`;
      pane.appendChild(row);
    });
    pane.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-tertiary);margin-top:4px;margin-bottom:24px', textContent: 'Full gate questions and article mappings are defined in step-3.json.' }));

    // Outcome matrix
    pane.appendChild(_sectionLabel('Combined outcome matrix'));
    pane.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:10px', textContent: matrix.description }));
    const axisColors = {
      PROHIBITED:   ['var(--danger-fill)',  'var(--danger-text)'],
      HIGH_RISK:    ['var(--warning-fill)', 'var(--warning-text)'],
      LIMITED_RISK: ['var(--info-fill)',    'var(--info-text)'],
      MINIMAL_RISK: ['var(--success-fill)', 'var(--success-text)'],
      OUT_OF_SCOPE: ['var(--color-bg)',     'var(--color-text-secondary)'],
    };
    const tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:24px';
    tbl.innerHTML = `
      <thead><tr style="background:var(--color-bg)">
        ${['Axis A','Axis B','Combined outcome','Oversight'].map(h =>
          `<th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:500;color:var(--color-text-secondary);border-bottom:1px solid var(--color-border)">${h}</th>`
        ).join('')}
      </tr></thead>
      <tbody>${matrix.rules.map(r => {
        const [bg, col] = axisColors[r.axis_b] || axisColors.MINIMAL_RISK;
        const aLabel = r.axis_a === 'any' ? 'Any' : r.axis_a === 'tier_1' ? 'Tier 1' : 'Tier 2';
        return `<tr style="border-bottom:1px solid var(--color-border)">
          <td style="padding:8px 10px;color:var(--color-text-secondary)">${aLabel}</td>
          <td style="padding:8px 10px"><span style="font-size:11px;font-weight:500;padding:2px 7px;border-radius:4px;background:${bg};color:${col}">${r.axis_b}</span></td>
          <td style="padding:8px 10px;font-weight:500;color:var(--color-text-primary)">${r.label}</td>
          <td style="padding:8px 10px;color:var(--color-text-secondary)">${r.article_14_human_oversight ? '✓ Art.14' : r.axis_b === 'PROHIBITED' ? '—' : 'Portfolio'}</td>
        </tr>`;
      }).join('')}</tbody>`;
    pane.appendChild(tbl);

    // Deliverables
    pane.appendChild(_sectionLabel('Deliverables'));
    const dl = _el('ul', 'deliverables-list', { style: 'margin-bottom:24px' });
    detail.deliverables.forEach(d => {
      const li = _el('li', 'deliverable-item');
      li.innerHTML = `<span class="deliverable-icon">${typeof ICONS !== 'undefined' ? ICONS.check : ''}</span><span>${d}</span>`;
      dl.appendChild(li);
    });
    pane.appendChild(dl);

    // SR9 note + requirement labels
    pane.appendChild(_el('div', 'gate-note info', { style: 'margin-bottom:8px', innerHTML: `<strong>AI SR9 clarification:</strong> ${detail.standard_note}` }));
    const reqList = _el('div', 'req-list');
    (detail.requirement_labels || []).forEach(r => reqList.appendChild(_el('span', 'req-pill', { textContent: r })));
    pane.appendChild(reqList);

    return pane;
  }

  // ── Identity section ──────────────────────────────────────────────────────────

  function _buildIdentitySection() {
    const section = _el('div', 'wiz-section');
    const lbl = _sectionLabel('Use case identity');
    lbl.style.marginBottom = '12px';
    section.appendChild(lbl);

    const grid = _el('div', '', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' });
    [
      { id: 'wiz-use-case-id',   label: 'Use case ID',   placeholder: 'e.g. UC-001',  key: 'use_case_id'   },
      { id: 'wiz-classified-by', label: 'Classified by', placeholder: 'Name and role', key: 'classified_by' }
    ].forEach(({ id, label, placeholder, key }) => {
      const wrap = _el('div', '');
      const lbl2 = document.createElement('label');
      lbl2.htmlFor = id;
      lbl2.style.cssText = 'display:block;font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:5px';
      lbl2.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = id; inp.placeholder = placeholder; inp.value = _state[key] || '';
      inp.style.cssText = 'width:100%;padding:8px 10px;border:1px solid var(--color-border-mid);border-radius:var(--radius-sm);font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface);box-sizing:border-box';
      inp.addEventListener('input', () => { _state[key] = inp.value; });
      wrap.append(lbl2, inp);
      grid.appendChild(wrap);
    });

    section.appendChild(grid);
    return section;
  }

  // ── Axis A interactive ────────────────────────────────────────────────────────

  function _buildAxisASection(axisA) {
    const section = _el('div', '', { style: 'margin-bottom:20px' });
    section.appendChild(_sectionLabel('Axis A — Select your governance tier'));
    section.appendChild(_el('p', '', {
      style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:12px',
      textContent: 'Select the tier that applies to this use case.'
    }));

    axisA.tiers.forEach(tier => {
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'wiz-axis-a'; radio.value = tier.tier_id;
      radio.id = `wiz-a-${tier.tier_id}`; radio.style.display = 'none';
      if (_state.axis_a_tier === tier.tier_id) radio.checked = true;
      section.appendChild(radio);

      const card = document.createElement('label');
      card.htmlFor = radio.id;
      card.className = 'wiz-tier-card' + (_state.axis_a_tier === tier.tier_id ? ` selected-${tier.tier_id}` : '');

      const headerRow = _el('div', '', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' });
      headerRow.append(
        _el('span', '', { style: 'font-size:13px;font-weight:500;color:var(--color-text-primary)', textContent: tier.label }),
        _el('span', `badge ${tier.change_board_required ? 'tier2' : 'all'}`, { textContent: tier.change_board_required ? 'Change Board required' : 'ISG fast-track' })
      );
      const chips = _el('div', '');
      tier.examples.forEach(e => chips.appendChild(_el('span', 'ov-chip', { textContent: e })));
      card.append(
        headerRow,
        _el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:8px', textContent: tier.definition }),
        chips
      );

      radio.addEventListener('change', () => {
        _state.axis_a_tier = tier.tier_id;
        section.querySelectorAll('.wiz-tier-card').forEach(c => { c.className = 'wiz-tier-card'; });
        card.className = `wiz-tier-card selected-${tier.tier_id}`;
      });

      section.appendChild(card);
    });

    section.appendChild(_el('div', 'gate-note warning', { style: 'margin-top:4px', textContent: `Escalation rule: ${axisA.escalation_rule}` }));
    return section;
  }

  // ── Axis B gates ──────────────────────────────────────────────────────────────

  function _buildAxisBSection(axisB) {
    const section = _el('div', '', { style: 'margin-top:24px;margin-bottom:4px' });
    section.appendChild(_sectionLabel('Axis B — Complete EU AI Act gates G1–G5'));
    section.appendChild(_el('p', '', {
      style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:14px',
      textContent: 'Answer each gate in sequence. G1 and G2 may short-circuit the assessment — read each gate header before answering.'
    }));
    axisB.gates.forEach(gate => section.appendChild(_buildGateSection(gate)));
    return section;
  }

  // G1 and G3 are collapsed to a single Yes/No — the individual items are shown as
  // a compact reference list. The answer is stored under 'G1_any' / 'G3_any'.
  const COLLAPSED_GATES = {
    G1: { key: 'G1_any', question: 'Does this system involve any practice prohibited under Article 5 of the EU AI Act?' },
    G3: { key: 'G3_any', question: 'Does this system fall within any Annex III high-risk domain?' },
  };

  function _buildGateSection(gate) {
    const section = _el('div', 'wiz-gate-section');
    section.id = `wiz-gate-${gate.gate_id}`;

    const header = _el('div', 'wiz-gate-header');
    const titleRow = _el('div', '', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' });
    titleRow.append(
      _el('span', 'badge pdata', { textContent: gate.gate_id }),
      _el('span', '', { style: 'font-size:13px;font-weight:500;color:var(--color-text-primary)', textContent: gate.gate_name })
    );
    header.appendChild(titleRow);
    header.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-top:2px', textContent: gate.gate_purpose }));
    if (gate.short_circuit) header.appendChild(_el('p', 'gate-note danger', { style: 'margin-top:8px;font-size:11px', textContent: gate.short_circuit }));
    if (gate.note)          header.appendChild(_el('p', 'gate-note info',   { style: 'margin-top:6px;font-size:11px',  textContent: gate.note }));
    section.appendChild(header);

    const body = _el('div', 'wiz-gate-body');
    const collapsed = COLLAPSED_GATES[gate.gate_id];
    if (collapsed) {
      body.appendChild(_buildCollapsedQuestion(collapsed.key, collapsed.question, gate.questions));
    } else {
      gate.questions.forEach(q => {
        if (q.type === 'choice')        body.appendChild(_buildChoiceQuestion(q));
        else if (q.type === 'sub_questions') body.appendChild(_buildSubQuestionGroup(q));
        else                            body.appendChild(_buildQuestionRow(q));
      });
    }
    section.appendChild(body);
    return section;
  }

  function _buildCollapsedQuestion(answerKey, questionText, subItems) {
    const row = _el('div', 'wiz-q-row');
    row.id = `wiz-q-${answerKey}`;
    const saved = _state.gate_answers[answerKey];
    if (saved === 'yes') row.classList.add('answered-yes');
    if (saved === 'no')  row.classList.add('answered-no');

    row.appendChild(_el('p', '', { style: 'font-size:13px;color:var(--color-text-primary);margin-bottom:10px;line-height:1.5', textContent: questionText }));

    const pillGroup = _el('div', '', { style: 'display:flex;gap:8px;margin-bottom:14px' });
    ['yes', 'no'].forEach(value => {
      const input = document.createElement('input');
      input.type = 'radio'; input.name = `wiz-q-${answerKey}`; input.value = value;
      input.id = `wiz-q-${answerKey}-${value}`; input.style.display = 'none';
      if (saved === value) input.checked = true;

      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.className = 'wiz-pill' + (saved === value ? ` active-${value}` : '');
      label.textContent = value === 'yes' ? 'Yes' : 'No';

      input.addEventListener('change', () => {
        _state.gate_answers[answerKey] = value;
        row.classList.remove('answered-yes', 'answered-no');
        row.classList.add(value === 'yes' ? 'answered-yes' : 'answered-no');
        pillGroup.querySelectorAll('.wiz-pill').forEach(l => l.classList.remove('active-yes', 'active-no'));
        label.classList.add(`active-${value}`);
        _updateGateVisibility();
      });

      row.appendChild(input);
      pillGroup.appendChild(label);
    });
    row.appendChild(pillGroup);

    // Domain items — each with optional collapsible sub-questions
    const refLabel = _el('p', '', { style: 'font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin-bottom:8px', textContent: 'Covered domains' });
    const list = _el('div', 'wiz-domain-list');
    subItems.forEach(q => {
      const item = _el('div', 'wiz-domain-item');

      const headerRow = _el('div', 'wiz-domain-header');
      headerRow.appendChild(_el('span', 'wiz-ref-tag', { textContent: q.ai_act_reference }));
      headerRow.appendChild(_el('span', 'wiz-domain-text', { textContent: q.question }));

      item.appendChild(headerRow);

      if (q.sub_questions && q.sub_questions.length > 0) {
        const toggle = _el('button', 'wiz-sub-toggle', { textContent: '▸ See specific criteria' });
        toggle.type = 'button';

        const collapseDiv = _el('div', 'wiz-sub-collapse');
        q.sub_questions.forEach(sq => {
          const li = _el('div', 'wiz-sub-item');
          li.appendChild(_el('span', 'wiz-sub-bullet', { textContent: '•' }));
          li.appendChild(_el('span', '', { style: 'font-size:11px;color:var(--color-text-secondary);line-height:1.5', textContent: sq }));
          collapseDiv.appendChild(li);
        });

        toggle.addEventListener('click', () => {
          const isOpen = collapseDiv.classList.contains('open');
          collapseDiv.classList.toggle('open', !isOpen);
          toggle.textContent = isOpen ? '▸ See specific criteria' : '▾ Hide criteria';
        });

        item.append(toggle, collapseDiv);
      }

      list.appendChild(item);
    });
    row.append(refLabel, list);

    return row;
  }

  // Renders a two-option choice question (e.g. G5_Q0 Provider vs Deployer)
  function _buildChoiceQuestion(q) {
    const wrap = _el('div', 'wiz-choice-question');
    wrap.id = `wiz-q-${q.id}`;
    const saved = _state.gate_answers[q.id];

    wrap.appendChild(_el('p', '', { style: 'font-size:13px;font-weight:500;color:var(--color-text-primary);margin-bottom:4px;line-height:1.5', textContent: q.question }));
    wrap.appendChild(_el('span', '', { style: 'font-size:10px;color:var(--color-text-tertiary);font-family:var(--font-mono);display:block;margin-bottom:12px', textContent: q.ai_act_reference }));

    const optionsWrap = _el('div', 'wiz-choice-options');
    (q.options || []).forEach(opt => {
      const input = document.createElement('input');
      input.type = 'radio'; input.name = `wiz-q-${q.id}`; input.value = opt.value;
      input.id = `wiz-q-${q.id}-${opt.value}`; input.style.display = 'none';
      if (saved === opt.value) input.checked = true;

      const card = document.createElement('label');
      card.htmlFor = input.id;
      card.className = 'wiz-choice-card' + (saved === opt.value ? ' selected' : '');

      const labelEl = _el('span', 'wiz-choice-label', { textContent: opt.label });
      const descEl  = _el('span', 'wiz-choice-desc',  { textContent: opt.description });
      card.append(labelEl, descEl);

      input.addEventListener('change', () => {
        _state.gate_answers[q.id] = opt.value;
        _state.organisation_role = opt.value;
        optionsWrap.querySelectorAll('.wiz-choice-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _updateGateVisibility();
      });

      wrap.appendChild(input);
      optionsWrap.appendChild(card);
    });
    wrap.appendChild(optionsWrap);
    return wrap;
  }

  // Renders a sub-question group with soft warning (e.g. G5_Q3 Art.25 check)
  function _buildSubQuestionGroup(q) {
    const wrap = _el('div', 'wiz-subq-group');
    wrap.id = `wiz-q-${q.id}`;

    const headerLabel = _el('p', '', { style: 'font-size:13px;font-weight:500;color:var(--color-text-primary);margin-bottom:4px', textContent: q.label || q.question || '' });
    const refTag = _el('span', '', { style: 'font-size:10px;color:var(--color-text-tertiary);font-family:var(--font-mono);display:block;margin-bottom:6px', textContent: q.ai_act_reference });
    const descEl = _el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-bottom:12px;line-height:1.5', textContent: q.description || '' });
    wrap.append(headerLabel, refTag, descEl);

    const warningEl = _el('div', 'gate-note danger wiz-art25-warning');
    warningEl.style.display = 'none';
    warningEl.innerHTML = `<strong>⚠ Possible substantial modification (Art.25):</strong> ${q.soft_warning || ''}`;

    const overrideEl = _el('div', 'wiz-art25-override');
    overrideEl.style.display = 'none';
    const overrideCheck = document.createElement('input');
    overrideCheck.type = 'checkbox'; overrideCheck.id = 'wiz-art25-override-cb';
    const overrideLabel = document.createElement('label');
    overrideLabel.htmlFor = 'wiz-art25-override-cb';
    overrideLabel.style.cssText = 'font-size:12px;color:var(--color-text-secondary);cursor:pointer;display:flex;gap:8px;align-items:flex-start';
    overrideLabel.textContent = q.override_label || 'I have reviewed this — continue as Deployer';
    overrideCheck.checked = _state.art25_override || false;
    overrideCheck.addEventListener('change', () => {
      _state.art25_override = overrideCheck.checked;
      _state.gate_answers['G5_Q3_override'] = overrideCheck.checked;
    });
    overrideEl.append(overrideCheck, overrideLabel);

    const updateWarning = () => {
      const anyYes = (q.sub_questions || []).some(sq => _state.gate_answers[sq.id] === 'yes');
      warningEl.style.display = anyYes ? 'block' : 'none';
      overrideEl.style.display = anyYes ? 'flex' : 'none';
    };

    (q.sub_questions || []).forEach(sq => {
      const row = _el('div', 'wiz-q-row');
      row.id = `wiz-q-${sq.id}`;
      const savedSq = _state.gate_answers[sq.id];
      if (savedSq === 'yes') row.classList.add('answered-yes');
      if (savedSq === 'no')  row.classList.add('answered-no');

      row.appendChild(_el('p', '', { style: 'font-size:13px;color:var(--color-text-primary);margin-bottom:3px;line-height:1.5', textContent: sq.question }));
      row.appendChild(_el('span', '', { style: 'font-size:10px;color:var(--color-text-tertiary);font-family:var(--font-mono)', textContent: sq.ai_act_reference }));

      const pillGroup = _el('div', '', { style: 'display:flex;gap:8px;margin-top:10px' });
      ['yes', 'no'].forEach(value => {
        const input = document.createElement('input');
        input.type = 'radio'; input.name = `wiz-q-${sq.id}`; input.value = value;
        input.id = `wiz-q-${sq.id}-${value}`; input.style.display = 'none';
        if (savedSq === value) input.checked = true;

        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.className = 'wiz-pill' + (savedSq === value ? ` active-${value}` : '');
        label.textContent = value === 'yes' ? 'Yes' : 'No';

        input.addEventListener('change', () => {
          _state.gate_answers[sq.id] = value;
          row.classList.remove('answered-yes', 'answered-no');
          row.classList.add(value === 'yes' ? 'answered-yes' : 'answered-no');
          pillGroup.querySelectorAll('.wiz-pill').forEach(l => l.classList.remove('active-yes', 'active-no'));
          label.classList.add(`active-${value}`);
          updateWarning();
        });

        row.appendChild(input);
        pillGroup.appendChild(label);
      });
      row.appendChild(pillGroup);
      wrap.appendChild(row);
    });

    wrap.append(warningEl, overrideEl);
    updateWarning();
    return wrap;
  }

  function _buildQuestionRow(q) {
    const row = _el('div', 'wiz-q-row');
    row.id = `wiz-q-${q.id}`;
    const saved = _state.gate_answers[q.id];
    if (saved === 'yes') row.classList.add('answered-yes');
    if (saved === 'no')  row.classList.add('answered-no');

    row.appendChild(_el('p', '', { style: 'font-size:13px;color:var(--color-text-primary);margin-bottom:3px;line-height:1.5', textContent: q.question }));
    row.appendChild(_el('span', '', { style: 'font-size:10px;color:var(--color-text-tertiary);font-family:var(--font-mono)', textContent: q.ai_act_reference }));

    const pillGroup = _el('div', '', { style: 'display:flex;gap:8px;margin-top:10px' });
    ['yes', 'no'].forEach(value => {
      const input = document.createElement('input');
      input.type = 'radio'; input.name = `wiz-q-${q.id}`; input.value = value;
      input.id = `wiz-q-${q.id}-${value}`; input.style.display = 'none';
      if (saved === value) input.checked = true;

      const label = document.createElement('label');
      label.htmlFor = input.id;
      label.className = 'wiz-pill' + (saved === value ? ` active-${value}` : '');
      label.textContent = value === 'yes' ? 'Yes' : 'No';

      input.addEventListener('change', () => {
        _state.gate_answers[q.id] = value;
        row.classList.remove('answered-yes', 'answered-no');
        row.classList.add(value === 'yes' ? 'answered-yes' : 'answered-no');
        pillGroup.querySelectorAll('.wiz-pill').forEach(l => l.classList.remove('active-yes', 'active-no'));
        label.classList.add(`active-${value}`);
        _updateGateVisibility();
      });

      row.appendChild(input);
      pillGroup.appendChild(label);
    });
    row.appendChild(pillGroup);
    return row;
  }

  // ── Gate short-circuit visibility ─────────────────────────────────────────────

  function _updateGateVisibility() {
    if (!_detail) return;
    const gates = _detail.axis_b_classification.gates;
    const g2 = gates.find(g => g.gate_id === 'G2');
    const g1AnyYes = _state.gate_answers['G1_any'] === 'yes';
    const g2AnyNo  = g2 && g2.questions.some(q => _state.gate_answers[q.id] === 'no');

    gates.forEach(gate => {
      const el = document.getElementById(`wiz-gate-${gate.gate_id}`);
      if (!el) return;
      let disabled = false;
      if (gate.gate_id !== 'G1' && g1AnyYes) disabled = true;
      if (['G3','G4','G5'].includes(gate.gate_id) && g2AnyNo) disabled = true;
      el.style.opacity = disabled ? '0.38' : '1';
      el.style.pointerEvents = disabled ? 'none' : '';
      el.dataset.disabled = disabled ? 'true' : '';
    });

    // G5_Q0 (Provider/Deployer) controls visibility of G5_Q1, G5_Q2, G5_Q3
    const role = _state.gate_answers['G5_Q0'];
    ['G5_Q1', 'G5_Q2', 'G5_Q3'].forEach(qid => {
      const el = document.getElementById(`wiz-q-${qid}`);
      if (!el) return;
      if (role === 'provider') {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });
  }

  // ── Classify ──────────────────────────────────────────────────────────────────

  function _handleClassify(pane, detail) {
    if (!_state.axis_a_tier) {
      _showInlineError(pane, 'Please select an Axis A tier before classifying.');
      return;
    }
    const unanswered = [];
    const isProvider = _state.gate_answers['G5_Q0'] === 'provider';
    detail.axis_b_classification.gates.forEach(gate => {
      const el = document.getElementById(`wiz-gate-${gate.gate_id}`);
      if (el && el.dataset.disabled === 'true') return;
      const collapsed = COLLAPSED_GATES[gate.gate_id];
      if (collapsed) {
        if (!_state.gate_answers[collapsed.key]) unanswered.push(collapsed.key);
      } else {
        gate.questions.forEach(q => {
          // Skip deployer-only questions when organisation is Provider
          if (isProvider && ['G5_Q1','G5_Q2','G5_Q3'].includes(q.id)) return;
          if (q.type === 'choice') {
            if (!_state.gate_answers[q.id]) unanswered.push(q.id);
          } else if (q.type === 'sub_questions') {
            // Check each sub-question individually
            (q.sub_questions || []).forEach(sq => {
              if (!_state.gate_answers[sq.id]) unanswered.push(sq.id);
            });
          } else {
            if (!_state.gate_answers[q.id]) unanswered.push(q.id);
          }
        });
      }
    });
    if (unanswered.length > 0) {
      _showInlineError(pane, `${unanswered.length} gate question${unanswered.length > 1 ? 's' : ''} still need${unanswered.length === 1 ? 's' : ''} an answer.`);
      return;
    }
    _clearInlineError(pane);

    const axisBResult     = _evaluateGates(_state.gate_answers, detail.axis_b_classification.gates);
    const combinedOutcome = _lookupCombinedOutcome(_state.axis_a_tier, axisBResult.classification, detail.combined_outcome_matrix);
    const outputRecord    = _buildOutputRecord(axisBResult, combinedOutcome, detail);

    _state.result = outputRecord;
    _record['step-3'] = outputRecord;
    if (!_record._meta) _record._meta = { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), use_case_name: '', use_case_id: '', assessed_by: '' };
    _record._meta.last_modified = new Date().toISOString();
    if (outputRecord.use_case_id) _record._meta.use_case_id = outputRecord.use_case_id;
    try {
      sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record));
      // Reflect any use_case_id back to the central panel if it was set here
      if (typeof _ucSetIdentity === 'function') _ucSetIdentity(_record._meta);
    } catch (_) {}

    const rc = pane.querySelector('#wiz-results');
    if (rc) _renderResults(rc, outputRecord);
  }

  // ── Gate evaluation ───────────────────────────────────────────────────────────

  function _evaluateGates(answers, gates) {
    const result = {
      classification: null, gates_completed: [], short_circuit_gate: null,
      articles: [], requirement_control_numbers: [],
      organisation_role: null,
      deployer_obligations_apply: false,
      substantial_modification_applies: false,
      art25_override: false,
      transparency_obligations_apply: false
    };

    for (const gate of gates) {
      const qA = gate.questions.map(q => ({ q, answer: answers[q.id] }));

      if (gate.gate_id === 'G1') {
        result.gates_completed.push('G1');
        if (answers['G1_any'] === 'yes') { result.classification = 'PROHIBITED'; result.short_circuit_gate = 'G1'; return result; }

      } else if (gate.gate_id === 'G2') {
        result.gates_completed.push('G2');
        if (qA.some(({ answer }) => answer === 'no')) { result.classification = 'OUT_OF_SCOPE'; result.short_circuit_gate = 'G2'; return result; }

      } else if (gate.gate_id === 'G3') {
        result.gates_completed.push('G3');
        if (answers['G3_any'] === 'yes') { result.classification = 'HIGH_RISK'; _mergeArticles(result, gate.outcomes.any_yes.applicable_articles); }
        else { result.classification = result.classification || 'NOT_HIGH_RISK'; }

      } else if (gate.gate_id === 'G4') {
        result.gates_completed.push('G4');
        if (qA.some(({ answer }) => answer === 'yes')) { result.transparency_obligations_apply = true; _mergeArticles(result, gate.outcomes.any_yes.applicable_articles); }

      } else if (gate.gate_id === 'G5') {
        result.gates_completed.push('G5');
        const isProvider = answers['G5_Q0'] === 'provider';
        result.organisation_role = answers['G5_Q0'] || null;

        qA.forEach(({ q, answer }) => {
          if (q.id === 'G5_Q0') return; // handled above via answers['G5_Q0']

          if (q.type === 'sub_questions') {
            // G5_Q3: synthesise from sub-questions
            const art25SubIds = (q.sub_questions || []).map(sq => sq.id);
            const anyYes = art25SubIds.some(id => answers[id] === 'yes');
            if (anyYes && !isProvider) {
              result.substantial_modification_applies = true;
              result.art25_override = answers['G5_Q3_override'] === true;
              const outcome = gate.outcomes['G5_Q3_yes'];
              if (outcome && outcome.applicable_articles) _mergeArticles(result, outcome.applicable_articles);
            }
            return;
          }

          if (isProvider && ['G5_Q1','G5_Q2'].includes(q.id)) return; // not applicable for providers

          if (answer === 'yes') {
            const outcome = gate.outcomes[`${q.id}_yes`];
            if (outcome && outcome.applicable_articles) _mergeArticles(result, outcome.applicable_articles);
            if (q.id === 'G5_Q1') result.deployer_obligations_apply = true;
          }
        });
      }
    }

    if (result.classification === 'NOT_HIGH_RISK' || !result.classification) {
      result.classification = result.transparency_obligations_apply ? 'LIMITED_RISK' : 'MINIMAL_RISK';
    }
    return result;
  }

  function _mergeArticles(result, articles) {
    if (!Array.isArray(articles)) return;
    articles.forEach(article => {
      if (!result.articles.find(a => a.article_number === article.article_number)) result.articles.push(article);
      (article.requirement_control_numbers || []).forEach(cn => { if (!result.requirement_control_numbers.includes(cn)) result.requirement_control_numbers.push(cn); });
    });
  }

  function _lookupCombinedOutcome(axisTier, axisBClass, matrix) {
    return matrix.rules.find(r => r.axis_a === axisTier && r.axis_b === axisBClass)
        || matrix.rules.find(r => r.axis_a === 'any'    && r.axis_b === axisBClass)
        || null;
  }

  // ── Build output record (matches output_record_template in step-3.json) ────────

  function _buildOutputRecord(axisBResult, combinedOutcome, detail) {
    const tierDef = detail.axis_a_classification.tiers.find(t => t.tier_id === _state.axis_a_tier);
    return {
      step_id: 'step-3', step_title: 'System classification',
      classification_date: new Date().toISOString().split('T')[0],
      classified_by: (_record._meta && _record._meta.assessed_by) || '',
      use_case_id:   (_record._meta && _record._meta.use_case_id) || '',
      axis_a: { tier: _state.axis_a_tier, tier_label: tierDef ? tierDef.label : '', content_types_identified: [], escalation_applied: false },
      axis_b: {
        ai_act_outcome: axisBResult.classification,
        gates_completed: axisBResult.gates_completed,
        short_circuit_gate: axisBResult.short_circuit_gate,
        gate_answers: { ..._state.gate_answers },
        applicable_articles: axisBResult.articles,
        organisation_role: axisBResult.organisation_role,
        deployer_obligations_apply: axisBResult.deployer_obligations_apply,
        substantial_modification_applies: axisBResult.substantial_modification_applies,
        art25_override: axisBResult.art25_override,
        transparency_obligations_apply: axisBResult.transparency_obligations_apply
      },
      combined_outcome: combinedOutcome ? {
        outcome_label: combinedOutcome.label,
        change_board_required: combinedOutcome.change_board_required,
        requires_conformity_assessment: combinedOutcome.requires_conformity_assessment,
        requires_dpia: combinedOutcome.requires_dpia,
        article_14_human_oversight: combinedOutcome.article_14_human_oversight,
        article_50_transparency: combinedOutcome.article_50_transparency,
        sr9_oversight_mechanism: combinedOutcome.sr9_oversight_mechanism
      } : null,
      all_requirement_control_numbers: axisBResult.requirement_control_numbers
    };
  }

  // ── Render results ────────────────────────────────────────────────────────────

  function _renderResults(container, record) {
    container.innerHTML = '';
    container.style.cssText = 'margin-top:28px;padding-top:24px;border-top:2px solid var(--color-border)';

    const classification = record.axis_b.ai_act_outcome;
    const STYLES = {
      PROHIBITED:             { cls: 'danger',  label: 'PROHIBITED' },
      OUT_OF_SCOPE:           { cls: 'info',    label: 'OUT OF SCOPE' },
      HIGH_RISK:              { cls: 'warning', label: 'HIGH RISK' },
      LIMITED_RISK:           { cls: 'info',    label: 'LIMITED RISK' },
      MINIMAL_RISK:           { cls: 'all',     label: 'MINIMAL RISK' },
      LIMITED_OR_MINIMAL_RISK:{ cls: 'all',     label: 'LIMITED / MINIMAL RISK' },
    };
    const s = STYLES[classification] || STYLES.MINIMAL_RISK;

    const headerRow = _el('div', '', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px' });
    headerRow.append(
      _el('h3', '', { style: 'font-size:16px;font-weight:500;color:var(--color-text-primary);margin:0', textContent: 'Classification Result' }),
      _el('span', `badge ${record.axis_a.tier === 'tier_1' ? 'all' : 'tier2'}`, { textContent: record.axis_a.tier_label || record.axis_a.tier }),
      _el('span', `wiz-result-badge ${s.cls}`, { textContent: s.label })
    );
    if (record.axis_b.organisation_role) {
      const roleLabel = record.axis_b.organisation_role === 'provider' ? 'Provider (builder)' : 'Deployer (subscriber)';
      const roleCls   = record.axis_b.organisation_role === 'provider' ? 'warning' : 'info';
      headerRow.appendChild(_el('span', `wiz-result-badge ${roleCls}`, { textContent: roleLabel }));
    }
    container.appendChild(headerRow);

    if (classification === 'PROHIBITED') {
      container.appendChild(_el('div', 'gate-note danger', { textContent: 'One or more answers indicate a use prohibited under Article 5 of the EU AI Act. This system cannot be deployed. ISG must record this determination and notify the AI Change Board.' }));
      _appendSaveRow(container, record); return;
    }
    if (classification === 'OUT_OF_SCOPE') {
      container.appendChild(_el('div', 'gate-note info', { textContent: 'The system does not meet the Article 3(1) definition of an AI system. The EU AI Act does not apply. Internal governance tier (Axis A) still determines the workflow path.' }));
      _appendSaveRow(container, record); return;
    }

    // Combined outcome card
    if (record.combined_outcome) {
      const co = record.combined_outcome;
      const coCard = _el('div', 'wiz-outcome-card');
      coCard.appendChild(_el('p', '', { style: 'font-size:13px;font-weight:500;color:var(--color-text-primary);margin-bottom:12px', textContent: co.outcome_label }));
      const flagGrid = _el('div', 'wiz-flag-grid');
      [
        { label: 'Change Board approval', value: co.change_board_required },
        { label: 'Conformity assessment', value: co.requires_conformity_assessment },
        { label: 'DPIA required',         value: co.requires_dpia === true ? true : co.requires_dpia === false ? false : null },
        { label: 'Article 14 oversight',  value: co.article_14_human_oversight },
        { label: 'Article 50 disclosure', value: co.article_50_transparency === true ? true : co.article_50_transparency === false ? false : null },
      ].forEach(({ label, value }) => {
        const flag = _el('div', 'wiz-flag');
        const dot  = _el('span', 'wiz-flag-dot');
        dot.style.background = value === true ? 'var(--danger-border)' : value === false ? 'var(--success-border)' : 'var(--color-border-mid)';
        flag.append(
          dot,
          _el('span', '', { style: 'color:var(--color-text-secondary)', textContent: label }),
          _el('span', '', { style: `font-weight:500;color:${value === true ? 'var(--danger-text)' : value === false ? 'var(--success-text)' : 'var(--color-text-tertiary)'}`, textContent: value === true ? 'Required' : value === false ? 'Not required' : 'Context-dependent' })
        );
        flagGrid.appendChild(flag);
      });
      coCard.appendChild(flagGrid);
      coCard.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);margin-top:12px;padding-top:10px;border-top:1px solid var(--color-border);font-style:italic', textContent: `AI SR9 oversight: ${co.sr9_oversight_mechanism}` }));
      container.appendChild(coCard);
    }

    // Applicable articles
    if (record.axis_b.applicable_articles.length > 0) {
      const lbl = _sectionLabel(`Applicable articles (${record.axis_b.applicable_articles.length})`);
      lbl.style.marginTop = '16px';
      container.appendChild(lbl);
      record.axis_b.applicable_articles.forEach(art => {
        const artCard = _el('div', 'wiz-article-card');
        const head = _el('div', '', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px' });
        head.append(
          _el('span', '', { style: 'font-size:13px;font-weight:500;color:var(--color-text-primary)', textContent: `${art.article_number}: ${art.title}` }),
          _el('span', 'badge pdata', { textContent: `${(art.requirement_control_numbers || []).length} controls` })
        );
        artCard.append(head, _el('p', '', { style: 'font-size:12px;color:var(--color-text-secondary);line-height:1.5', textContent: art.trigger_reason }));
        container.appendChild(artCard);
      });
    }

    // Control numbers
    if (record.all_requirement_control_numbers.length > 0) {
      const cnLbl = _sectionLabel(`All requirement control numbers (${record.all_requirement_control_numbers.length})`);
      cnLbl.style.marginTop = '16px';
      container.appendChild(cnLbl);
      const cnWrap = _el('div', '', { style: 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px' });
      record.all_requirement_control_numbers.forEach(cn => cnWrap.appendChild(_el('span', 'wiz-cn-badge', { textContent: cn })));
      container.appendChild(cnWrap);
    }

    _appendSaveRow(container, record);
  }

  function _appendSaveRow(container, record) {
    // Step result is already in sessionStorage — instruct user to use the central Save Record button
    const note = _el('div', '', {
      style: 'margin-top:16px;padding:10px 14px;background:var(--success-50,#f0fdf4);border:1px solid var(--success-200,#bbf7d0);border-radius:6px;font-size:12px;color:var(--success-700,#15803d);'
    });
    note.innerHTML = '<strong>Classification saved to record.</strong> Use the <strong>Save Record</strong> button in the sidebar to download the full system record JSON.';
    container.appendChild(note);
  }

  // ── Download ──────────────────────────────────────────────────────────────────

  function _downloadRecord(step3Record) {
    const full = Object.assign({}, _record, {
      _meta: Object.assign({ schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString() }, _record._meta, {
        last_modified: new Date().toISOString(),
        use_case_id: step3Record.use_case_id || (_record._meta && _record._meta.use_case_id) || ''
      }),
      'step-3': step3Record
    });
    const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `system-record${step3Record.use_case_id ? '-' + step3Record.use_case_id : ''}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Load / restore ────────────────────────────────────────────────────────────

  function _loadRecord(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        _record = parsed;
        const step3Data = parsed['step-3'];
        if (!step3Data) { alert('This file does not contain Step 3 data. Other step records have been loaded.'); return; }
        _restoreState(step3Data);
        try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
        if (typeof selectStep === 'function') selectStep('step-3');
      } catch (err) { alert(`Could not parse record file: ${err.message}`); }
    };
    reader.readAsText(file);
  }

  function _restoreState(step3Data) {
    _state.axis_a_tier       = step3Data.axis_a?.tier || null;
    _state.gate_answers      = step3Data.axis_b?.gate_answers || {};
    _state.organisation_role = step3Data.axis_b?.organisation_role || null;
    _state.art25_override    = step3Data.axis_b?.art25_override || false;
    _state.result            = step3Data;
  }

  // ── Inline error ──────────────────────────────────────────────────────────────

  function _showInlineError(pane, message) {
    let err = pane.querySelector('.wiz-inline-error');
    if (!err) { err = _el('div', 'wiz-inline-error gate-note danger'); pane.querySelector('.wiz-action-row').insertAdjacentElement('afterend', err); }
    err.textContent = message;
  }
  function _clearInlineError(pane) { const e = pane.querySelector('.wiz-inline-error'); if (e) e.remove(); }

  // ── Styles ────────────────────────────────────────────────────────────────────

  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      /* Tab strip */
      .wiz-tab-strip { display:flex;margin-bottom:24px;border-bottom:1px solid var(--color-border); }
      .wiz-tab { padding:8px 18px;font-size:13px;font-weight:500;border:none;background:transparent;cursor:pointer;color:var(--color-text-secondary);border-bottom:2px solid transparent;margin-bottom:-1px;font-family:inherit;transition:color var(--transition),border-color var(--transition); }
      .wiz-tab:hover { color:var(--color-text-primary); }
      .wiz-tab.active { color:var(--teal-text);border-bottom-color:var(--teal-border); }

      /* Identity */
      .wiz-section { background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:16px 18px;margin-bottom:20px; }

      /* Axis A tier cards */
      .wiz-tier-card { display:block;border:2px solid var(--color-border);border-radius:var(--radius-md);padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:border-color var(--transition),background var(--transition);user-select:none; }
      .wiz-tier-card:hover { border-color:var(--color-border-mid);background:var(--color-bg); }
      .wiz-tier-card.selected-tier_1 { border-color:var(--teal-border);background:var(--teal-fill); }
      .wiz-tier-card.selected-tier_2 { border-color:var(--amber-border);background:var(--amber-fill); }

      /* Gates */
      .wiz-gate-section { border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:12px;overflow:hidden;transition:opacity var(--transition); }
      .wiz-gate-header { padding:12px 16px;background:var(--color-bg);border-bottom:1px solid var(--color-border); }
      .wiz-gate-body { padding:14px 16px;display:flex;flex-direction:column;gap:10px; }

      /* Questions */
      .wiz-q-row { background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 14px;transition:border-color var(--transition); }
      .wiz-q-row.answered-yes { border-color:var(--danger-border); }
      .wiz-q-row.answered-no  { border-color:var(--success-border); }
      .wiz-pill { padding:5px 18px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--color-border-mid);background:var(--color-surface);color:var(--color-text-secondary);transition:all var(--transition);user-select:none;font-family:inherit; }
      .wiz-pill.active-yes { border-color:var(--danger-border);background:var(--danger-fill);color:var(--danger-text); }
      .wiz-pill.active-no  { border-color:var(--success-border);background:var(--success-fill);color:var(--success-text); }

      /* Actions */
      .wiz-action-row { display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:24px;padding-top:20px;border-top:1px solid var(--color-border); }
      .wiz-btn-primary { padding:10px 22px;border-radius:var(--radius-md);font-size:14px;font-weight:500;cursor:pointer;background:var(--teal-border);color:#fff;border:none;font-family:inherit;transition:opacity var(--transition); }
      .wiz-btn-primary:hover { opacity:0.88; }
      .wiz-btn-secondary { padding:10px 22px;border-radius:var(--radius-md);font-size:14px;font-weight:500;cursor:pointer;background:var(--color-surface);color:var(--color-text-secondary);border:1px solid var(--color-border-mid);font-family:inherit;transition:background var(--transition); }
      .wiz-btn-secondary:hover { background:var(--color-bg); }

      /* Results */
      .wiz-result-badge { font-size:11px;font-weight:600;padding:3px 12px;border-radius:999px;letter-spacing:0.5px; }
      .wiz-result-badge.danger  { background:var(--danger-fill); border:1px solid var(--danger-border); color:var(--danger-text); }
      .wiz-result-badge.warning { background:var(--warning-fill);border:1px solid var(--warning-border);color:var(--warning-text); }
      .wiz-result-badge.info    { background:var(--info-fill);   border:1px solid var(--info-border);   color:var(--info-text); }
      .wiz-result-badge.all     { background:var(--success-fill);border:1px solid var(--success-border);color:var(--success-text); }
      .wiz-outcome-card { background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:16px 18px;margin-bottom:16px; }
      .wiz-flag-grid { display:grid;grid-template-columns:repeat(2,1fr);gap:8px; }
      .wiz-flag { display:flex;align-items:center;gap:8px;font-size:12px; }
      .wiz-flag-dot { width:8px;height:8px;border-radius:50%;flex-shrink:0; }
      .wiz-article-card { background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:8px; }
      .wiz-cn-badge { font-size:10px;font-weight:500;padding:2px 8px;border-radius:4px;background:var(--purple-fill);border:1px solid var(--purple-border);color:var(--purple-text);font-family:var(--font-mono); }
      .wiz-ref-tag { flex-shrink:0;font-size:10px;font-weight:500;padding:1px 6px;border-radius:3px;background:var(--color-bg);border:1px solid var(--color-border-mid);color:var(--color-text-tertiary);font-family:var(--font-mono); }

      /* G3 domain list with collapsible sub-questions */
      .wiz-domain-list { display:flex;flex-direction:column;gap:6px; }
      .wiz-domain-item { background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:8px 10px; }
      .wiz-domain-header { display:flex;gap:6px;align-items:baseline;margin-bottom:4px; }
      .wiz-domain-text { font-size:11px;color:var(--color-text-secondary);line-height:1.4; }
      .wiz-sub-toggle { background:none;border:none;padding:0;font-size:11px;color:var(--teal-text,#0d9488);cursor:pointer;font-family:inherit;margin-top:2px;text-align:left; }
      .wiz-sub-toggle:hover { text-decoration:underline; }
      .wiz-sub-collapse { display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border); }
      .wiz-sub-collapse.open { display:block; }
      .wiz-sub-item { display:flex;gap:6px;align-items:baseline;padding:2px 0; }
      .wiz-sub-bullet { flex-shrink:0;font-size:12px;color:var(--color-text-tertiary); }

      /* G5_Q0 choice cards (Provider vs Deployer) */
      .wiz-choice-question { background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:14px 16px; }
      .wiz-choice-options { display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px; }
      .wiz-choice-card { display:flex;flex-direction:column;gap:4px;border:2px solid var(--color-border);border-radius:var(--radius-md);padding:12px 14px;cursor:pointer;transition:border-color var(--transition),background var(--transition);user-select:none; }
      .wiz-choice-card:hover { border-color:var(--color-border-mid);background:var(--color-bg); }
      .wiz-choice-card.selected { border-color:var(--teal-border);background:var(--teal-fill); }
      .wiz-choice-label { font-size:13px;font-weight:500;color:var(--color-text-primary); }
      .wiz-choice-desc { font-size:11px;color:var(--color-text-secondary);line-height:1.4; }

      /* G5_Q3 sub-question group + Art.25 warning */
      .wiz-subq-group { background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:14px 16px;display:flex;flex-direction:column;gap:10px; }
      .wiz-art25-warning { margin-top:4px; }
      .wiz-art25-override { align-items:flex-start;gap:8px;margin-top:4px; }

      /* Reference pane helpers */
      .ov-tier-card { background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:8px; }
      .ov-chip { display:inline-block;font-size:11px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:4px;padding:2px 7px;margin:2px 2px 2px 0;color:var(--color-text-secondary); }
      .ov-gate-row { display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--color-bg);border-radius:var(--radius-md);margin-bottom:6px; }
    `;
    document.head.appendChild(style);
  }

  // ── DOM helper ────────────────────────────────────────────────────────────────

  function _el(tag, className, props = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.entries(props).forEach(([k, v]) => { if (k === 'style') el.style.cssText = v; else el[k] = v; });
    return el;
  }

  function _sectionLabel(text) { return _el('p', 'section-label', { textContent: text }); }

})();
