// step2-wizard.js
// Business Case Documentation — Step 2.
// Captures the business case description and URL, and provides the
// combined Stage 1 "Ask JAKE" prompt for Steps 3 (Classification) and 4 (DPIA).

(function () {
  'use strict';

  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _state = { business_case: '', business_case_url: '' };
  let _record = {};
  let _detail = null;

  // ── Public API ────────────────────────────────────────────────────────────

  window.mountStep2Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _detail = detail;
    _injectStyles();

    _record = WizUtils.loadRecord();

    if (_record['step-2']) {
      _state.business_case     = _record['step-2'].business_case     || '';
      _state.business_case_url = _record['step-2'].business_case_url || '';
    }

    container.innerHTML = '';

    // Standard full-width title section (from workflow.json)
    container.appendChild(WizUtils.buildStepHeader(step, colorKey, phaseTitle));

    // White content section — the fields to capture
    const card = _el('div', 'step-content-section');

    const identNote = _el('div', 's2-identity-note');
    identNote.innerHTML = '<strong>Use case identity</strong> (name, ID, and assessor) is captured in the <strong>Use Case Record</strong> panel in the left sidebar. Complete that panel before proceeding.';
    card.appendChild(identNote);

    card.appendChild(_buildBusinessCaseForm());
    card.appendChild(_buildAskJakeSection());

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
    WizUtils.saveRecord(_record);
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  function _injectStyles() {
    WizUtils.injectStyles('wiz2-styles', `
      /* Step 2 form */
      .s2-identity-note { font-size:12px;color:var(--color-text-secondary);background:var(--info-fill,rgba(80,150,225,0.12));border:1px solid var(--info-border,rgba(80,150,225,0.40));border-radius:var(--radius-md,6px);padding:10px 14px;margin-bottom:20px;line-height:1.5; }
      .s2-form-section { margin-bottom:24px; }
      .s2-field-label { display:block;font-size:12px;font-weight:500;color:var(--color-text-secondary);margin-bottom:4px; }
      .s2-field-hint { font-size:11px;color:var(--color-text-tertiary);margin-bottom:6px;line-height:1.5; }
      .s2-textarea { width:100%;padding:10px 12px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface);resize:vertical;box-sizing:border-box;line-height:1.6; }
      .s2-textarea:focus { outline:none;border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,rgba(93,202,165,0.16)); }
      .s2-input { display:block;width:100%;padding:8px 10px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface);box-sizing:border-box;margin-top:4px; }
      .s2-input:focus { outline:none;border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,rgba(93,202,165,0.16)); }

      /* Ask JAKE collapsible */
      .s2-jake-section { margin-top:24px;margin-bottom:24px; }
      .s2-jake-header { background:var(--teal-50,rgba(93,202,165,0.10)) !important; }
      .s2-jake-header:hover { background:var(--teal-100,rgba(93,202,165,0.16)) !important; }
      .s2-jake-instructions { font-size:12px;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-sm,4px);padding:12px 14px;margin-bottom:14px;line-height:1.6; }
      .s2-prompt-wrap { display:flex;flex-direction:column;gap:8px; }
      .s2-copy-btn { align-self:flex-start; }
      .s2-prompt-area { width:100%;padding:12px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:11px;font-family:var(--font-mono,monospace);color:var(--color-text-secondary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.6; }

    `);
  }

})();
