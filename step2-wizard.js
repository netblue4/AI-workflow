// step2-wizard.js
// Business Case Documentation — Step 2.
// Captures the business case description and URL, and provides the
// combined Stage 1 "Ask your AI tool" prompt for Steps 3 (Classification) and 4 (DPIA).

(function () {
  'use strict';

  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _state = {
    business_case: '', business_case_url: '',
    input_mode: 'text',                              // 'text' | 'wiz'
    wizard: { answers: {}, idx: 0, completed: false } // use-case builder state
  };
  let _record = {};
  let _detail = null;
  let _descHost = null;   // host node the description-capture area re-renders into
  let _segText = null;    // "Write it myself" toggle button
  let _segWiz = null;     // "Guide me" toggle button
  let _dpiaFields = null; // fieldId → { type, options } (from step-4.json), for load validation
  let _clfKeys = null;    // gate-answer key → allowed values (from step-3.json), for classification load

  // ── Public API ────────────────────────────────────────────────────────────

  window.mountStep2Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _detail = detail;
    _injectStyles();

    _record = WizUtils.loadRecord();

    if (_record['step-2']) {
      _state.business_case     = _record['step-2'].business_case     || '';
      _state.business_case_url = _record['step-2'].business_case_url || '';
      _state.input_mode        = _record['step-2'].input_mode        || 'text';
      const w = _record['step-2'].use_case_wizard;
      if (w && typeof w === 'object') {
        _state.wizard = Object.assign({ answers: {}, idx: 0, completed: false }, w);
        if (!_state.wizard.answers || typeof _state.wizard.answers !== 'object') _state.wizard.answers = {};
      }
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
    card.appendChild(_buildAskAiSection());
    card.appendChild(_buildLoadClfSection());
    card.appendChild(_buildLoadSection());

    container.appendChild(card);
    _loadDpiaSchema();
    _loadClfSchema();
  };

  // Load the Step 3 gate-answer keys + allowed values so the classification
  // loader can validate. G1/G3 collapse to a single G1_any / G3_any answer.
  function _loadClfSchema() {
    if (_clfKeys) return;
    fetch('step-3.json').then(r => r.ok ? r.json() : null).then(d => {
      if (!d) return;
      const gb = d.axis_b_classification || {};
      const keys = { tier: ['tier_1', 'tier_2'], G1_any: ['yes', 'no'], G3_any: ['yes', 'no'] };
      (gb.gates || []).forEach(g => {
        if (g.gate_id === 'G1' || g.gate_id === 'G3') return;
        (g.questions || []).forEach(q => {
          if (q.id === 'G5_Q0') keys[q.id] = ['provider', 'deployer'];
          else if (q.type === 'sub_questions') (q.sub_questions || []).forEach(sq => { const id = (sq && sq.id) || sq; if (id) keys[id] = ['yes', 'no']; });
          else keys[q.id] = ['yes', 'no'];
        });
      });
      _clfKeys = keys;
    }).catch(() => {});
  }

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
            map[o.id] = { type: o.type, options: opts, label: o.label || o.question || o.id, condition: o.conditional_show_if || null };
          }
          Object.values(o).forEach(walk);
        }
      })(d);
      _dpiaFields = map;
    }).catch(() => {});
  }

  // ── Use-case builder question set ─────────────────────────────────────────
  // Minimum-typing wizard: each question is read, answered by selecting one or
  // more options (with an optional free-text box), and composed into a business
  // case narrative that feeds the same {{business_case}} slot as free typing.
  // The order and vocabulary deliberately mirror the Step 3 tier gates and Step
  // 4 DPIA fields so the downstream AI draft has the signal it needs.

  const _EXCL = o => /^none\b|^no significant/i.test(o); // mutually-exclusive option

  const QUESTIONS = [
    { id: 'tasks', group: 'Purpose', type: 'multi', other: true, otherPh: 'Other task…',
      q: 'What does {sys} help people do?', help: 'Select all that apply.',
      options: ['Summarise documents', 'Answer questions from documents', 'Draft text or content', 'Translate', 'Extract or structure data', 'Classify or categorise', 'Generate or review code', 'Analyse data or produce reports', 'Search and retrieve information', 'Support decisions'],
      compose: (s, sys, o) => { const it = s.concat(o ? [o] : []); return it.length ? `${sys} is an AI system used to ${_listJoin(it.map(_lc1))}.` : `${sys} is an AI system.`; } },

    { id: 'hosting', group: 'Provenance', type: 'single',
      q: 'Where does {sys} run?', help: 'This tells the assessment whether a third party is in the picture.',
      options: ['In-house / self-hosted', 'Third-party SaaS product', 'Foundation-model API (e.g. a hosted LLM)', 'Not sure'],
      compose: s => ({ 'In-house / self-hosted': 'It runs on infrastructure the organisation hosts itself.', 'Third-party SaaS product': 'It runs on a third-party SaaS platform.', 'Foundation-model API (e.g. a hosted LLM)': 'It is built on a third-party foundation-model API.' }[s[0]] || '') },

    { id: 'role', group: 'Provenance', type: 'single',
      q: 'Is your organisation building {sys}, or using someone else’s?', help: 'Provider = you build or substantially modify it. Deployer = you use it under your own authority.',
      options: ['Provider — we build or substantially modify it', 'Deployer — we use it under our authority', 'Not sure'],
      compose: s => ({ 'Provider — we build or substantially modify it': 'Our organisation acts as the provider of the system (we build or substantially modify it).', 'Deployer — we use it under our authority': 'Our organisation acts as the deployer of the system (we use it under our own authority).' }[s[0]] || '') },

    { id: 'users', group: 'Users', type: 'multi', other: true, otherPh: 'Which department(s)?',
      q: 'Who is allowed to use {sys}?', help: 'Select all that apply.',
      options: ['All staff', 'A specific department', 'Executive leadership', 'Contractors', 'External users or customers'],
      compose: (s, sys, o) => { let it = s.slice(); if (o) { it = it.filter(x => x !== 'A specific department'); it.push(`the ${o} department`); } return it.length ? `It is available to ${_listJoin(it.map(_lc1))}.` : ''; } },

    { id: 'reach', group: 'Users', type: 'single',
      q: 'Where do {sys}’s outputs go?',
      options: ['Internal use only', 'Shared with clients', 'Shared with vendors or partners', 'Public-facing'],
      compose: s => ({ 'Internal use only': 'Its outputs are used internally only.', 'Shared with clients': 'Its outputs are shared with clients.', 'Shared with vendors or partners': 'Its outputs are shared with vendors or partners.', 'Public-facing': 'Its outputs are public-facing.' }[s[0]] || '') },

    { id: 'data_types', group: 'Data', type: 'multi', other: true, otherPh: 'Other data type…',
      q: 'What kinds of documents or data does {sys} process?', help: 'Select all that apply.',
      options: ['Employee handbooks or policies', 'Technical designs or IP', 'Customer contracts', 'Financial records', 'Personnel or HR records', 'Customer personal data', 'Health data', 'Public or marketing content', 'Source code', 'Emails or correspondence'],
      compose: (s, sys, o) => { const it = s.concat(o ? [o] : []); return it.length ? `It processes ${_listJoin(it.map(_lc1))}.` : ''; } },

    { id: 'sensitive', group: 'Data', type: 'multi',
      q: 'Does that data include any sensitive information?', help: 'Select all that apply.',
      options: ['Personal data (PII)', 'Special-category data (e.g. health, biometric)', 'Trade secrets or confidential IP', 'Financial or payment data', 'None of these'],
      compose: s => { const it = s.filter(x => x !== 'None of these'); if (!it.length) return s.includes('None of these') ? 'The data is not expected to contain personal, special-category, or confidential information.' : ''; return `This data includes ${_listJoin(it.map(_lc1))}.`; } },

    { id: 'application', group: 'Oversight', type: 'multi',
      q: 'How are {sys}’s outputs used?', help: 'Select all that apply.',
      options: ['Read for general understanding', 'Copied into external communications', 'Used as the basis for a decision', 'Used to approve or trigger a workflow', 'Published without human edits'],
      compose: s => s.length ? `Its outputs are ${_listJoin(s.map(_lc1))}.` : '' },

    { id: 'oversight', group: 'Oversight', type: 'single',
      q: 'Is there a human check before {sys}’s output is acted on?',
      options: ['Yes — formal verification is required', 'Informal or ad-hoc checking', 'No — outputs are used directly'],
      compose: s => ({ 'Yes — formal verification is required': 'A formal human verification step is required before outputs are acted on.', 'Informal or ad-hoc checking': 'Human checking of outputs is informal or ad-hoc.', 'No — outputs are used directly': 'There is no human verification step; outputs are used directly.' }[s[0]] || '') },

    { id: 'impact', group: 'Consequences', type: 'single',
      q: 'If {sys} is wrong or hallucinates, how serious is it?',
      options: ['Negligible', 'Minor', 'Moderate', 'Severe'],
      compose: s => s[0] ? `If the system produces an incorrect or hallucinated output, the assessed business impact is ${_lc1(s[0])}.` : '' },

    { id: 'consequences', group: 'Consequences', type: 'multi',
      q: 'A wrong answer could lead to…', help: 'Select all that apply.',
      options: ['Regulatory or compliance breach', 'Physical safety hazard', 'Financial loss', 'Reputational harm', 'Discrimination or unfair outcome', 'No significant consequence'],
      compose: s => { const it = s.filter(x => x !== 'No significant consequence'); if (!it.length) return s.includes('No significant consequence') ? 'A wrong output is not expected to cause significant harm.' : ''; return `A wrong output could result in ${_listJoin(it.map(_lc1))}.`; } }
  ];

  // Text helpers for narrative assembly.
  function _lc1(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function _listJoin(a) { a = a.filter(Boolean); if (a.length <= 1) return a[0] || ''; if (a.length === 2) return a[0] + ' and ' + a[1]; return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function _qSys()    { const n = (_record._meta && _record._meta.use_case_name || '').trim(); return n || 'your AI system'; }
  function _narrSys() { const n = (_record._meta && _record._meta.use_case_name || '').trim(); return n || 'The system'; }

  function _assembleNarrative(answers) {
    const sys = _narrSys(); const parts = [];
    QUESTIONS.forEach(q => {
      const a = answers[q.id] || { sel: [], other: '' };
      const sentence = q.compose(a.sel || [], sys, (a.other || '').trim());
      if (sentence) parts.push(sentence);
    });
    return parts.join(' ');
  }

  // ── Business case form (toggle: type it, or use the guided builder) ────────

  function _buildBusinessCaseForm() {
    const section = _el('div', 's2-form-section');

    // Segmented toggle
    const seg = _el('div', 's2-seg');
    _segText = _el('button', 's2-seg-btn' + (_state.input_mode === 'text' ? ' is-on' : ''), { textContent: '✍️  Write it myself' });
    _segWiz  = _el('button', 's2-seg-btn' + (_state.input_mode === 'wiz'  ? ' is-on' : ''), { textContent: '🧭  Guide me' });
    _segText.type = 'button'; _segWiz.type = 'button';
    _segText.addEventListener('click', () => _setMode('text'));
    _segWiz.addEventListener('click',  () => { if (!_answeredAny()) _state.wizard.idx = 0; _setMode('wiz'); });
    seg.append(_segText, _segWiz);
    section.appendChild(seg);

    // Host the description-capture area (text view OR wizard view)
    _descHost = _el('div', 's2-desc-host');
    section.appendChild(_descHost);
    _renderDesc();

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

  // ── Description-capture area: mode switch + renderers ─────────────────────

  function _setMode(mode) {
    _state.input_mode = mode;
    if (_segText) _segText.classList.toggle('is-on', mode === 'text');
    if (_segWiz)  _segWiz.classList.toggle('is-on', mode === 'wiz');
    _saveState();
    _renderDesc();
  }

  function _renderDesc() {
    if (!_descHost) return;
    _descHost.innerHTML = '';
    _descHost.appendChild(_state.input_mode === 'wiz' ? _buildWizardView() : _buildTextView());
  }

  function _buildTextView() {
    const view = _el('div', '');

    if (_state.wizard.completed && _state.business_case) {
      const note = _el('div', 's2-wiz-builtnote');
      note.innerHTML = '<span>✓ Generated from the guided builder — edit freely below.</span>';
      const editBtn = _el('button', 's2-wiz-reopen', { type: 'button', textContent: 'Reopen builder' });
      editBtn.addEventListener('click', () => { _state.wizard.idx = 0; _setMode('wiz'); });
      note.appendChild(editBtn);
      view.appendChild(note);
    }

    const bcLabel = _el('label', 's2-field-label');
    bcLabel.htmlFor = 's2-business-case';
    bcLabel.textContent = 'Business case description';
    const bcHint = _el('p', 's2-field-hint', {
      textContent: 'Describe the system, its purpose, the users, the data it will process, the technology stack, and how the outputs are used. The more detail you provide, the more accurate the analysis will be. Prefer help? Switch to “Guide me”.'
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
    view.append(bcLabel, bcHint, bcArea);
    return view;
  }

  function _ensureAns(id) {
    if (!_state.wizard.answers[id]) _state.wizard.answers[id] = { sel: [], other: '' };
    return _state.wizard.answers[id];
  }
  function _answered(k) {
    const a = _state.wizard.answers[QUESTIONS[k].id];
    return !!(a && ((a.sel && a.sel.length) || (a.other && a.other.trim())));
  }
  function _answeredAny() { return QUESTIONS.some((_, k) => _answered(k)); }

  function _toggleOpt(q, opt) {
    const a = _ensureAns(q.id);
    if (q.type === 'single') {
      a.sel = a.sel.length === 1 && a.sel[0] === opt ? [] : [opt];
    } else {
      const i = a.sel.indexOf(opt);
      if (i > -1) a.sel.splice(i, 1); else a.sel.push(opt);
      const excl = q.options.filter(_EXCL);
      if (excl.length) {
        if (_EXCL(opt)) a.sel = a.sel.includes(opt) ? [opt] : [];
        else a.sel = a.sel.filter(x => !_EXCL(x));
      }
    }
    _saveState();
  }

  function _buildWizardView() {
    const wrap = _el('div', 's2-wiz');
    const N = QUESTIONS.length;
    const i = Math.max(0, Math.min(_state.wizard.idx, N - 1));
    _state.wizard.idx = i;
    const q = QUESTIONS[i];
    const sys = _qSys();

    // Progress: label + jump dots
    const prog = _el('div', 's2-wiz-prog');
    prog.appendChild(_el('div', 's2-wiz-meta', { textContent: `${q.group} · Question ${i + 1} of ${N}` }));
    const dots = _el('div', 's2-wiz-dots');
    QUESTIONS.forEach((_, k) => {
      const d = _el('span', 's2-wiz-dot' + (k === i ? ' is-active' : '') + (_answered(k) ? ' is-done' : ''));
      d.title = 'Go to question ' + (k + 1);
      d.addEventListener('click', () => { _state.wizard.idx = k; _renderDesc(); });
      dots.appendChild(d);
    });
    prog.appendChild(dots);
    wrap.appendChild(prog);

    // Question + help
    wrap.appendChild(_el('p', 's2-wiz-q', { textContent: q.q.replace('{sys}', sys) }));
    if (q.help) wrap.appendChild(_el('p', 's2-wiz-help', { textContent: q.help }));

    // Options
    const ans = _ensureAns(q.id);
    const opts = _el('div', 's2-wiz-opts');
    q.options.forEach(opt => {
      const on = ans.sel.includes(opt);
      const b = _el('button', 's2-chip' + (on ? ' is-on' : ''), { type: 'button', textContent: opt });
      b.addEventListener('click', () => { _toggleOpt(q, opt); _renderDesc(); });
      opts.appendChild(b);
    });
    wrap.appendChild(opts);

    // Optional free text
    if (q.other) {
      const oi = _el('input', 's2-wiz-other');
      oi.type = 'text';
      oi.placeholder = q.otherPh || 'Other (optional)…';
      oi.value = ans.other || '';
      oi.addEventListener('input', () => { ans.other = oi.value; _saveState(); });
      wrap.appendChild(oi);
    }

    // Nav
    const nav = _el('div', 's2-wiz-nav');
    const back = _el('button', 'wiz-btn-secondary', { type: 'button', textContent: i === 0 ? 'Cancel' : '← Back' });
    back.addEventListener('click', () => {
      if (i === 0) { _setMode('text'); }
      else { _state.wizard.idx = i - 1; _renderDesc(); }
    });
    const spacer = _el('div', ''); spacer.style.flex = '1';
    const skip = _el('button', 's2-wiz-skip', { type: 'button', textContent: 'Skip' });
    skip.addEventListener('click', () => { if (i < N - 1) { _state.wizard.idx = i + 1; _renderDesc(); } else { _finishWizard(); } });
    const next = _el('button', 'wiz-btn-primary', { type: 'button', textContent: i === N - 1 ? 'Build use case' : 'Next →' });
    next.addEventListener('click', () => { if (i < N - 1) { _state.wizard.idx = i + 1; _renderDesc(); } else { _finishWizard(); } });
    nav.append(back, spacer, skip, next);
    wrap.appendChild(nav);

    return wrap;
  }

  function _finishWizard() {
    _state.business_case = _assembleNarrative(_state.wizard.answers);
    _state.wizard.completed = true;
    _saveState();
    _refreshPrompt();
    _setMode('text');
  }

  // ── Ask your AI tool collapsible ──────────────────────────────────────────────────

  function _buildAskAiSection() {
    const section = _el('div', 'wiz-collapsible-section s2-ai-section');

    const header  = _el('div', 'wiz-collapsible-header s2-ai-header');
    const hLeft   = _el('div', 'wiz-collapsible-header-left');
    const title   = _el('p', 'section-label', { style: 'margin-bottom:2px', textContent: 'Ask your AI tool to draft a classification and DPIA' });
    const sub     = _el('p', '', {
      style: 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0',
      textContent: 'Stage 1 prompt — covers Steps 3 (EU AI Act classification) and 4 (DPIA). Paste into your AI tool, save the report, then record the answers in the step wizards.'
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

    const instruct = _el('div', 's2-ai-instructions');
    instruct.innerHTML = `
      <strong>How to use this prompt</strong>
      <ol style="margin:8px 0 0 18px;padding:0;font-size:12px;color:var(--color-text-secondary);line-height:1.9">
        <li>Enter your business case description in the field above — it will be automatically inserted into the prompt.</li>
        <li>Copy the prompt using the button below.</li>
        <li>Paste it into your AI tool and run it.</li>
        <li>Save the report as a PDF alongside this system record.</li>
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
    const template = _detail?.ai_prompt_template || '';
    return template.replace('{{business_case}}', bc);
  }

  // ── Load your AI tool output into Step 3 (Classification) ─────────────────────────

  function _buildLoadClfSection() {
    const section = _el('div', 'wiz-collapsible-section s2-ai-section');
    const header  = _el('div', 'wiz-collapsible-header s2-ai-header');
    const hLeft   = _el('div', 'wiz-collapsible-header-left');
    hLeft.appendChild(_el('p', 'section-label', { style: 'margin-bottom:2px', textContent: 'Load your AI tool output into Step 3 (Classification)' }));
    hLeft.appendChild(_el('p', '', { style: 'font-size:11px;color:var(--color-text-tertiary);margin:0', textContent: 'Loads the tier and gate answers as a draft — review and finalise in Step 3.' }));
    const hRight  = _el('div', 'wiz-collapsible-header-right');
    const chevron = _el('span', 's2-ai-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 'wiz-collapsible-body');
    body.style.display = 'none';
    const ta = _el('textarea', 's2-prompt-area');
    ta.rows = 8; ta.placeholder = 'Paste your AI tool’s full reply (or just its ```json block) here…';
    const btnRow = _el('div', ''); btnRow.style.cssText = 'display:flex;gap:8px;margin:10px 0';
    const checkBtn = _el('button', 'wiz-btn-secondary', { textContent: 'Validate & preview' });
    const applyBtn = _el('button', 'wiz-btn-primary', { textContent: 'Apply to Step 3' });
    applyBtn.style.display = 'none';
    btnRow.append(checkBtn, applyBtn);
    const preview = _el('div', 's2-load-preview'); preview.style.cssText = 'font-size:12.5px;line-height:1.6';

    let _res = null;
    checkBtn.addEventListener('click', () => {
      applyBtn.style.display = 'none'; _res = null;
      const clf = _extractClassification(ta.value);
      if (!clf) { preview.innerHTML = '<span style="color:#fba4a3">Could not find a <code>classification</code> JSON block in the pasted text.</span>'; return; }
      if (!_clfKeys) { preview.innerHTML = '<span style="color:#ecd489">Step 3 definitions still loading — try again in a moment.</span>'; return; }
      _res = _validateClf(clf);
      preview.innerHTML = _renderClfPreview(_res);
      if (_res.matched > 0) applyBtn.style.display = '';
    });
    applyBtn.addEventListener('click', () => {
      if (!_res) return;
      const n = _applyClf(_res.tier, _res.gate, _res.reasoning);
      const rNote = _res.reasoning ? ' Its rationale was loaded into the Assessment rationale box.' : '';
      preview.innerHTML = `<span style="color:#8cebb0">✓ Loaded ${n} classification answer${n !== 1 ? 's' : ''} as a draft.${rNote} Open <strong>Step 3 — System classification</strong>, review the gates, then run the classification to finalise the outcome and articles.</span>`;
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

  function _extractClassification(text) {
    const tryParse = s => { try { return JSON.parse(s); } catch (_) { return null; } };
    const pick = o => (o && o.classification && typeof o.classification === 'object') ? o.classification
                    : (o && typeof o === 'object' && (o.gate_answers || o.tier)) ? o : null;
    for (const f of [...(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1])) {
      const a = pick(tryParse(f.trim())); if (a) return a;
    }
    const objs = (text || '').match(/\{[\s\S]*\}/g) || [];
    objs.sort((a, b) => b.length - a.length);
    for (const c of objs) { const a = pick(tryParse(c)); if (a) return a; }
    return null;
  }

  // yes/no is matched by leading token; other enums (tier, role) by canonical form.
  function _matchYesNo(val) {
    const w = String(val == null ? '' : val).trim().toLowerCase();
    if (/^y(es)?\b/.test(w)) return 'yes';
    if (/^no?\b/.test(w))    return 'no';
    return null;
  }
  function _matchEnumCanon(val, enums) {
    const c = _canon(val); if (!c) return null;
    return enums.find(e => _canon(e) === c)
        || enums.find(e => c.startsWith(_canon(e)))
        || enums.find(e => _canon(e).startsWith(c)) || null;
  }
  function _matchClf(val, enums) {
    return (enums.length === 2 && enums[0] === 'yes') ? _matchYesNo(val) : _matchEnumCanon(val, enums);
  }

  function _validateClf(clf) {
    const warnings = []; const gate = {}; let tier = null; let matched = 0;
    const reasoning = _isEmpty(clf.reasoning) ? '' : String(clf.reasoning).trim();
    if (!_isEmpty(clf.tier)) {
      const t = _matchEnumCanon(clf.tier, _clfKeys.tier);
      if (t) { tier = t; matched++; } else warnings.push(`tier "${_esc(String(clf.tier))}" not recognised — skipped.`);
    }
    const ga = clf.gate_answers || {};
    Object.entries(ga).forEach(([k, v]) => {
      const enums = _clfKeys[k];
      if (!enums) { warnings.push(`Unknown gate answer <code>${_esc(k)}</code> — skipped.`); return; }
      if (_isEmpty(v)) return;
      const m = _matchClf(v, enums);
      if (!m) { warnings.push(`<code>${_esc(k)}</code>: "${_esc(String(v)).slice(0, 40)}" not one of ${enums.join(' / ')} — skipped.`); return; }
      gate[k] = m; matched++;
    });
    return { tier, gate, reasoning, warnings, matched };
  }

  function _renderClfPreview(res) {
    const total = Object.keys(_clfKeys || {}).length;
    let html = `<div style="color:#8cebb0;font-weight:600;margin-bottom:6px">✓ ${res.matched} of ${total} classification answers recognised${res.tier ? ` (tier: ${_esc(res.tier)})` : ''}.</div>`;
    if (res.warnings.length) {
      html += `<div style="color:#ecd489;margin-bottom:4px">${res.warnings.length} item${res.warnings.length !== 1 ? 's' : ''} need attention:</div>`;
      html += '<ul style="margin:0 0 0 16px;padding:0;color:var(--color-text-secondary)">' +
        res.warnings.slice(0, 12).map(w => `<li>${w}</li>`).join('') + '</ul>';
    }
    html += '<div style="color:var(--color-text-tertiary);margin-top:8px">This loads a <strong>draft</strong> — Step 3 still computes the final outcome and articles when you run the classification there. Nothing is written until you click <strong>Apply to Step 3</strong>.</div>';
    return html;
  }

  function _applyClf(tier, gate, reasoning) {
    _record = WizUtils.loadRecord() || {};
    const prev = _record['step-3'] || {};
    const axisA = Object.assign({}, prev.axis_a || {});
    if (tier) axisA.tier = tier;
    const axisB = Object.assign({}, prev.axis_b || {});
    axisB.gate_answers = Object.assign({}, axisB.gate_answers || {}, gate);
    if (gate.G5_Q0) axisB.organisation_role = gate.G5_Q0;
    _record['step-3'] = Object.assign({}, prev, {
      step_id: 'step-3', step_title: 'System classification',
      loaded_from_ai: true, loaded_at: new Date().toISOString(),
      rationale: reasoning || prev.rationale || '',
      axis_a: axisA, axis_b: axisB
    });
    if (!_record._meta) _record._meta = { schema_version: '1.0', created: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    WizUtils.saveRecord(_record);
    return Object.keys(gate).length + (tier ? 1 : 0);
  }

  // ── Load your AI tool output into Step 4 (DPIA) ───────────────────────────────────

  function _buildLoadSection() {
    const section = _el('div', 'wiz-collapsible-section s2-ai-section');
    const header  = _el('div', 'wiz-collapsible-header s2-ai-header');
    const hLeft   = _el('div', 'wiz-collapsible-header-left');
    hLeft.appendChild(_el('p', 'section-label', { style: 'margin-bottom:2px', textContent: 'Load your AI tool output into Step 4 (DPIA)' }));
    hLeft.appendChild(_el('p', '', { style: 'font-size:11px;color:var(--color-text-tertiary);margin:0', textContent: 'Paste your AI tool’s output; the DPIA answers are validated and loaded into Step 4 so you don’t re-key them.' }));
    const hRight  = _el('div', 'wiz-collapsible-header-right');
    const chevron = _el('span', 's2-ai-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 'wiz-collapsible-body');
    body.style.display = 'none';

    const ta = _el('textarea', 's2-prompt-area');
    ta.rows = 8;
    ta.placeholder = 'Paste your AI tool’s full reply (or just its ```json block) here…';

    const btnRow = _el('div', ''); btnRow.style.cssText = 'display:flex;gap:8px;margin:10px 0';
    const checkBtn = _el('button', 'wiz-btn-secondary', { textContent: 'Validate & preview' });
    const applyBtn = _el('button', 'wiz-btn-primary', { textContent: 'Apply to Step 4' });
    applyBtn.style.display = 'none';
    btnRow.append(checkBtn, applyBtn);

    const preview = _el('div', 's2-load-preview'); preview.style.cssText = 'font-size:12.5px;line-height:1.6';

    let _clean = null; let _reasoning = '';
    checkBtn.addEventListener('click', () => {
      applyBtn.style.display = 'none'; _clean = null; _reasoning = '';
      const extracted = _extractDpiaAnswers(ta.value);
      if (!extracted) { preview.innerHTML = '<span style="color:#fba4a3">Could not find a <code>dpia_answers</code> JSON block in the pasted text.</span>'; return; }
      if (!_dpiaFields) { preview.innerHTML = '<span style="color:#ecd489">Step 4 field definitions still loading — try again in a moment.</span>'; return; }
      const { clean, warnings, matched, skipped } = _validateDpia(extracted.answers);
      _clean = clean; _reasoning = extracted.reasoning || '';
      preview.innerHTML = _renderPreview(matched, warnings, skipped);
      if (matched > 0 || _reasoning) applyBtn.style.display = '';
    });
    applyBtn.addEventListener('click', () => {
      if (!_clean) return;
      const n = _applyDpia(_clean, _reasoning);
      const rNote = _reasoning ? ' Its rationale was loaded into the DPIA rationale box.' : '';
      preview.innerHTML = `<span style="color:#8cebb0">✓ Loaded ${n} DPIA field${n !== 1 ? 's' : ''} into Step 4.${rNote} Open <strong>Step 4 — Data identification and DPIA</strong> to review and save.</span>`;
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
    // Returns { answers, reasoning } — reasoning is the sibling of dpia_answers
    // when your AI tool emits { "dpia_answers": {...}, "reasoning": "..." }.
    const pick = o => {
      if (o && o.dpia_answers && typeof o.dpia_answers === 'object') {
        return { answers: o.dpia_answers, reasoning: _isEmpty(o.reasoning) ? '' : String(o.reasoning).trim() };
      }
      if (o && typeof o === 'object' && !Array.isArray(o) && _looksLikeAnswers(o)) {
        return { answers: o, reasoning: '' };
      }
      return null;
    };
    // 1) fenced code blocks
    const fences = [...(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
    for (const f of fences) { const a = pick(tryParse(f.trim())); if (a) return a; }
    // 2) every {...} candidate, largest first
    const objs = (text || '').match(/\{[\s\S]*\}/g) || [];
    objs.sort((a, b) => b.length - a.length);
    for (const c of objs) { const a = pick(tryParse(c)); if (a) return a; }
    return null;
  }
  function _looksLikeAnswers(o) {
    return Object.keys(o).some(k => /_f\d/.test(k));
  }

  // Canonical form for tolerant matching: your AI tool reformats option text (drops the
  // spaces around a "/", swaps "—" for a space, changes case). Strip everything
  // except letters and digits so "Employees / staff" == "Employees/staff" and
  // "Art.6(1)(f) — Legitimate interests" == "Art.6(1)(f) Legitimate interests".
  function _canon(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function _isEmpty(v) { return v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === ''); }

  // Match a single select value to an option: canonical-exact, then containment
  // either way (handles your AI tool truncating or padding the option text).
  function _matchSelect(val, options) {
    if (!options) return String(val == null ? '' : val).trim();
    const c = _canon(val);
    if (!c) return null;
    let hit = options.find(o => _canon(o) === c);
    if (hit) return hit;
    // Prefer the longest option whose canonical form overlaps the value.
    const cands = options.filter(o => { const co = _canon(o); return co && (c.includes(co) || co.includes(c)); });
    cands.sort((a, b) => _canon(b).length - _canon(a).length);
    return cands[0] || null;
  }

  // Tolerant checkbox matching against a canonical "blob" of the whole value,
  // so an array, a comma-joined string, or reformatted option text all resolve.
  function _matchCheckbox(val, options) {
    const elements = Array.isArray(val) ? val : (val == null ? [] : [val]);
    if (!options) return elements.map(e => String(e));
    const blob = _canon(elements.join(' '));
    return options.filter(o => { const co = _canon(o); return co && blob.includes(co); });
  }

  // Evaluate a field's conditional_show_if against the answer set — mirrors the
  // Step 4 wizard's own conditional logic.
  function _condMet(key, a) {
    if (key === 's5_f1_is_automated') return /^\s*(partially|yes)/i.test(String(a.s5_f1 || ''));
    if (key === 's4_f1_is_LIA')       return _canon(a.s4_f1).includes('legitimateinterests');
    if (key === 's3_f1_not_none') {
      const v = a.s3_f1; const arr = Array.isArray(v) ? v : (v ? [v] : []);
      return arr.some(x => !_canon(x).includes('nospecialcategory'));
    }
    return true; // unknown condition — don't filter
  }

  function _validateDpia(answers) {
    const clean = {}; const warnings = []; let matched = 0; let skipped = 0;
    Object.entries(answers).forEach(([id, val]) => {
      const f = _dpiaFields[id];
      if (!f) { warnings.push(`Unknown field <code>${_esc(id)}</code> — skipped.`); return; }
      // Conditional field whose show-condition isn't met is not shown in Step 4,
      // so ignore whatever your AI tool put here — it often slides a neighbouring answer
      // into the hidden slot (e.g. explainability into s5_f2 when not automated).
      if (f.condition && !_condMet(f.condition, answers)) { if (!_isEmpty(val)) skipped++; return; }
      if (_isEmpty(val)) { return; } // your AI tool left it blank — skip quietly, no warning
      if (f.type === 'checkbox_group') {
        const ok = _matchCheckbox(val, f.options);
        if (ok.length === 0) { warnings.push(`<code>${_esc(id)}</code>: couldn’t match "${_esc(String(val)).slice(0, 60)}" to any option — skipped.`); return; }
        clean[id] = ok; matched++;
      } else if (f.type === 'select') {
        const m = _matchSelect(val, f.options);
        if (f.options && !m) { warnings.push(`<code>${_esc(id)}</code>: "${_esc(String(val)).slice(0, 60)}" doesn’t match an option — skipped.`); return; }
        clean[id] = m; matched++;
      } else {
        clean[id] = String(val); matched++;
      }
    });
    return { clean, warnings, matched, skipped };
  }

  function _renderPreview(matched, warnings, skipped) {
    const total = Object.keys(_dpiaFields || {}).length;
    let html = `<div style="color:#8cebb0;font-weight:600;margin-bottom:6px">✓ ${matched} of ${total} DPIA fields recognised.</div>`;
    if (skipped) {
      html += `<div style="color:var(--color-text-tertiary);margin-bottom:6px">${skipped} conditional field${skipped !== 1 ? 's' : ''} not applicable to this system — skipped.</div>`;
    }
    if (warnings.length) {
      html += `<div style="color:#ecd489;margin-bottom:4px">${warnings.length} item${warnings.length !== 1 ? 's' : ''} need attention:</div>`;
      html += '<ul style="margin:0 0 0 16px;padding:0;color:var(--color-text-secondary)">' +
        warnings.slice(0, 12).map(w => `<li>${w}</li>`).join('') +
        (warnings.length > 12 ? `<li>…and ${warnings.length - 12} more</li>` : '') + '</ul>';
    }
    html += '<div style="color:var(--color-text-tertiary);margin-top:8px">Review above, then apply. Nothing is written until you click <strong>Apply to Step 4</strong>.</div>';
    return html;
  }

  function _applyDpia(clean, reasoning) {
    _record = WizUtils.loadRecord() || {};
    const prev = _record['step-4'] || {};
    const answers = Object.assign({}, prev.answers || {}, clean);
    _record['step-4'] = Object.assign({}, prev, {
      step_id: 'step-4',
      step_title: 'Data identification and DPIA',
      loaded_from_ai: true,
      loaded_at: new Date().toISOString(),
      rationale: reasoning || prev.rationale || '',
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
      input_mode:        _state.input_mode,
      use_case_wizard:   _state.wizard,
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

      /* Ask your AI tool collapsible */
      .s2-ai-section { margin-top:24px;margin-bottom:24px; }
      .s2-ai-header { background:var(--teal-50,rgba(93,202,165,0.10)) !important; }
      .s2-ai-header:hover { background:var(--teal-100,rgba(93,202,165,0.16)) !important; }
      .s2-ai-instructions { font-size:12px;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius-sm,4px);padding:12px 14px;margin-bottom:14px;line-height:1.6; }
      .s2-prompt-wrap { display:flex;flex-direction:column;gap:8px; }
      .s2-copy-btn { align-self:flex-start; }
      .s2-prompt-area { width:100%;padding:12px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:11px;font-family:var(--font-mono,monospace);color:var(--color-text-secondary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.6; }

      /* Business-case mode toggle */
      .s2-seg { display:inline-flex;gap:2px;padding:3px;background:var(--color-bg);border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);margin-bottom:14px; }
      .s2-seg-btn { appearance:none;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:500;color:var(--color-text-secondary);padding:6px 14px;border-radius:var(--radius-sm,4px);transition:background .12s,color .12s; }
      .s2-seg-btn:hover { color:var(--color-text-primary); }
      .s2-seg-btn.is-on { background:var(--color-surface);color:var(--color-text-primary);box-shadow:0 1px 2px rgba(0,0,0,0.12); }
      .s2-desc-host { min-height:40px; }
      .s2-wiz-builtnote { display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--color-text-secondary);background:var(--teal-50,rgba(93,202,165,0.10));border:1px solid var(--teal-100,rgba(93,202,165,0.30));border-radius:var(--radius-md,6px);padding:8px 12px;margin-bottom:10px; }
      .s2-wiz-reopen { appearance:none;border:1px solid var(--color-border-mid);background:var(--color-surface);cursor:pointer;font-family:inherit;font-size:11.5px;color:var(--color-text-secondary);padding:3px 10px;border-radius:var(--radius-sm,4px); }
      .s2-wiz-reopen:hover { color:var(--color-text-primary);border-color:var(--teal-400,#2dd4bf); }

      /* Use-case builder wizard */
      .s2-wiz { border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);padding:18px;background:var(--color-surface); }
      .s2-wiz-prog { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap; }
      .s2-wiz-meta { font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--color-text-tertiary); }
      .s2-wiz-dots { display:flex;gap:6px; }
      .s2-wiz-dot { width:9px;height:9px;border-radius:50%;background:var(--color-border-mid);cursor:pointer;transition:background .12s,transform .12s; }
      .s2-wiz-dot:hover { transform:scale(1.25); }
      .s2-wiz-dot.is-done { background:var(--teal-400,#5dcaa5); }
      .s2-wiz-dot.is-active { background:var(--color-text-secondary);box-shadow:0 0 0 3px var(--teal-100,rgba(93,202,165,0.20)); }
      .s2-wiz-q { font-size:15px;font-weight:600;color:var(--color-text-primary);margin:0 0 4px;line-height:1.4; }
      .s2-wiz-help { font-size:11.5px;color:var(--color-text-tertiary);margin:0 0 14px; }
      .s2-wiz-opts { display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px; }
      .s2-chip { appearance:none;cursor:pointer;font-family:inherit;font-size:12.5px;color:var(--color-text-primary);background:var(--color-bg);border:1px solid var(--color-border-mid);border-radius:20px;padding:7px 14px;transition:background .12s,border-color .12s,color .12s; }
      .s2-chip:hover { border-color:var(--teal-400,#2dd4bf); }
      .s2-chip.is-on { background:var(--teal-400,#5dcaa5);border-color:var(--teal-400,#5dcaa5);color:#08251c;font-weight:500; }
      .s2-wiz-other { display:block;width:100%;padding:8px 10px;border:1px solid var(--color-border-mid);border-radius:var(--radius-md,6px);font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-bg);box-sizing:border-box;margin-bottom:12px; }
      .s2-wiz-other:focus { outline:none;border-color:var(--teal-400,#2dd4bf);box-shadow:0 0 0 2px var(--teal-100,rgba(93,202,165,0.16)); }
      .s2-wiz-nav { display:flex;align-items:center;gap:8px;margin-top:6px; }
      .s2-wiz-skip { appearance:none;border:none;background:transparent;cursor:pointer;font-family:inherit;font-size:12px;color:var(--color-text-tertiary);padding:6px 8px;text-decoration:underline; }
      .s2-wiz-skip:hover { color:var(--color-text-secondary); }

    `);
  }

})();
