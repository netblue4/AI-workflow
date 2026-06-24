// step2-wizard.js
// Business Case Documentation — Step 2.
// Captures the business case description and URL, and provides the
// combined Stage 1 "Ask JAKE" prompt for Steps 3 (Classification) and 4 (DPIA).

(function () {
  'use strict';

  let _stylesInjected = false;
  let _state = { business_case: '', business_case_url: '' };
  let _record = {};
  let _detail = null;

  // ── Public API ────────────────────────────────────────────────────────────

  window.mountStep2Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _detail = detail;
    _injectStyles();

    try {
      const saved = sessionStorage.getItem('ai_workflow_system_record');
      if (saved) _record = JSON.parse(saved);
    } catch (_) {}

    if (_record['step-2']) {
      _state.business_case     = _record['step-2'].business_case     || '';
      _state.business_case_url = _record['step-2'].business_case_url || '';
    }

    container.innerHTML = '';
    const card = _el('div', 'step-detail-card');

    // Step header
    const eyebrow = _el('div', 'step-detail-eyebrow');
    eyebrow.append(
      _el('span', `step-detail-number color-${colorKey}`, { textContent: step.number }),
      _el('span', 'step-detail-phase-label', { textContent: phaseTitle })
    );
    card.appendChild(eyebrow);
    card.appendChild(_el('h1', 'step-detail-title', { textContent: step.title }));

    const meta = _el('div', 'step-detail-meta');
    meta.appendChild(_el('span', 'owner-tag', {
      innerHTML: `${(typeof ICONS !== 'undefined' ? ICONS[step.ownerIcon] : '') || ''}&nbsp;${step.owners.join(', ')}`
    }));
    (step.requirements || []).forEach(r =>
      meta.appendChild(_el('span', 'badge sr', { textContent: r }))
    );
    const applicMap = { all: 'all', tier2: 'tier2', ops: 'ops', 'personal-data': 'pdata' };
    meta.appendChild(_el('span', `badge ${applicMap[step.applicabilityKey] || 'all'}`, { textContent: step.applicability }));
    card.appendChild(meta);
    card.appendChild(_el('p', 'step-detail-summary', { textContent: step.summary }));

    // Identity note
    const identNote = _el('div', 's2-identity-note');
    identNote.innerHTML = '<strong>Use case identity</strong> (name, ID, and assessor) is captured in the <strong>Use Case Record</strong> panel in the left sidebar. Complete that panel before proceeding.';
    card.appendChild(identNote);

    // Business case form
    card.appendChild(_buildBusinessCaseForm());

    // Ask JAKE collapsible
    card.appendChild(_buildAskJakeSection());

    // Deliverables
    if (step.deliverables?.length) {
      card.appendChild(_sectionLabel('Deliverables'));
      const dl = _el('ul', 'deliverables-list', { style: 'margin-bottom:20px' });
      step.deliverables.forEach(d => {
        const li = _el('li', 'deliverable-item');
        li.innerHTML = `<span class="deliverable-icon">${typeof ICONS !== 'undefined' ? ICONS.check : ''}</span><span>${d}</span>`;
        dl.appendChild(li);
      });
      card.appendChild(dl);
    }

    // Gates
    (step.gates || []).forEach(g => {
      const note = _el('div', `gate-note ${g.type}`);
      note.textContent = g.text;
      card.appendChild(note);
    });

    // Requirement labels
    const reqList = _el('div', 'req-list', { style: 'margin-top:16px' });
    (step.requirementLabels || []).forEach(r =>
      reqList.appendChild(_el('span', 'req-pill', { textContent: r }))
    );
    card.appendChild(reqList);

    container.appendChild(card);
  };

  // ── Business case form ────────────────────────────────────────────────────

  function _buildBusinessCaseForm() {
    const section = _el('div', 's2-form-section');

    const bcLabel = _el('label', 's2-field-label');
    bcLabel.htmlFor = 's2-business-case';
    bcLabel.textContent = 'Business case description';
    const bcHint = _el('p', 's2-field-hint', {
      textContent: 'Describe the system, its purpose, the users, the data it will process, the technology stack, and how the outputs are used. The more detail you provide, the more accurate the JAKE analysis will be.'
    });
    const bcArea = _el('textarea', 's2-textarea');
    bcArea.id = 's2-business-case';
    bcArea.placeholder = 'Describe the AI use case: what problem it solves, who uses it, what data is involved, what technology is used, where it is hosted, and what the outputs are used for.';
    bcArea.value = _state.business_case;
    bcArea.rows = 10;
    bcArea.addEventListener('input', () => {
      _state.business_case = bcArea.value;
      _saveState();
      _refreshPrompt();
    });
    section.append(bcLabel, bcHint, bcArea);

    const urlWrap = _el('div', '', { style: 'margin-top:14px' });
    const urlLabel = _el('label', 's2-field-label');
    urlLabel.htmlFor = 's2-bc-url';
    urlLabel.textContent = 'Supporting documentation URL (optional)';
    const urlInput = _el('input', 's2-input');
    urlInput.type = 'url';
    urlInput.id = 's2-bc-url';
    urlInput.placeholder = 'https://...';
    urlInput.value = _state.business_case_url;
    urlInput.addEventListener('input', () => {
      _state.business_case_url = urlInput.value.trim();
      _saveState();
    });
    urlWrap.append(urlLabel, urlInput);
    section.appendChild(urlWrap);

    return section;
  }

  // ── Ask JAKE collapsible ──────────────────────────────────────────────────

  function _buildAskJakeSection() {
    const section = _el('div', 'wiz-collapsible-section s2-jake-section');

    const header  = _el('div', 'wiz-collapsible-header s2-jake-header');
    const hLeft   = _el('div', 'wiz-collapsible-header-left');
    const title   = _el('p', 'section-label', { style: 'margin-bottom:2px', textContent: 'Ask JAKE to draft a classification and DPIA' });
    const sub     = _el('p', '', {
      style: 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0',
      textContent: 'Stage 1 prompt — covers Steps 3 (EU AI Act classification) and 4 (DPIA). Paste into JAKE, save the report, then record the answers in the step wizards.'
    });
    hLeft.append(title, sub);
    const hRight  = _el('div', 'wiz-collapsible-header-right');
    const chevron = _el('span', 'wiz-gate-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 'wiz-collapsible-body');
    body.style.display = 'none';

    const instruct = _el('div', 's2-jake-instructions');
    instruct.innerHTML = `
      <strong>How to use this prompt</strong>
      <ol style="margin:8px 0 0 18px;padding:0;font-size:12px;color:var(--color-text-secondary);line-height:1.9">
        <li>Enter your business case description in the field above — it will be automatically inserted into the prompt.</li>
        <li>Copy the prompt using the button below.</li>
        <li>Paste it into JAKE and run it.</li>
        <li>Save the JAKE report as a PDF alongside this system record.</li>
        <li>Use the report to answer the questions in the Step 3 and Step 4 wizards.</li>
      </ol>`;
    body.appendChild(instruct);

    const promptWrap = _el('div', 's2-prompt-wrap');
    const copyBtn = _el('button', 'wiz-btn-secondary s2-copy-btn', { textContent: 'Copy prompt' });
    const promptArea = _el('textarea', 's2-prompt-area');
    promptArea.id = 's2-prompt-textarea';
    promptArea.readOnly = true;
    promptArea.rows = 24;
    promptArea.value = _buildPrompt(_state.business_case);

    copyBtn.addEventListener('click', () => {
      const text = promptArea.value;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyBtn.textContent = 'Copy prompt'; }, 2000);
        });
      } else {
        promptArea.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied ✓';
        setTimeout(() => { copyBtn.textContent = 'Copy prompt'; }, 2000);
      }
    });

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

  function _refreshPrompt() {
    const ta = document.getElementById('s2-prompt-textarea');
    if (ta) ta.value = _buildPrompt(_state.business_case);
  }

  // ── The Stage 1 prompt ────────────────────────────────────────────────────

  function _buildPrompt(businessCase) {
    const bc = (businessCase || '').trim() || '[PASTE YOUR BUSINESS CASE DESCRIPTION HERE]';
    const template = _detail?.jake_prompt_template || '';
    return template.replace('{{business_case}}', bc);
  }

  // ── State persistence ─────────────────────────────────────────────────────

  function _saveState() {
    if (!_record) _record = {};
    _record['step-2'] = {
      step_id:           'step-2',
      business_case:     _state.business_case,
      business_case_url: _state.business_case_url,
      saved_at:          new Date().toISOString()
    };
    if (!_record._meta) _record._meta = {
      schema_version: '1.0',
      title: 'AI Acceptable Use — System Authorisation Record',
      standard: 'ISO/IEC 42001-aligned',
      created: new Date().toISOString()
    };
    _record._meta.last_modified = new Date().toISOString();
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    if (document.getElementById('wiz2-styles')) return;
    const style = document.createElement('style');
    style.id = 'wiz2-styles';
    style.textContent = `
      /* Step 2 form */
      .s2-identity-note { font-size:12px;color:var(--color-text-secondary);background:var(--info-fill,#eff6ff);border:1px solid var(--info-border,#bfdbfe);border-radius:var(--radius-md,6px);padding:10px 14px;margin-bottom:20px;line-height:1.5; }
      .s2-form-section { margin-bottom:24px; }
      .s2-field-label { display:block;font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:4px; }
      .s2-field-hint { font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px;line-height:1.5; }
      .s2-textarea { width:100%;padding:10px 12px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface);resize:vertical;box-sizing:border-box;line-height:1.6; }
      .s2-textarea:focus { outline:none;border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,#ccfbf1); }
      .s2-input { display:block;width:100%;padding:8px 10px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface);box-sizing:border-box;margin-top:4px; }
      .s2-input:focus { outline:none;border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,#ccfbf1); }

      /* Ask JAKE collapsible */
      .s2-jake-section { margin-top:24px;margin-bottom:24px; }
      .s2-jake-header { background:var(--teal-50,#f0fdfa) !important; }
      .s2-jake-header:hover { background:var(--teal-100,#ccfbf1) !important; }
      .s2-jake-instructions { font-size:12px;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-sm,4px);padding:12px 14px;margin-bottom:14px;line-height:1.6; }
      .s2-prompt-wrap { display:flex;flex-direction:column;gap:8px; }
      .s2-copy-btn { align-self:flex-start; }
      .s2-prompt-area { width:100%;padding:12px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:11px;font-family:var(--font-mono,monospace);color:var(--color-text-secondary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.6; }

      /* Collapsible section (duplicated from step3 so step2 works standalone) */
      .wiz-collapsible-section { border:1px solid var(--color-border);border-radius:var(--radius-md,6px);overflow:hidden; }
      .wiz-collapsible-header { padding:12px 16px;background:var(--color-bg);cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:12px; }
      .wiz-collapsible-header:hover { background:var(--color-surface); }
      .wiz-collapsible-header-left { flex:1; }
      .wiz-collapsible-header-left .section-label { margin-bottom:0; }
      .wiz-collapsible-header-right { display:flex;align-items:center;gap:8px;flex-shrink:0; }
      .wiz-collapsible-body { padding:14px 16px;border-top:1px solid var(--color-border); }
      .wiz-gate-chevron { display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s; }
    `;
    document.head.appendChild(style);
  }

  // ── DOM helper ────────────────────────────────────────────────────────────

  function _el(tag, className, props = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'style') el.style.cssText = v; else el[k] = v;
    });
    return el;
  }

  function _sectionLabel(text) { return _el('p', 'section-label', { textContent: text }); }

})();
