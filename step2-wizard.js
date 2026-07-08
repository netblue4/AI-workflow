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
  let _dpiaFields = null; // fieldId → { type, options } (from step-4.json), for load validation

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
    card.appendChild(_buildLoadSection());

    container.appendChild(card);
    _loadDpiaSchema();
  };

  // Load the Step 4 field definitions so the DPIA loader can validate values.
  function _loadDpiaSchema() {
    if (_dpiaFields) return;
    fetch('step-4.json').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      const map = {};
      (function walk(o) {
        if (Array.isArray(o)) return o.forEach(walk);
        if (o && typeof o === 'object') {
          if (typeof o.id === 'string' && o.id.indexOf('_f') > -1) {
            const opts = Array.isArray(o.options)
              ? o.options.map(x => (x && typeof x === 'object') ? x.value : x) : null;
            map[o.id] = { type: o.type, options: opts, label: o.label || o.question || o.id };
          }
          Object.values(o).forEach(walk);
        }
      })(d);
      _dpiaFields = map;
    }).catch(() => {});
  }

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

  // ── Load JAKE output into Step 4 (DPIA) ───────────────────────────────────

  function _buildLoadSection() {
    const section = _el('div', 'wiz-collapsible-section s2-jake-section');
    const header  = _el('div', 'wiz-collapsible-header s2-jake-header');
    const hLeft   = _el('div', 'wiz-collapsible-header-left');
    hLeft.appendChild(_el('p', 'section-label', { style: 'margin-bottom:2px', textContent: 'Load JAKE output into Step 4 (DPIA)' }));
    hLeft.appendChild(_el('p', '', { style: 'font-size:11px;color:var(--color-text-tertiary);margin:0', textContent: 'Paste JAKE’s output; the DPIA answers are validated and loaded into Step 4 so you don’t re-key them.' }));
    const hRight  = _el('div', 'wiz-collapsible-header-right');
    const chevron = _el('span', 's2-jake-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 'wiz-collapsible-body');
    body.style.display = 'none';

    const ta = _el('textarea', 's2-prompt-area');
    ta.rows = 8;
    ta.placeholder = 'Paste JAKE’s full reply (or just its ```json block) here…';

    const btnRow = _el('div', ''); btnRow.style.cssText = 'display:flex;gap:8px;margin:10px 0';
    const checkBtn = _el('button', 'wiz-btn-secondary', { textContent: 'Validate & preview' });
    const applyBtn = _el('button', 'wiz-btn-primary', { textContent: 'Apply to Step 4' });
    applyBtn.style.display = 'none';
    btnRow.append(checkBtn, applyBtn);

    const preview = _el('div', 's2-load-preview'); preview.style.cssText = 'font-size:12.5px;line-height:1.6';

    let _clean = null;
    checkBtn.addEventListener('click', () => {
      applyBtn.style.display = 'none'; _clean = null;
      const answers = _extractDpiaAnswers(ta.value);
      if (!answers) { preview.innerHTML = '<span style="color:#fba4a3">Could not find a <code>dpia_answers</code> JSON block in the pasted text.</span>'; return; }
      if (!_dpiaFields) { preview.innerHTML = '<span style="color:#ecd489">Step 4 field definitions still loading — try again in a moment.</span>'; return; }
      const { clean, warnings, matched } = _validateDpia(answers);
      _clean = clean;
      preview.innerHTML = _renderPreview(matched, warnings);
      if (matched > 0) applyBtn.style.display = '';
    });
    applyBtn.addEventListener('click', () => {
      if (!_clean) return;
      const n = _applyDpia(_clean);
      preview.innerHTML = `<span style="color:#8cebb0">✓ Loaded ${n} DPIA field${n !== 1 ? 's' : ''} into Step 4. Open <strong>Step 4 — Data identification and DPIA</strong> to review and save.</span>`;
      applyBtn.style.display = 'none';
    });

    body.append(ta, btnRow, preview);
    section.appendChild(body);
    header.addEventListener('click', () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      chevron.style.transform = hidden ? 'rotate(180deg)' : '';
    });
    return section;
  }

  // Pull the dpia_answers object out of pasted text: a fenced ```json block, a
  // bare JSON object, or a JSON object embedded in a wider reply.
  function _extractDpiaAnswers(text) {
    const tryParse = s => { try { return JSON.parse(s); } catch (_) { return null; } };
    const pick = o => (o && o.dpia_answers && typeof o.dpia_answers === 'object') ? o.dpia_answers
                    : (o && typeof o === 'object' && !Array.isArray(o) && _looksLikeAnswers(o)) ? o : null;
    // 1) fenced code blocks
    const fences = [...(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
    for (const f of fences) { const o = tryParse(f.trim()); const a = pick(o); if (a) return a; }
    // 2) every {...} candidate, largest first
    const objs = (text || '').match(/\{[\s\S]*\}/g) || [];
    objs.sort((a, b) => b.length - a.length);
    for (const c of objs) { const o = tryParse(c); const a = pick(o); if (a) return a; }
    return null;
  }
  function _looksLikeAnswers(o) {
    return Object.keys(o).some(k => /_f\d/.test(k));
  }

  function _validateDpia(answers) {
    const clean = {}; const warnings = []; let matched = 0;
    Object.entries(answers).forEach(([id, val]) => {
      const f = _dpiaFields[id];
      if (!f) { warnings.push(`Unknown field <code>${_esc(id)}</code> — skipped.`); return; }
      if (f.type === 'checkbox_group') {
        const arr = Array.isArray(val) ? val : (val ? [val] : []);
        const ok = arr.filter(v => !f.options || f.options.includes(v));
        const bad = arr.filter(v => f.options && !f.options.includes(v));
        bad.forEach(v => warnings.push(`<code>${_esc(id)}</code>: "${_esc(v)}" is not a valid option — dropped.`));
        clean[id] = ok; matched++;
      } else if (f.type === 'select') {
        if (f.options && !f.options.includes(val)) { warnings.push(`<code>${_esc(id)}</code>: "${_esc(String(val))}" is not a valid option — skipped.`); return; }
        clean[id] = String(val); matched++;
      } else {
        clean[id] = String(val == null ? '' : val); matched++;
      }
    });
    return { clean, warnings, matched };
  }

  function _renderPreview(matched, warnings) {
    const total = Object.keys(_dpiaFields || {}).length;
    let html = `<div style="color:#8cebb0;font-weight:600;margin-bottom:6px">✓ ${matched} of ${total} DPIA fields recognised.</div>`;
    if (warnings.length) {
      html += `<div style="color:#ecd489;margin-bottom:4px">${warnings.length} item${warnings.length !== 1 ? 's' : ''} need attention:</div>`;
      html += '<ul style="margin:0 0 0 16px;padding:0;color:var(--color-text-secondary)">' +
        warnings.slice(0, 12).map(w => `<li>${w}</li>`).join('') +
        (warnings.length > 12 ? `<li>…and ${warnings.length - 12} more</li>` : '') + '</ul>';
    }
    html += '<div style="color:var(--color-text-tertiary);margin-top:8px">Review above, then apply. Nothing is written until you click <strong>Apply to Step 4</strong>.</div>';
    return html;
  }

  function _applyDpia(clean) {
    _record = WizUtils.loadRecord() || {};
    const prev = _record['step-4'] || {};
    const answers = Object.assign({}, prev.answers || {}, clean);
    _record['step-4'] = Object.assign({}, prev, {
      step_id: 'step-4',
      step_title: 'Data identification and DPIA',
      loaded_from_jake: true,
      loaded_at: new Date().toISOString(),
      answers
    });
    if (!_record._meta) _record._meta = { schema_version: '1.0', created: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    WizUtils.saveRecord(_record);
    return Object.keys(clean).length;
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
