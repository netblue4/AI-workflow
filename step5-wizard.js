/* Step 5 — Risk Assessment Wizard (Guided)
   Data sources: tbl_Risks.json, tbl_Risk_Controls.json
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
  let _controlsByRisk = new Map(); // pk_Risk_ID → [control, ...]
  let _riskIdByName   = new Map(); // risk_name → pk_Risk_ID
  let _showExcluded   = false;     // Wave 1: hide risks marked Not applicable behind a toggle
  let _showRecommended = false;    // Priority tiers: recommended/technical group collapsed by default
  let _showRequired    = true;     // Required group — collapsible, expanded by default
  let _showExcludedGrp = true;     // Excluded group — expanded by default so exclusions get oversight
  let _exclusionsApproved = false; // human sign-off that the excluded risks were reviewed
  const _recChecked = new Set();    // keys of Recommended risks ticked for bulk "not applicable"
  let _savedNoteEl    = null;      // Wave 2: live "Saved ✓" indicator in the risk header
  let _riskheadSummaryEl = null;   // Wave 2: risk-count summary, updated in place on autosave
  let _uiOpen = {};                // per-panel open state, preserved across in-step re-renders

  // Shared gold StepDIV whose open/closed state survives a _renderConsolidated().
  function _makePanel(key, title, description, status, statusKind, body) {
    const p = WizUtils.buildStepPanel({ title, description, status, statusKind, body, open: _uiOpen[key] === true });
    p.header.addEventListener('click', () => { _uiOpen[key] = p.el.classList.contains('is-open'); });
    return p.el;
  }

  const _state = {
    legal_risks: {}, // riskName → boolean (EU AI Act risks from guidance)
    group_standard_risks: {}, // pk_Risk_ID → boolean (Internal Standard risks, assessor-marked)
    nist_risks: {}, // riskName → boolean (NIST AI RMF-sourced risks, assessor-marked)
  };

  // Legal assessment state
  const _wizState = {
    answers:    {}, // riskName → 'yes'|'partially'|'no'
    rationales: {}, // riskName → string
    challenges: {}, // riskName → string (assessor's objection, drives the re-assessment cycle)
    reqs:       {}, // riskName → { HS ref → bool } (Step B: which requirements to implement)
    reqReasons: {}, // riskName → { HS ref → string } (why an unselected requirement is Not Applicable)
  };
  let _hsByRef = new Map(); // standard_ref → HS record (name, text, subcategory)

  // Category color palette — populated from step5-legal-risk-guidance.json after load
  const _FALLBACK_COLOR = { bg: '#262219', text: '#cfc7b2' };
  const _catColor = key => (_legalGuidance?.color_palette?.[key] || _FALLBACK_COLOR);

  // The retired bulk-not-applicable stock phrases — treated as "no justification".
  function _isBoilerplateRationale(txt) {
    const t = (txt || '').trim();
    return /^Not applicable\s*[—–-]\s*outside the scope of this use case\.?$/i.test(t)
        || /^Not applicable to this use case\.?$/i.test(t);
  }

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
    _controlsByRisk  = new Map();
    _state.legal_risks    = {};
    _state.nist_risks     = {};
    _wizState.answers     = {};
    _wizState.rationales  = {};
    _wizState.challenges  = {};
    _wizState.reqs        = {};
    _wizState.reqReasons  = {};
    _hsByRef = new Map();
    _exclusionsApproved = false;
    _recChecked.clear();
    _uiOpen = {};

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(WizUtils.buildStepHeader(step, colorKey, phaseTitle));
    // Wave 1: the five source tabs are consolidated into one risk list (below).
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _loadData(pw);
  };

  // ---- Data loading -------------------------------------------
  async function _loadData(pw) {
    const [risks, controls, guidance, detail, hs] = await WizUtils.fetchAll([
      'tbl_Risks.json',
      'tbl_Risk_Controls.json',
      'step5-legal-risk-guidance.json',
      'step-5.json',
      'tbl_Harmonised_Standards.json',
    ]);

    if (!risks) {
      pw.innerHTML = `<p style="padding:24px;color:var(--danger-600,#ec6a68)">Could not load tbl_Risks.json</p>`;
      return;
    }
    _tblRisks = risks;
    _riskIdByName = new Map((risks || []).map(r => [r.risk_name, r.pk_Risk_ID]));
    _hsByRef = new Map((hs || []).map(h => [h.standard_ref, h]));

    if (controls) {
      _tblControls = controls;
      _controlsByRisk = new Map();
      _tblControls.forEach(c => {
        if (!_controlsByRisk.has(c.fk_Risk_ID)) _controlsByRisk.set(c.fk_Risk_ID, []);
        _controlsByRisk.get(c.fk_Risk_ID).push(c);
      });
    }

    _legalGuidance = guidance;
    _detail        = detail;

    _record = WizUtils.loadRecord();

    _step3Data = _record?.['step-3'] ?? null;
    _step7Data = _record?.['step-4'] ?? null;

    // Restore prior wizard answers
    const saved8 = _record?.['step-5'];
    if (saved8?.legal_assessment?.risks) {
      saved8.legal_assessment.risks.forEach(r => {
        if (r.risk_source === 'NIST_RMF') _state.nist_risks[r.risk_name] = r.selected;
        else _state.legal_risks[r.risk_name] = r.selected;
      });
    }
    if (saved8?.legal_assessment?.wizard_answers) {
      Object.assign(_wizState.answers, saved8.legal_assessment.wizard_answers);
    }
    if (saved8?.legal_assessment?.wizard_rationales) {
      Object.assign(_wizState.rationales, saved8.legal_assessment.wizard_rationales);
    }
    if (saved8?.legal_assessment?.wizard_challenges) {
      Object.assign(_wizState.challenges, saved8.legal_assessment.wizard_challenges);
    }
    // Restore per-requirement selection. New records carry wizard_req_selections;
    // older ones are migrated from each risk's selected_refs (the old area→refs
    // expansion), so nothing is lost when the flow changed to requirement-level.
    if (saved8?.legal_assessment?.wizard_req_reasons) {
      Object.assign(_wizState.reqReasons, saved8.legal_assessment.wizard_req_reasons);
    }
    if (saved8?.legal_assessment?.wizard_req_selections) {
      Object.assign(_wizState.reqs, saved8.legal_assessment.wizard_req_selections);
    } else if (saved8?.legal_assessment?.risks) {
      saved8.legal_assessment.risks.forEach(r => {
        if (Array.isArray(r.selected_refs) && r.selected_refs.length) {
          _wizState.reqs[r.risk_name] = {};
          r.selected_refs.forEach(ref => { _wizState.reqs[r.risk_name][ref] = true; });
        }
      });
    }
    if (saved8?.group_standard_assessment?.risks) {
      saved8.group_standard_assessment.risks.forEach(r => {
        _state.group_standard_risks[r.risk_id] = r.selected;
      });
    }
    _exclusionsApproved = !!saved8?.legal_assessment?.exclusions_approved;

    // One-time cleanup: purge the retired bulk "not applicable" boilerplate so it
    // no longer appears as a justification in Step 5, the compiled challenge prompt
    // baseline, or the conformity report. New assessments never produce this text.
    let _purgedBoilerplate = false;
    Object.keys(_wizState.rationales).forEach(k => {
      if (_isBoilerplateRationale(_wizState.rationales[k])) { delete _wizState.rationales[k]; _purgedBoilerplate = true; }
    });
    if (_purgedBoilerplate) { try { _writeRisksRecord(); } catch (_) {} }

    _filteredFGItems = _buildFGItems();

    // Default: select all legal risks if no prior legal state. Risks start
    // Unanswered like every other risk — no Step 3 pre-answering.
    if (Object.keys(_state.legal_risks).length === 0) {
      _filteredFGItems.forEach(fg =>
        fg.risks.forEach(r => { _state.legal_risks[r.jkName] = true; })
      );
    }

    // NIST AI RMF risks default to applicable (they are cross-cutting) unless the
    // assessor has previously marked them; the assessor reviews them in their own tab.
    if (Object.keys(_state.nist_risks).length === 0) {
      (_tblRisks || []).filter(r => r.risk_source === 'NIST_RMF')
        .forEach(r => { _state.nist_risks[r.risk_name] = true; });
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

    for (const risk of _tblRisks) {
      if (risk.risk_source === 'NIST_RMF') continue; // shown in their own NIST tab
      const controls = _controlsByRisk.get(risk.pk_Risk_ID) || [];

      // Apply the Step-3 RCN applicability filter using the risk's own HS link
      // (risk↔HS), so risk inclusion no longer depends on the risk controls.
      const riskRefs = (risk.fk_Harmonised_Standard_IDs || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (applicable && !riskRefs.some(r => applicable.has(r))) continue;

      // Attack vectors are still drawn from whatever controls the risk carries.
      const matchedControls = applicable
        ? controls.filter(ctrl => {
            const rcns = (ctrl.fk_Harmonised_Standard_IDs || '')
              .split(',').map(s => s.trim()).filter(Boolean);
            return rcns.some(r => applicable.has(r));
          })
        : controls;

      const articleName = WizUtils.ARTICLES_BY_ID.get(risk.fk_AI_Article_ID)?.article_name
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

  // Returns the article record for a legal risk by name
  function _getArticleForRisk(riskName) {
    const risk = _tblRisks.find(r => r.risk_name === riskName);
    if (!risk) return null;
    return WizUtils.ARTICLES_BY_ID.get(risk.fk_AI_Article_ID) || null;
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
      ['legal', 'Legal/Regulatory Risks'],
      ['nist', 'NIST AI RMF Risks'],
      ['dpia', 'DPIA Risks'],
      ['groupstd', 'Internal Standards Risks'],
      ['review', 'Review']
    ], _switchTab);
  }

  // Expose the risk-catalogue reference/methodology for the About the framework
  // training area. Self-loads its data so it works outside a step mount.
  window.buildStep5Reference = async function () {
    _injectStyles();
    if (!_legalGuidance || !(_tblRisks && _tblRisks.length)) {
      const [risks, , guidance] = await WizUtils.fetchAll([
        'tbl_Risks.json', 'tbl_Risk_Controls.json', 'step5-legal-risk-guidance.json',
      ]);
      _tblRisks = risks || [];
      _legalGuidance = guidance || _legalGuidance;
    }
    return _buildReferencePane();
  };

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
    if (id === 'groupstd') {
      const pane = _container.querySelector('[data-pane="groupstd"]');
      if (pane) { pane.innerHTML = ''; pane.appendChild(_buildGroupStandardsPane()); }
    }
    if (id === 'nist') {
      const pane = _container.querySelector('[data-pane="nist"]');
      if (pane) { pane.innerHTML = ''; pane.appendChild(_buildNistPane()); }
    }
    if (id === 'dpia') {
      const pane = _container.querySelector('[data-pane="dpia"]');
      if (pane) { pane.innerHTML = ''; pane.appendChild(_buildDpiaRisksPane()); }
    }
  }

  // ── Ask your AI tool collapsible (Stage 2) ────────────────────────────────────────

  function _buildAskAiCollapsible() {
    const section = _el('div', 's5-ai-section');

    const header = _el('div', 's5-ai-header');
    const hLeft  = _el('div', 's5-ai-header-left');
    const title  = _sectionLabel('Ask your AI tool to draft a risk assessment and control identification');
    title.style.marginBottom = '2px';
    const sub = _el('p', '');
    sub.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0';
    sub.textContent = 'Stage 2 prompt — covers Steps 5 (Risk Assessment) and 6 (Control Identification). Your Step 2 business case, Step 3 classification and Step 4 DPIA are filled in automatically.';
    hLeft.append(title, sub);
    const hRight  = _el('div', 's5-ai-header-right');
    const chevron = _el('span', 's5-ai-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 's5-ai-body');
    body.style.display = 'none';

    const instruct = _el('div', 's5-ai-instructions');
    instruct.innerHTML = `
      <strong>How to use this prompt</strong>
      <ol style="margin:8px 0 0 18px;padding:0;font-size:12px;color:var(--color-text-secondary);line-height:1.9">
        <li>Complete the Step 2, Step 3 and Step 4 wizards first — the business case, classification and DPIA are inserted into the prompt automatically.</li>
        <li>Copy the prompt below and paste it into your AI tool — no need to paste the business case or Stage 1 report separately.</li>
        <li>Run it, then save the risk assessment report as a PDF alongside this system record.</li>
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
    let prompt = _detail?.ai_prompt || '';
    const ctx = _buildStage1Context();
    if (ctx) {
      prompt = prompt
        .replace('CONTEXT — paste the full Stage 1 report (classification and DPIA) below this line, then run the prompt:',
                 'CONTEXT — the Step 2 business case, Step 3 classification and Step 4 DPIA below are filled in automatically from this system record. Use the business case as background scenario context; treat the classification and DPIA as authoritative:')
        .replace('[PASTE STAGE 1 REPORT HERE]', ctx);
    }
    return prompt;
  }

  // Build a readable classification + DPIA summary from the saved Step 3 / Step 4
  // records, so the assessor no longer has to paste the Stage 1 report by hand.
  // Returns '' when neither step is complete (prompt keeps its manual-paste slot).
  function _buildStage1Context() {
    const s2 = _record?.['step-2'];
    const s3 = _record?.['step-3'];
    const s4 = _record?.['step-4'];
    if (!s2 && !s3 && !s4) return '';
    const list = a => (Array.isArray(a) && a.length) ? a.join(', ') : '—';
    const yn   = v => v ? 'yes' : 'no';
    const lines = [];

    // Business case first — it describes what the system actually does and how it
    // is used (the scenario detail risk/attack-vector reasoning needs). It is raw
    // and unreviewed, so it is framed as background; the classification and DPIA
    // below remain the authoritative inputs.
    const bc = (s2?.business_case || '').trim();
    if (bc) {
      lines.push('=== BUSINESS CASE (Step 2) — background scenario context ===',
        'Use this to understand what the AI system does and how it is deployed. It is supporting context only; the classification and DPIA below are the authoritative, reviewed inputs.',
        bc);
      const url = (s2?.business_case_url || '').trim();
      if (url) lines.push('Reference: ' + url);
      lines.push('');
    }

    if (s3) {
      const b  = s3.axis_b || {};
      const co = s3.combined_outcome || {};
      const arts = (b.applicable_articles || []).map(a => a.article_number || a).filter(Boolean);
      lines.push('=== SYSTEM CLASSIFICATION (Step 3) ===',
        'Tier: ' + (s3.axis_a?.tier_label || '—'),
        'EU AI Act outcome: ' + (b.ai_act_outcome || '—'),
        'Organisation role: ' + (b.organisation_role || '—'),
        'Applicable EU AI Act articles: ' + (arts.length ? arts.join(', ') : 'none'),
        'Transparency obligations apply: ' + yn(b.transparency_obligations_apply),
        'Human oversight (Article 14) required: ' + yn(co.article_14_human_oversight),
        'Requires conformity assessment: ' + yn(co.requires_conformity_assessment),
        '');
    } else {
      lines.push('=== SYSTEM CLASSIFICATION (Step 3) — not yet completed ===', '');
    }

    if (s4) {
      const d = s4.data_types_identified || {};
      lines.push('=== DPIA (Step 4) ===',
        'Data subjects: ' + list(d.data_subjects),
        'Standard personal data: ' + list(d.standard_personal_data),
        'Special category data: ' + ((d.special_category_data && d.special_category_data.length) ? d.special_category_data.join(', ') : 'none'),
        'Automated decision-making: ' + (d.automated_decision_making || '—'),
        'Lawful basis: ' + (s4.lawful_basis || '—'),
        'Security measures: ' + list(d.security_measures),
        'Privacy risks identified: ' + list(d.privacy_risks),
        'Inherent risk rating: ' + (s4.inherent_risk_rating || '—'),
        'Residual risk rating: ' + (s4.residual_risk_rating || '—'),
        'DPO consulted: ' + (s4.dpo_consulted || '—'));
    } else {
      lines.push('=== DPIA (Step 4) — not yet completed ===');
    }

    return lines.join('\n');
  }

  // ---- Panes (Wave 1: one consolidated risk list) -------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const pane = _el('div', 'wiz-pane'); pane.dataset.pane = 'all';
    pane.appendChild(_buildConsolidatedCard());
    pw.appendChild(pane);
    if (WizUtils.glossify) { try { WizUtils.glossify(pane); } catch (_) {} }
  }

  function _renderConsolidated() {
    const pw = _container?.querySelector('.wiz-pane-wrap');
    if (pw) _renderPanes(pw);
  }

  // One card: AI interaction at the top, then a single list of every risk
  // (Legal, NIST, Internal Standards, and DPIA privacy risks) with a source
  // chip on each — no tabs.
  function _buildConsolidatedCard() {
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('p', 'wiz-panel-lead', {
      textContent: 'Risks are split by priority. The Required set is derived from your Step 3 classification and Step 4 DPIA — these must be treated for compliance. Everything else is recommended: treat what matters for your system.'
    }));

    // ── AI support — one panel for the ask / load / challenge sections ──
    const aiBody = _el('div', '');
    aiBody.appendChild(_buildAskAiCollapsible());
    aiBody.appendChild(_buildLoadRaSection());
    aiBody.appendChild(_buildChallengeCompileSection());
    card.appendChild(_makePanel('ai', 'AI support',
      'Optional. Draft the risk assessment with your AI tool, load its reply, or compile a challenge prompt to justify what you exclude.',
      'Optional', 'muted', aiBody));

    const { mandatory, recommended, excluded, mandN, recN, exclN, step3Done } = _buildConsolidatedList();

    // ── Required (mandatory) ──
    if (mandN) {
      card.appendChild(_makePanel('req', 'Required for compliance',
        'Mapped to the EU AI Act articles your Step 3 classification found apply, plus your DPIA privacy risks. These must be treated.',
        String(mandN), 'progress', mandatory));
    } else if (step3Done) {
      card.appendChild(_el('div', 's5-empty-note', { textContent: 'Your classification did not trigger any risk-bearing articles, and the DPIA recorded no privacy risks — so there is no mandatory set. Review the recommended risks below.' }));
    } else {
      const note = _el('div', 'wiz8-info');
      note.style.cssText = 'margin:6px 0 12px;padding:10px 14px;border-radius:6px';
      note.innerHTML = '<strong>Complete Step 3 (System classification) to see which risks are mandatory.</strong> Until then every risk is shown as recommended.';
      card.appendChild(note);
    }

    // ── Recommended (optional) ──
    const recBody = _el('div', '');
    if (recN) recBody.appendChild(_buildRecBulkBar());
    recBody.appendChild(recommended);
    card.appendChild(_makePanel('rec', 'Recommended / technical (optional)',
      'Good-practice and NIST-surfaced risks beyond the mandatory set. Treat the ones that matter — or tick and bulk-dismiss the rest.',
      String(recN), recN ? 'info' : 'muted', recBody));

    // ── Excluded — risks marked Not applicable; needs explicit oversight ──
    if (exclN) {
      const exBody = _el('div', '');
      exBody.appendChild(_buildExclusionApprovalBar(exclN));
      exBody.appendChild(excluded);
      card.appendChild(_makePanel('excl', 'Excluded — needs review',
        'Risks marked Not applicable. Review each exclusion and its justification, then approve — this is the human-oversight record for what was left out.',
        String(exclN), _exclusionsApproved ? 'done' : 'progress', exBody));
    }

    // Bottom actions
    const actRow = _el('div', 'wiz-action-row');
    const clearBtn = _el('button', 'wiz-btn-secondary', { textContent: '↺ Clear legal answers' });
    clearBtn.addEventListener('click', () => { _wizState.answers = {}; _wizState.rationales = {}; _autosave(); _renderConsolidated(); });
    actRow.append(clearBtn);
    card.appendChild(actRow);

    // Save → shows the exact "Risk Identification" section from the conformity
    // report as a "Risk Result" summary (what will be submitted).
    const saveBlock = WizUtils.buildSaveBlock({
      label: 'Save',
      onSave: () => {
        _writeRisksRecord();
        if (typeof _ucShowStatus === 'function') _ucShowStatus('Risk identification saved ✓');
        return window.ReportSections.frame('risk', WizUtils.loadRecord())
          .then(f => ({ title: 'Risk Result', el: f }));
      }
    });
    card.appendChild(saveBlock.el);

    // Classification + DPIA inputs this list is derived from.
    const inBody = _el('div', '');
    inBody.appendChild(_buildStep3Card());
    inBody.appendChild(_buildDpiaCard());
    card.appendChild(_makePanel('inputs', 'Classification & DPIA inputs',
      'The Step 3 classification and Step 4 DPIA this risk list is derived from.',
      '', '', inBody));
    return card;
  }

  // Priority group header. cls 'req' | 'rec'; collapsible adds a chevron.
  function _groupHeader(cls, title, count, subtitle, collapsible) {
    const h = _el('div', 's5-group-hdr s5-group-hdr--' + cls + (collapsible ? ' s5-group-hdr--btn' : ''));
    const main = _el('div', 's5-group-main');
    const t = _el('div', 's5-group-title');
    t.innerHTML = `${title} <span class="s5-group-count">${count}</span>`;
    main.appendChild(t);
    if (subtitle) main.appendChild(_el('p', 's5-group-sub', { textContent: subtitle }));
    h.appendChild(main);
    if (collapsible) {
      const chev = _el('span', 's5-group-chev');
      chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      h.appendChild(chev);
    }
    return h;
  }

  // Small coloured chip identifying a risk's source, dropped into the card header.
  function _addSourceChip(section, label, cls) {
    const right = section.querySelector('.wiz-collapsible-header-right');
    if (!right) return;
    right.prepend(_el('span', 's5-src-chip s5-src-chip--' + cls, { textContent: label }));
  }
  function _addRequiredBadge(section) {
    const right = section.querySelector('.wiz-collapsible-header-right');
    const chip = _el('span', 's5-req-badge', { textContent: 'Required' });
    if (right) right.prepend(chip); else section.prepend(chip);
  }
  // Tick-box on a Recommended risk for the bulk "not applicable" action.
  function _addRecCheckbox(section, key) {
    const left = section.querySelector('.wiz-collapsible-header-left');
    if (!left) return;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 's5-rec-check';
    cb.dataset.key = key;
    cb.checked = _recChecked.has(key);
    cb.title = 'Select for bulk “not applicable”';
    cb.addEventListener('click', e => {
      e.stopPropagation(); // don't toggle the collapsible
      if (cb.checked) _recChecked.add(key); else _recChecked.delete(key);
    });
    left.prepend(cb);
  }
  function _selectAllRecommended(check) {
    const pane = _container.querySelector('[data-pane="all"]');
    if (!pane) return;
    pane.querySelectorAll('.s5-rec-check').forEach(cb => {
      cb.checked = check;
      if (check) _recChecked.add(cb.dataset.key); else _recChecked.delete(cb.dataset.key);
    });
  }
  // Mark the ticked recommended risks as Not applicable. The justification is
  // left untouched — the assessor writes a proper reason per risk (or lets the
  // challenge cycle produce one), rather than stamping a generic phrase.
  function _bulkMarkRecNotApplicable() {
    if (!_recChecked.size) return;
    _recChecked.forEach(key => {
      const idx = key.indexOf('::');
      const type = key.slice(0, idx), id = key.slice(idx + 2);
      if (type === 'legal') { _wizState.answers[id] = 'no'; }
      else if (type === 'nist') { _state.nist_risks[id] = false; }
      else if (type === 'internal') { _state.group_standard_risks[id] = false; }
    });
    _recChecked.clear();
    _autosave();
    _renderConsolidated();
  }
  // Human-oversight sign-off for the excluded risks: an explicit approval that
  // the assessor reviewed the exclusions. Persisted in the Step 5 record.
  function _buildExclusionApprovalBar(exclN) {
    const bar = _el('div', 's5-excl-approve' + (_exclusionsApproved ? ' is-approved' : ''));
    const row = _el('label', 's5-excl-approve-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 's5-excl-approve-cb'; cb.checked = _exclusionsApproved;
    const txt = _el('span', 's5-excl-approve-txt', {
      textContent: `I have reviewed all ${exclN} excluded risk${exclN !== 1 ? 's' : ''} and their justifications, and approve leaving them out of scope.`
    });
    cb.addEventListener('change', () => {
      _exclusionsApproved = cb.checked;
      bar.classList.toggle('is-approved', cb.checked);
      status.textContent = cb.checked ? '✓ Exclusions approved' : '⚠ Exclusions not yet approved';
      status.className = 's5-excl-approve-status ' + (cb.checked ? 'is-ok' : 'is-warn');
      _autosave();
    });
    row.append(cb, txt);
    const status = _el('span', 's5-excl-approve-status ' + (_exclusionsApproved ? 'is-ok' : 'is-warn'), {
      textContent: _exclusionsApproved ? '✓ Exclusions approved' : '⚠ Exclusions not yet approved'
    });
    bar.append(row, status);
    return bar;
  }
  function _buildRecBulkBar() {
    const bar = _el('div', 's5-recbulk');
    const sel = _el('div', 's5-recbulk-sel');
    const selAll = _el('button', 's5-recbulk-link', { type: 'button', textContent: 'Select all' });
    selAll.addEventListener('click', () => _selectAllRecommended(true));
    const clr = _el('button', 's5-recbulk-link', { type: 'button', textContent: 'Clear' });
    clr.addEventListener('click', () => _selectAllRecommended(false));
    sel.append(selAll, _el('span', '', { textContent: '·', style: 'color:var(--color-text-tertiary)' }), clr);
    const btn = _el('button', 'wiz-btn-secondary', { type: 'button', textContent: 'Mark selected as Not applicable' });
    btn.addEventListener('click', () => _bulkMarkRecNotApplicable());
    bar.append(sel, btn);
    return bar;
  }

  // Split risks into Required (mandatory) and Recommended (optional). Mandatory =
  // legal risks whose article Step 3 marked applicable, plus DPIA privacy risks.
  function _buildConsolidatedList() {
    const mandatory = _el('div', 's5-consol-list');
    const recommended = _el('div', 's5-consol-list');
    const excluded = _el('div', 's5-consol-list');
    let mandN = 0, recN = 0, exclN = 0;
    const step3Done = !!_step3Data?.axis_b?.applicable_articles?.length;

    // Legal / Regulatory. Pre-select required (article-triggered) risks BEFORE
    // building, so their badge shows "Yes" rather than "Unanswered".
    const wqs = _legalGuidance?.wizard_questions || [];
    wqs.forEach(wq => {
      if (_isArticleApplicable(wq.risk_name) === true && _wizState.answers[wq.risk_name] === undefined) {
        _wizState.answers[wq.risk_name] = 'yes';
      }
    });
    const legalSecs = [...(_buildRiskList(wqs).children)];
    legalSecs.forEach((sec, i) => {
      const name = wqs[i]?.risk_name;
      _addSourceChip(sec, 'Legal', 'legal');
      const artApplicable = _isArticleApplicable(name) === true;
      // Excluded (marked Not applicable) → its own oversight group, regardless of tier.
      if (_wizState.answers[name] === 'no') {
        if (artApplicable) _addRequiredBadge(sec); // flag: excluding a mandated risk
        excluded.appendChild(sec); exclN++;
      } else if (artApplicable) {
        _addRequiredBadge(sec);
        mandatory.appendChild(sec); mandN++;
      } else {
        _addRecCheckbox(sec, 'legal::' + name);
        recommended.appendChild(sec); recN++;
      }
    });

    // DPIA privacy risks → required (identified facts from Step 4)
    const privacy = _record?.['step-4']?.data_types_identified?.privacy_risks || [];
    privacy.forEach(txt => {
      const el = _el('div', 's5-dpia-risk');
      el.append(_el('span', 's5-req-badge', { textContent: 'Required' }),
                _el('span', 's5-src-chip s5-src-chip--privacy', { textContent: 'Privacy' }),
                _el('span', 's5-dpia-risk-txt', { textContent: txt }));
      mandatory.appendChild(el); mandN++;
    });

    return { mandatory, recommended, excluded, mandN, recN, exclN, step3Done };
  }

  function _buildInputsCollapsible() {
    const body = _el('div', '');
    body.appendChild(_buildStep3Card());
    body.appendChild(_buildDpiaCard());
    const { section } = WizUtils.buildCollapsible({ title: 'Assessment inputs — classification & DPIA', number: '', icon: false, body });
    section.style.marginTop = '18px';
    // start collapsed (buildCollapsible defaults open? force closed)
    const b = section.querySelector('.wiz-collapsible-body');
    if (b) b.style.display = 'none';
    const chev = section.querySelector('.wiz-collapsible-header .wiz-gate-chevron, .wiz-collapsible-header svg');
    return section;
  }

  // Persist every source at once (legal + NIST fold into legal_assessment;
  // internal standards into group_standard_assessment). No re-render.
  function _writeRisksRecord() {
    (_legalGuidance?.wizard_questions || []).forEach(wq => {
      const ans = _wizState.answers[wq.risk_name];
      if (ans === 'yes' || ans === 'partially') _state.legal_risks[wq.risk_name] = true;
      else if (ans === 'no') _state.legal_risks[wq.risk_name] = false;
    });
    if (!_record) _record = {};
    if (!_record._meta) _record._meta = { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    if (!_record['step-5']) _record['step-5'] = {};
    _record['step-5'].legal_assessment = _buildLegalOutputRecord();
    WizUtils.saveRecord(_record);
  }


  // Auto-save: persist on every change without re-rendering (so expanded cards
  // and scroll position are undisturbed), and flash a "Saved" indicator.
  let _asTimer = null;
  function _autosave() { _writeRisksRecord(); _flashSaved(); _refreshRiskCounts(); }
  function _autosaveSoon() { clearTimeout(_asTimer); _asTimer = setTimeout(_autosave, 400); }

  function _riskTierCounts() {
    let mand = 0, rec = 0;
    (_legalGuidance?.wizard_questions || []).forEach(wq => { _isArticleApplicable(wq.risk_name) === true ? mand++ : rec++; });
    mand += (_record?.['step-4']?.data_types_identified?.privacy_risks || []).length;
    return { mand, rec };
  }
  function _refreshRiskCounts() {
    if (!_riskheadSummaryEl) return;
    const { mand, rec } = _riskTierCounts();
    _riskheadSummaryEl.innerHTML = `<strong>${mand}</strong> required · <strong>${rec}</strong> recommended`;
  }
  function _flashSaved() {
    if (!_savedNoteEl) return;
    _savedNoteEl.classList.add('is-on');
    clearTimeout(_savedNoteEl._t);
    _savedNoteEl._t = setTimeout(() => _savedNoteEl && _savedNoteEl.classList.remove('is-on'), 1600);
  }

  // ── Load your AI tool risk assessment into Steps 5 & 6 ─────────────────────────────
  const _rEsc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const _rCanon = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const _rEmpty = v => v == null || (Array.isArray(v) ? v.length === 0 : String(v).trim() === '');
  const _rYPN = v => { const w = String(v == null ? '' : v).trim().toLowerCase(); if (/^y(es)?\b/.test(w)) return 'yes'; if (/^p(art)/.test(w)) return 'partially'; if (/^no?\b/.test(w)) return 'no'; return null; };

  // Risk catalog: pk_Risk_ID → { name, kind, refs(valid HS refs) }
  function _riskCatalog() {
    const cat = {};
    (_tblRisks || []).forEach(r => {
      const areas = (_legalGuidance?.risks?.[r.risk_name]?.areas) || [];
      // subcategory (canonicalised) → [refs]
      const areaRefs = {};
      areas.forEach(a => { areaRefs[_rCanon(a.subcategory)] = (a.refs || []).map(x => x.ref); });
      cat[r.pk_Risk_ID] = {
        name: r.risk_name,
        kind: 'legal',
        refs: (r.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean),
        areaNames: areas.map(a => a.subcategory),
        areaRefs
      };
    });
    return cat;
  }

  // A risk's requirements, ordered and grouped by subcategory, with HS detail:
  // [{ subcategory, refs:[{ ref, name, text }] }]. Drives Step B selection.
  function _riskReqGroups(riskId) {
    const r = (_tblRisks || []).find(x => x.pk_Risk_ID === riskId);
    const refs = (r?.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean);
    const groups = []; const byName = new Map();
    refs.forEach(ref => {
      const h = _hsByRef.get(ref) || {};
      const sub = h.subcategory || '—';
      if (!byName.has(sub)) { const g = { subcategory: sub, refs: [] }; byName.set(sub, g); groups.push(g); }
      byName.get(sub).refs.push({ ref, name: h.standard_name || ref, text: h.standard_text || '' });
    });
    return groups;
  }
  // All HS refs a risk maps to (for default-select-all on first apply).
  function _riskAllRefs(riskId) {
    const r = (_tblRisks || []).find(x => x.pk_Risk_ID === riskId);
    return (r?.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  // ── Challenge cycle ────────────────────────────────────────────────────────
  // The assessor disputes a risk's answer/justification; the challenge is a
  // written objection. Challenges from every tab are compiled into one prompt
  // that asks the AI tool to re-assess and rewrite justifications, whose reply
  // reloads through the same "Load your AI tool output" path.

  function _pendingChallenges() {
    return Object.keys(_wizState.challenges).filter(n => (_wizState.challenges[n] || '').trim());
  }

  function _currentAnswerFor(name) {
    if (_wizState.answers[name]) return _wizState.answers[name];
    const nb = _state.nist_risks[name];
    if (nb === true)  return 'yes';
    if (nb === false) return 'no';
    return 'unanswered';
  }

  // Pre-fill contradiction — polarity flips with the current answer.
  function _challengeSeed(name, getAns) {
    const ans  = getAns();
    const just = (_wizState.rationales[name] || '').trim();
    const jq   = just ? `The justification states: "${just}" — ` : '';
    if (ans === 'no') {
      return `I dispute this. ${jq}but for this system this risk SHOULD apply, because [state which of the conditions are actually met]. Reassess as applicable and write a justification accordingly.`;
    }
    return `I dispute this. ${jq}but for this system that does not hold, because [state why the conditions are not actually met]. Reassess as Not applicable and rewrite the justification accordingly.`;
  }

  // Reusable challenge control appended under a risk's justification box.
  function _buildChallengeUI(name, getAns) {
    const wrap = _el('div', 's5-challenge-wrap');
    const has  = () => !!(_wizState.challenges[name] || '').trim();

    const btn   = _el('button', 's5-challenge-btn', { type: 'button' });
    const panel = _el('div', 's5-challenge-panel');
    panel.style.display = has() ? '' : 'none';
    const setBtn = () => { btn.textContent = (panel.style.display === 'none' ? '⚑ Challenge this assessment' : '⚑ Hide challenge'); btn.classList.toggle('is-active', has()); };

    const lbl = _el('p', 's5-challenge-label', { textContent: 'Your challenge — sent to the AI tool to re-assess and rewrite the justification:' });
    const ta  = document.createElement('textarea');
    ta.className = 's5-challenge-ta';
    ta.rows = 3;
    ta.placeholder = 'Explain why you dispute this assessment…';
    ta.value = _wizState.challenges[name] || '';
    ta.addEventListener('input', () => { _wizState.challenges[name] = ta.value; btn.classList.toggle('is-active', has()); _autosaveSoon(); });

    const clear = _el('button', 's5-challenge-clear', { type: 'button', textContent: 'Clear challenge' });
    clear.addEventListener('click', () => { delete _wizState.challenges[name]; ta.value = ''; panel.style.display = 'none'; setBtn(); });

    panel.append(lbl, ta, clear);
    btn.addEventListener('click', () => {
      const hidden = panel.style.display === 'none';
      panel.style.display = hidden ? '' : 'none';
      if (hidden && !ta.value.trim()) { ta.value = _challengeSeed(name, getAns); _wizState.challenges[name] = ta.value; }
      setBtn();
    });
    setBtn();
    wrap.append(btn, panel);
    return wrap;
  }

  // Compile every pending challenge into a re-assessment prompt.
  function _buildChallengePrompt() {
    const names = _pendingChallenges();
    if (!names.length) return '';

    const seen = new Set(); const baseline = [];
    const push = (n, a) => { if (seen.has(n)) return; seen.add(n); baseline.push(`  ${_riskIdByName.get(n) || '?'} — ${n}: ${a}`); };
    Object.keys(_wizState.answers).forEach(n => push(n, _wizState.answers[n]));

    const lines = [];
    lines.push(
      'RE-ASSESSMENT REQUEST',
      '',
      'You previously produced a risk assessment for this AI system. The assessor has reviewed it and formally challenged the risks listed below.',
      '',
      'For EACH challenged risk:',
      '- Reconsider your answer in light of the assessor’s objection and the system context.',
      '- If the objection is valid, change the answer (an excluded risk becomes "no") and REWRITE the justification.',
      '- If the objection is not valid, keep the answer but strengthen the justification to directly address the objection.',
      '',
      'JUSTIFICATION RULES (the "reasoning" text is published verbatim in the conformity report):',
      '- Write a specific, substantive justification of 1–3 sentences for THIS system and THIS risk, grounded in the assessor’s challenge and the classification/DPIA context.',
      '- For an excluded risk, state the concrete reason it does not apply (e.g. which conditions are absent, what the system does not do) — do NOT use generic boilerplate such as "outside the scope of this use case".',
      '- Never reuse the same sentence across different risks.',
      '',
      'Leave every non-challenged risk unchanged.',
      '',
      'Return ONLY the complete risk_assessment JSON in the shape below, including EVERY risk. Do NOT omit challenged risks — represent an excluded risk as "no" with its new justification in "reasoning":',
      '',
      '```json',
      '{ "risk_assessment": { "risks": { "RISK-XXX": "yes|partially|no" }, "reasoning": { "RISK-XXX": "…" }, "selected_requirements": { "RISK-XXX": ["[HS.ref]"] } } }',
      '```',
      '',
      '=== CURRENT ASSESSMENT (baseline — keep these unless challenged) ===',
      ...baseline,
      '',
      '=== CHALLENGED RISKS ==='
    );
    names.forEach(n => {
      const id   = _riskIdByName.get(n) || '?';
      const just = (_wizState.rationales[n] || '').trim() || '(none recorded)';
      lines.push(
        `[${id}] ${n}`,
        `  Current answer: ${_currentAnswerFor(n)}`,
        `  Current justification: ${just}`,
        `  Assessor challenge: ${(_wizState.challenges[n] || '').trim()}`,
        ''
      );
    });
    return lines.join('\n');
  }

  function _buildChallengeCompileSection() {
    const section = _el('div', 's5-ai-section');
    const header  = _el('div', 's5-ai-header');
    const hLeft   = _el('div', 's5-ai-header-left');
    const title   = _sectionLabel('Compile challenges into a re-assessment prompt');
    title.style.marginBottom = '2px';
    const sub = _el('p', ''); sub.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0';
    const countTxt = () => { const n = _pendingChallenges().length; return n ? `${n} challenge${n !== 1 ? 's' : ''} pending — build a prompt to send back to your AI tool.` : 'No challenges yet — add one under any risk you dispute.'; };
    sub.textContent = countTxt();
    hLeft.append(title, sub);
    const hRight = _el('div', 's5-ai-header-right');
    const chevron = _el('span', 's5-ai-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 's5-ai-body'); body.style.display = 'none';
    const info = _el('p', ''); info.style.cssText = 'font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0 0 10px';
    info.textContent = 'This gathers every challenge you have written (across the Legal and NIST tabs) into one prompt. Paste it into your AI tool; it re-assesses the challenged risks, rewrites their justifications, and returns an updated assessment. Load that reply back in above, then repeat as needed.';
    const buildBtn = _el('button', 'wiz-btn-secondary', { textContent: 'Build re-assessment prompt' });
    const copyBtn  = _el('button', 'wiz-btn-primary', { textContent: 'Copy prompt' }); copyBtn.style.display = 'none';
    const promptArea = _el('textarea', 's5-prompt-area'); promptArea.rows = 14; promptArea.readOnly = true; promptArea.style.marginTop = '10px';
    promptArea.placeholder = 'Your compiled challenge prompt will appear here…';
    buildBtn.addEventListener('click', () => {
      const p = _buildChallengePrompt();
      sub.textContent = countTxt();
      if (!p) { promptArea.value = ''; promptArea.placeholder = 'No challenges to compile. Add a challenge under a risk first.'; copyBtn.style.display = 'none'; return; }
      promptArea.value = p; copyBtn.style.display = '';
    });
    copyBtn.addEventListener('click', () => WizUtils.copyToClipboard(promptArea.value, copyBtn));
    const btnRow = _el('div', ''); btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
    btnRow.append(buildBtn, copyBtn);
    body.append(info, btnRow, promptArea);
    section.appendChild(body);
    header.addEventListener('click', () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? '' : 'none';
      chevron.style.transform = hidden ? 'rotate(180deg)' : '';
      if (hidden) sub.textContent = countTxt();
    });
    return section;
  }

  function _buildLoadRaSection() {
    const section = _el('div', 's5-ai-section');
    const header  = _el('div', 's5-ai-header');
    const hLeft   = _el('div', 's5-ai-header-left');
    const title   = _sectionLabel('Load your AI tool output into Steps 5 & 6');
    title.style.marginBottom = '2px';
    const sub = _el('p', ''); sub.style.cssText = 'font-size:11px;color:var(--color-text-tertiary);margin-bottom:0';
    sub.textContent = 'Loads risk applicability and control selection as a draft — review and save in Steps 5 and 6.';
    hLeft.append(title, sub);
    const hRight = _el('div', 's5-ai-header-right');
    const chevron = _el('span', 's5-ai-chevron');
    chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2.5 5L7 9.5L11.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    hRight.appendChild(chevron);
    header.append(hLeft, hRight);
    section.appendChild(header);

    const body = _el('div', 's5-ai-body'); body.style.display = 'none';
    const ta = _el('textarea', 's5-prompt-area'); ta.rows = 8; ta.placeholder = 'Paste your AI tool’s full reply (or just its ```json block) here…';
    const btnRow = _el('div', ''); btnRow.style.cssText = 'display:flex;gap:8px;margin:10px 0';
    const checkBtn = _el('button', 'wiz-btn-secondary', { textContent: 'Validate & preview' });
    const applyBtn = _el('button', 'wiz-btn-primary', { textContent: 'Apply to Steps 5 & 6' });
    applyBtn.style.display = 'none';
    btnRow.append(checkBtn, applyBtn);
    const preview = _el('div', 's5-load-preview'); preview.style.cssText = 'font-size:12.5px;line-height:1.6';

    let _res = null;
    checkBtn.addEventListener('click', () => {
      applyBtn.style.display = 'none'; _res = null;
      const ra = _extractRiskAssessment(ta.value);
      if (!ra) { preview.innerHTML = '<span style="color:#fba4a3">Could not find a <code>risk_assessment</code> JSON block in the pasted text.</span>'; return; }
      _res = _validateRa(ra);
      preview.innerHTML = _renderRaPreview(_res);
      if (_res.riskCount + _res.reqRiskCount > 0) applyBtn.style.display = '';
    });
    applyBtn.addEventListener('click', () => {
      if (!_res) return;
      _applyRa(_res);
      preview.innerHTML = `<span style="color:#8cebb0">✓ Loaded ${_res.riskCount} risk answer${_res.riskCount !== 1 ? 's' : ''} and requirement selections for ${_res.reqRiskCount} risk${_res.reqRiskCount !== 1 ? 's' : ''} as a draft. Review below, then <strong>Save all risks</strong>; confirm in <strong>Step 6</strong>.</span>`;
      applyBtn.style.display = 'none';
      _renderConsolidated();
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

  function _extractRiskAssessment(text) {
    const tryParse = s => { try { return JSON.parse(s); } catch (_) { return null; } };
    const pick = o => (o && o.risk_assessment && typeof o.risk_assessment === 'object') ? o.risk_assessment
                    : (o && typeof o === 'object' && (o.risks || o.applicable_subcategories || o.selected_controls)) ? o : null;
    for (const f of [...(text || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1])) {
      const a = pick(tryParse(f.trim())); if (a) return a;
    }
    const objs = (text || '').match(/\{[\s\S]*\}/g) || [];
    objs.sort((a, b) => b.length - a.length);
    for (const c of objs) { const a = pick(tryParse(c)); if (a) return a; }
    return null;
  }

  function _validateRa(ra) {
    const cat = _riskCatalog();
    const _canonRef = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9.]+/g, '');
    const legalAnswers = {}; const reqSel = {}; const rationales = {}; const warnings = [];
    let riskCount = 0; let reqRiskCount = 0;
    Object.entries(ra.risks || {}).forEach(([id, v]) => {
      const r = cat[id];
      if (!r) { warnings.push(`Unknown risk <code>${_rEsc(id)}</code> — skipped.`); return; }
      if (_rEmpty(v)) return;
      const a = _rYPN(v);
      if (!a) { warnings.push(`<code>${_rEsc(id)}</code>: "${_rEsc(String(v)).slice(0, 30)}" is not yes/partially/no — skipped.`); return; }
      legalAnswers[r.name] = a;
      riskCount++;
    });
    // Reasoning → per-risk rationale
    Object.entries(ra.reasoning || {}).forEach(([id, txt]) => {
      const r = cat[id];
      if (!r || _rEmpty(txt)) return;
      rationales[r.name] = String(txt).trim();
    });
    // selected_requirements → per-risk HS ref selection (validated against the risk)
    Object.entries(ra.selected_requirements || ra.applicable_subcategories || {}).forEach(([id, refs]) => {
      const r = cat[id];
      if (!r) { warnings.push(`Requirements for unknown risk <code>${_rEsc(id)}</code> — skipped.`); return; }
      const arr = Array.isArray(refs) ? refs : (refs ? [refs] : []);
      const sel = {};
      arr.forEach(ref => {
        const hit = r.refs.find(x => _canonRef(x) === _canonRef(ref));
        if (hit) sel[hit] = true;
        else warnings.push(`<code>${_rEsc(id)}</code>: "${_rEsc(String(ref)).slice(0, 24)}" is not a requirement of this risk — skipped.`);
      });
      if (Object.keys(sel).length) { reqSel[r.name] = sel; reqRiskCount++; }
    });
    return { legalAnswers, reqSel, rationales, warnings, riskCount, reqRiskCount };
  }

  function _renderRaPreview(res) {
    let html = `<div style="color:#8cebb0;font-weight:600;margin-bottom:6px">✓ ${res.riskCount} risk answer${res.riskCount !== 1 ? 's' : ''} and requirement selections for ${res.reqRiskCount} risk${res.reqRiskCount !== 1 ? 's' : ''} recognised.</div>`;
    if (res.warnings.length) {
      html += `<div style="color:#ecd489;margin-bottom:4px">${res.warnings.length} item${res.warnings.length !== 1 ? 's' : ''} need attention:</div>`;
      html += '<ul style="margin:0 0 0 16px;padding:0;color:var(--color-text-secondary)">' +
        res.warnings.slice(0, 12).map(w => `<li>${w}</li>`).join('') +
        (res.warnings.length > 12 ? `<li>…and ${res.warnings.length - 12} more</li>` : '') + '</ul>';
    }
    html += '<div style="color:var(--color-text-tertiary);margin-top:8px">This loads a <strong>draft</strong> — review and <strong>Save</strong> in Steps 5 and 6. Nothing is written until you click Apply.</div>';
    return html;
  }

  function _applyRa(res) {
    _record = WizUtils.loadRecord() || {};
    if (!_record._meta) _record._meta = { schema_version: '1.0', created: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    // Reflect the loaded answers/rationales/requirement picks into live state first.
    // For a risk the AI marked applicable but gave no explicit requirements, default
    // to all of the risk's requirements so nothing is silently dropped.
    Object.assign(_wizState.answers, res.legalAnswers);
    Object.assign(_wizState.rationales, res.rationales);
    Object.entries(res.reqSel).forEach(([n, sel]) => { _wizState.reqs[n] = Object.assign({}, _wizState.reqs[n] || {}, sel); });
    Object.entries(res.legalAnswers).forEach(([n, a]) => {
      if ((a === 'yes' || a === 'partially') && (!_wizState.reqs[n] || Object.keys(_wizState.reqs[n]).length === 0)) {
        const rid = _riskIdByName.get(n);
        _wizState.reqs[n] = {};
        _riskAllRefs(rid).forEach(ref => { _wizState.reqs[n][ref] = true; });
      }
    });
    // A challenge is resolved once the AI returns a fresh answer/justification for it.
    Object.keys(res.legalAnswers).forEach(n => { delete _wizState.challenges[n]; });
    Object.keys(res.rationales).forEach(n => { delete _wizState.challenges[n]; });
    // …then rebuild the full Step 5 record so risks[] + selected_hs stay coherent.
    if (!_record['step-5']) _record['step-5'] = {};
    _record['step-5'].legal_assessment = _buildLegalOutputRecord();
    WizUtils.saveRecord(_record);
  }

  // ---- Re-render legal pane in place --------------------------
  // Wave 1: all three per-source re-renders funnel to the one consolidated view.
  function _renderLegalPane() { _renderConsolidated(); }

  // ---- Legal pane -----------------------------------------
  function _buildLegalPane() {
    const wqs = _legalGuidance?.wizard_questions;
    if (!wqs?.length) {
      const card = _el('div', 'step-detail-card');
      card.appendChild(_el('p', 'wiz8-notice', { innerHTML: 'No risk questions defined. Add a <code>wizard_questions</code> array to <strong>step5-legal-risk-guidance.json</strong>.' }));
      return card;
    }
    const wrap = _el('div', 's5-legal-wrap');
    const legalSaved = _record?.['step-5']?.legal_assessment?.completed;
    if (legalSaved) {
      const date  = _record['step-5'].legal_assessment.assessment_date || '';
      const count = _record['step-5'].legal_assessment.selected_count ?? 0;
      const note  = _el('div', 's5-saved-note');
      note.innerHTML = `✓ Assessment last saved <strong>${date}</strong> — <strong>${count} risk${count !== 1 ? 's' : ''}</strong> confirmed.`;
      wrap.appendChild(note);
    }
    wrap.appendChild(_buildRiskList(wqs));
    const actRow = _el('div', 'wiz-action-row');
    const saveBtn = _el('button', 'wiz-btn-primary');
    saveBtn.textContent = 'Save Legal Assessment ✓';
    saveBtn.addEventListener('click', _handleSaveLegal);
    actRow.appendChild(saveBtn);
    const clearBtn = _el('button', 'wiz-btn-secondary');
    clearBtn.textContent = '↺ Clear all answers';
    clearBtn.addEventListener('click', () => { _wizState.answers = {}; _wizState.rationales = {}; _renderLegalPane(); });
    actRow.appendChild(clearBtn);
    wrap.appendChild(actRow);
    return wrap;
  }

  // ---- Risk list (one collapsible row per risk) ---------------
  // Two-step gate per risk: Step A (category question → applies?), Step B
  // (per-subcategory treatment questions → which requirement areas apply).
  // Step B is revealed only once Step A is Yes or Partial.
  function _buildRiskList(wqs) {
    const BADGE   = { yes: '✓ Applies', partially: '~ Partial', no: '✗ Not applicable' };
    const ANS_MOD = { yes: 'ok', partially: 'partial', no: 'none' };
    const list  = _el('div', 's5-risk-list');

    wqs.forEach(wq => {
      const name       = wq.risk_name;
      const riskG      = _legalGuidance.risks?.[name] || {};
      const answer     = _wizState.answers[name] || null;
      const article    = _getArticleForRisk(name);
      const riskId     = _riskIdByName.get(name) || wq.risk_id || '';
      const reqGroups  = _riskReqGroups(riskId);
      const allRefs    = _riskAllRefs(riskId);

      if (!_wizState.reqs[name]) _wizState.reqs[name] = {};
      const reqState = _wizState.reqs[name];
      if (!_wizState.reqReasons[name]) _wizState.reqReasons[name] = {};
      const reqReasons = _wizState.reqReasons[name];

      const applies = a => a === 'yes' || a === 'partially';
      // On first apply, default every requirement to selected (trim, not hunt).
      const defaultSelectAll = () => {
        if (Object.keys(reqState).length === 0) allRefs.forEach(ref => { reqState[ref] = true; });
      };
      if (applies(answer)) defaultSelectAll();

      const badge = _el('span', `wiz-item-badge${answer ? ' wiz-item-badge--' + ANS_MOD[answer] : ''}`);
      badge.textContent = answer ? BADGE[answer] : 'Unanswered';

      const body = _el('div', 's5-risk-body');

      // Risk statement
      if (riskG.risk_description) {
        const d = _el('p', '');
        d.style.cssText = 'margin:0;font-size:12.5px;line-height:1.6;color:var(--color-text-secondary)';
        d.textContent = riskG.risk_description;
        body.appendChild(d);
      }

      // ── STEP A — does this risk apply? ──
      body.appendChild(_el('p', 's5-applies-label', { textContent: 'Step A — Does this risk apply?' }));
      if (riskG.category_question) {
        const q = _el('div', 's5-qblock'); q.textContent = riskG.category_question;
        body.appendChild(q);
      }

      // ── STEP B — requirements to implement (revealed on Yes/Partial) ──
      // The individual HS requirements are shown with detail and pre-ticked;
      // untick any that don't apply. This selection is what Step 6 confirms.
      const stepB = _el('div', 's5-stepb');
      const selCount = () => allRefs.filter(r => reqState[r]).length;
      const updateCount = () => {
        const l = stepB.querySelector('.s5-stepb-count');
        if (l) l.textContent = `Requirements to implement (${selCount()}/${allRefs.length})`;
      };
      const buildStepB = () => {
        stepB.innerHTML = '';
        if (!applies(_wizState.answers[name])) { stepB.style.display = 'none'; return; }
        stepB.style.display = '';
        const hdr = _el('div', 's5-stepb-hdr');
        hdr.appendChild(_el('p', 's5-applies-label s5-stepb-count', { textContent: `Requirements to implement (${selCount()}/${allRefs.length})` }));
        const tools = _el('div', 's5-stepb-tools');
        const selAll = _el('button', 's5-recbulk-link', { type: 'button', textContent: 'Select all' });
        selAll.addEventListener('click', () => { allRefs.forEach(r => reqState[r] = true); buildStepB(); _autosave(); });
        const selNone = _el('button', 's5-recbulk-link', { type: 'button', textContent: 'Clear' });
        selNone.addEventListener('click', () => { allRefs.forEach(r => reqState[r] = false); buildStepB(); _autosave(); });
        tools.append(selAll, _el('span', '', { textContent: '·', style: 'color:var(--color-text-tertiary)' }), selNone);
        hdr.appendChild(tools);
        stepB.appendChild(hdr);
        if (!reqGroups.length) { stepB.appendChild(_el('p', 's5-area-hint', { textContent: 'No requirements mapped to this risk.' })); return; }
        reqGroups.forEach(group => {
          stepB.appendChild(_el('p', 's5-sub-label', { textContent: group.subcategory }));
          group.refs.forEach(rf => {
            const wrap = _el('div', 's5-req-wrap');
            const row = _el('label', 's5-req-row');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.className = 's5-req-cb';
            cb.checked = !!reqState[rf.ref];
            const main = _el('div', 's5-req-main');
            const h = _el('div', 's5-req-hdr');
            h.appendChild(_el('span', 's5-ref-chip', { textContent: rf.ref }));
            h.appendChild(_el('span', 's5-req-name', { textContent: rf.name }));
            main.appendChild(h);
            if (rf.text) main.appendChild(_el('div', 's5-req-desc', { textContent: rf.text }));
            row.append(cb, main);
            wrap.appendChild(row);

            // Reason (required) — shown only when the requirement is unticked.
            const reasonWrap = _el('div', 's5-req-reason');
            reasonWrap.appendChild(_el('label', 's5-req-reason-lbl', { textContent: 'Why is this requirement not applicable to your system? (required)' }));
            const rta = document.createElement('textarea');
            rta.className = 's5-req-reason-ta'; rta.rows = 2;
            rta.placeholder = 'e.g. the system generates no synthetic media, so deep-fake provenance does not apply…';
            rta.value = reqReasons[rf.ref] || '';
            const syncReason = () => {
              const excluded = !cb.checked;
              reasonWrap.style.display = excluded ? '' : 'none';
              wrap.classList.toggle('needs-reason', excluded && !(reqReasons[rf.ref] || '').trim());
            };
            rta.addEventListener('input', () => { reqReasons[rf.ref] = rta.value; syncReason(); _autosaveSoon(); });
            reasonWrap.appendChild(rta);
            wrap.appendChild(reasonWrap);

            cb.addEventListener('change', () => {
              reqState[rf.ref] = cb.checked;
              if (cb.checked) delete reqReasons[rf.ref]; // re-selected → clear its exclusion reason
              syncReason();
              updateCount();
              _autosaveSoon();
              if (!cb.checked) rta.focus();
            });
            syncReason();
            stepB.appendChild(wrap);
          });
        });
      };
      buildStepB();

      const btnRow = _el('div', 's5-answer-row');
      [['yes', '✓ Applies'], ['partially', '~ Partial'], ['no', '✗ Not applicable']].forEach(([val, lbl]) => {
        const btn = _el('button', `s5-answer-btn s5-answer-btn--${val}${answer === val ? ' s5-answer-btn--active' : ''}`);
        btn.textContent = lbl;
        btn.addEventListener('click', () => {
          const prev = _wizState.answers[name];
          _wizState.answers[name] = val;
          if (applies(val)) defaultSelectAll();
          _autosave();
          // Moving a risk into/out of "Not applicable" changes its group, so
          // re-render to reflect the Excluded group; otherwise update in place.
          if (val === 'no' || prev === 'no') { _renderConsolidated(); return; }
          btnRow.querySelectorAll('.s5-answer-btn').forEach(b => b.classList.remove('s5-answer-btn--active'));
          btn.classList.add('s5-answer-btn--active');
          badge.textContent = BADGE[val];
          badge.className   = `wiz-item-badge wiz-item-badge--${ANS_MOD[val]}`;
          buildStepB();
        });
        btnRow.appendChild(btn);
      });
      body.appendChild(btnRow);
      body.appendChild(stepB);

      const ta = document.createElement('textarea');
      ta.className   = 's5-rationale-ta';
      ta.placeholder = 'Rationale…';
      ta.rows        = 2;
      ta.value       = _wizState.rationales[name] || '';
      ta.addEventListener('input', () => { _wizState.rationales[name] = ta.value; _autosaveSoon(); });
      body.appendChild(ta);
      body.appendChild(_buildChallengeUI(name, () => _wizState.answers[name]));

      const artId = article?.pk_AI_Article_ID || null;
      const riskNum = _riskIdByName.get(name) || '';
      const { section } = WizUtils.buildCollapsible({ title: name, number: riskNum, icon: false, artId, artInline: true, body });
      section.querySelector('.wiz-collapsible-header-right').prepend(badge);
      list.appendChild(section);
    });

    return list;
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
    const cat = _riskCatalog();
    const risks = wqs.map(wq => {
      const name = wq.risk_name;
      const ans  = _wizState.answers[name] || 'skipped';
      const selected = ans === 'yes' || ans === 'partially';
      const rid = wq.risk_id || _riskIdByName.get(name);
      const reqState = _wizState.reqs[name] || {};
      const reasons  = _wizState.reqReasons[name] || {};
      const all = _riskAllRefs(rid);
      // Keep the risk's canonical ref order for a stable record.
      const selRefs = all.filter(ref => reqState[ref]);
      // Excluded requirements of an applicable risk, each with its N/A reason.
      const exclRefs = selected ? all.filter(ref => !reqState[ref]).map(ref => ({
        standard_ref: ref,
        standard_name: (_hsByRef.get(ref) || {}).standard_name || ref,
        reason: (reasons[ref] || '').trim()
      })) : [];
      return {
        risk_id:                rid,
        risk_name:              name,
        risk_source:            'EU_AI_Act',
        selected,
        wizard_answer:          ans,
        rationale:              _wizState.rationales[name] || '',
        selected_refs:          selected ? selRefs : [],
        excluded_refs:          exclRefs,
        relevance:              _computeRelevance(name)
      };
    });
    const sel = risks.filter(r => r.selected).length;
    const excludedCount = risks.filter(r => r.wizard_answer === 'no').length;
    // Per-risk selected_hs (risk_id → refs) — the draft selection Step 6 confirms.
    const selected_hs = {};
    risks.forEach(r => { if (r.selected && r.selected_refs.length) selected_hs[r.risk_id] = r.selected_refs; });
    // Flat requirement exclusions (ref → reason) for the report's traceability,
    // plus a count of any left unjustified (excluded with no reason).
    const requirement_exclusions = {};
    let unjustifiedExclusions = 0;
    risks.forEach(r => (r.excluded_refs || []).forEach(x => {
      requirement_exclusions[x.standard_ref] = x.reason;
      if (!x.reason) unjustifiedExclusions++;
    }));
    return {
      completed:             true,
      assessment_date:       today,
      wizard_answers:        { ..._wizState.answers },
      wizard_rationales:     { ..._wizState.rationales },
      wizard_challenges:     { ..._wizState.challenges },
      wizard_req_selections: JSON.parse(JSON.stringify(_wizState.reqs)),
      wizard_req_reasons:    JSON.parse(JSON.stringify(_wizState.reqReasons)),
      selected_hs,
      requirement_exclusions,
      unjustified_exclusions: unjustifiedExclusions,
      total_risks:           risks.length,
      selected_count:        sel,
      excluded_count:        excludedCount,
      exclusions_approved:   _exclusionsApproved,
      risks
    };
  }

  // NIST AI RMF risks, recorded alongside the legal risks (they are EU AI Act
  // article-mapped and flow through the legal control path in Step 6) but tagged
  // risk_source: 'NIST_RMF' and assessed in their own Step 5 tab.
  function _nistOutputRisks() {
    return (_tblRisks || []).filter(r => r.risk_source === 'NIST_RMF').map(r => ({
      risk_name:   r.risk_name,
      risk_source: 'NIST_RMF',
      selected:    _state.nist_risks[r.risk_name] !== false,
      relevance:   'unassessed'
    }));
  }

  // ---- NIST AI RMF pane -----------------------------------------
  function _renderNistPane() { _renderConsolidated(); }

  function _buildNistPane() {
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('h2', 'step-detail-title', { textContent: 'NIST AI RMF Risk Assessment' }));
    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Risks surfaced by the NIST AI Risk Management Framework that sit alongside — and beyond — the EU AI Act article set. Each is mapped to an AI Act article and flows through control selection in Step 6. Mark each risk as applicable to this use case.';
    card.appendChild(sub);

    const nistRisks = (_tblRisks || []).filter(r => r.risk_source === 'NIST_RMF');
    if (!nistRisks.length) {
      card.appendChild(_el('p', 'wiz8-notice', { textContent: 'No NIST AI RMF risks defined.' }));
      return card;
    }

    const list = _el('div', 's5-gs-list');
    list.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin:12px 0';
    nistRisks.forEach(r => list.appendChild(_buildNistItem(r)));
    card.appendChild(list);

    const actRow = _el('div', 'wiz-action-row');
    const saveBtn = _el('button', 'wiz-btn-primary', { textContent: 'Save NIST AI RMF Assessment ✓' });
    saveBtn.addEventListener('click', _handleSaveNist);
    actRow.appendChild(saveBtn);
    card.appendChild(actRow);
    return card;
  }

  function _buildNistItem(risk) {
    const key = risk.risk_name;
    const cur = _state.nist_risks[key]; // true | false | undefined
    const badgeFor = v => v === true ? ['Applicable', 'ok'] : v === false ? ['Not applicable', 'none'] : ['Unanswered', ''];
    const [btxt, bmod] = badgeFor(cur);
    const badge = _el('span', `wiz-item-badge${bmod ? ' wiz-item-badge--' + bmod : ''}`);
    badge.textContent = btxt;

    const body = _el('div', 's5-risk-body');
    const artName = WizUtils.ARTICLES_BY_ID.get(risk.fk_AI_Article_ID)?.article_name || risk.fk_AI_Article_ID || '';
    const banner = _el('div', '');
    banner.style.cssText = 'background:rgba(93,130,214,0.14);border:1px solid rgba(93,130,214,0.40);color:#a4ccf6;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.5;margin-bottom:10px';
    banner.innerHTML = `<strong>Surfaced by the NIST AI RMF</strong> — ${_rEsc(risk.nist_ai_rmf || '')}. Mapped to EU AI Act ${_rEsc(artName)}.`;
    body.appendChild(banner);

    // 💡 explanation sits high up, directly under the source banner.
    if (risk.traditional_analog) {
      body.appendChild(_el('div', 's5-analog-row', { textContent: '💡 ' + risk.traditional_analog }));
    }

    if (risk.risk_description) {
      const desc = _el('p', '');
      desc.style.cssText = 'margin:0 0 10px;font-size:12.5px;line-height:1.6;color:var(--color-text-secondary)';
      desc.textContent = risk.risk_description;
      body.appendChild(desc);
    }

    // "Applies if any of" — mirrors the EU AI Act risk display so the assessor has
    // the same concrete criteria to decide applicability.
    if (Array.isArray(risk.applies_if) && risk.applies_if.length) {
      body.appendChild(_el('p', 's5-applies-label', { textContent: 'Applies if any of:' }));
      const ul = _el('ul', 's5-applies-list');
      risk.applies_if.forEach(c => { const li = document.createElement('li'); li.textContent = c; ul.appendChild(li); });
      body.appendChild(ul);
    }

    const btnRow = _el('div', 's5-answer-row');
    [['yes', '✓ Yes', true], ['no', '✗ No', false]].forEach(([k, lbl, val]) => {
      const btn = _el('button', `s5-answer-btn s5-answer-btn--${k}${cur === val ? ' s5-answer-btn--active' : ''}`);
      btn.textContent = lbl;
      btn.addEventListener('click', () => {
        _state.nist_risks[key] = val;
        btnRow.querySelectorAll('.s5-answer-btn').forEach(b => b.classList.remove('s5-answer-btn--active'));
        btn.classList.add('s5-answer-btn--active');
        const [t, m] = badgeFor(val);
        badge.textContent = t;
        badge.className = `wiz-item-badge${m ? ' wiz-item-badge--' + m : ''}`;
        _autosave();
      });
      btnRow.appendChild(btn);
    });
    body.appendChild(btnRow);

    // Justification box — the AI tool's reasoning for this NIST risk loads here
    // (shared rationale store), and it is what a challenge contradicts.
    const nta = document.createElement('textarea');
    nta.className   = 's5-rationale-ta';
    nta.placeholder = 'Justification…';
    nta.rows        = 2;
    nta.value       = _wizState.rationales[key] || '';
    nta.addEventListener('input', () => { _wizState.rationales[key] = nta.value; _autosaveSoon(); });
    body.appendChild(nta);
    body.appendChild(_buildChallengeUI(key, () => (_state.nist_risks[key] === true ? 'yes' : _state.nist_risks[key] === false ? 'no' : undefined)));

    const { section } = WizUtils.buildCollapsible({ title: risk.risk_name, number: risk.pk_Risk_ID, icon: false, body });
    section.querySelector('.wiz-collapsible-header-right').prepend(badge);
    return section;
  }

  function _handleSaveNist() {
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    if (!_record['step-5']) _record['step-5'] = {};
    _record['step-5'].legal_assessment = _buildLegalOutputRecord();
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('NIST AI RMF risks saved ✓');
    _renderNistPane();
  }

  // ---- Internal Standards pane -----------------------------------
  function _renderGroupStandardsPane() { _renderConsolidated(); }

  function _buildGroupStandardsPane() {
    const card = _el('div', 'step-detail-card');

    const title = _el('h2', 'step-detail-title');
    title.textContent = 'Internal Standards Risk Assessment';
    card.appendChild(title);

    const sub = _el('p', 'step-detail-summary');
    sub.textContent = 'Risks derived from the Acceptable Use of AI Tools Standard. Mark each risk as applicable to this use case; applicable risks are treated with controls in Step 6.';
    card.appendChild(sub);

    const gsRisks = (_tblRisks || []).filter(r => r.risk_category === 'Group_Standard');
    if (!gsRisks.length) {
      card.appendChild(_el('p', 'wiz8-notice', { textContent: 'No Internal Standard risks defined.' }));
      return card;
    }

    const saved = _record?.['step-5']?.group_standard_assessment;
    if (saved?.completed) {
      const c = saved.selected_count ?? 0;
      const note = _el('div', 's5-saved-note');
      note.innerHTML = `✓ Assessment last saved <strong>${saved.assessment_date || ''}</strong> — <strong>${c} risk${c !== 1 ? 's' : ''}</strong> marked applicable.`;
      card.appendChild(note);
    }

    const list = _el('div', 's5-gs-list');
    list.style.cssText = 'display:flex;flex-direction:column;gap:12px;margin:12px 0';
    gsRisks.forEach(r => list.appendChild(_buildGroupStandardItem(r)));
    card.appendChild(list);

    const actRow = _el('div', 'wiz-action-row');
    const saveBtn = _el('button', 'wiz-btn-primary');
    saveBtn.textContent = 'Save Internal Standards Assessment ✓';
    saveBtn.addEventListener('click', _handleSaveGroupStandards);
    actRow.appendChild(saveBtn);
    card.appendChild(actRow);

    return card;
  }

  function _buildGroupStandardItem(risk) {
    const cur = _state.group_standard_risks[risk.pk_Risk_ID]; // true | false | undefined
    const badgeFor = v => v === true ? ['Applicable', 'ok'] : v === false ? ['Not applicable', 'none'] : ['Unanswered', ''];
    const [btxt, bmod] = badgeFor(cur);
    const badge = _el('span', `wiz-item-badge${bmod ? ' wiz-item-badge--' + bmod : ''}`);
    badge.textContent = btxt;

    const body = _el('div', 's5-risk-body');

    // Yellow "derived from" information banner
    const banner = _el('div', '');
    banner.style.cssText = 'background:rgba(212,184,96,0.14);border:1px solid rgba(212,184,96,0.40);color:#ecd489;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.5;margin-bottom:10px';
    banner.innerHTML = `<strong>Risk derived from</strong> the Acceptable Use of AI Tools Standard — ${risk.groupstandard_ref || 'Internal Standard'}.`;
    body.appendChild(banner);

    if (risk.risk_description) {
      const desc = _el('p', '');
      desc.style.cssText = 'margin:0 0 10px;font-size:12.5px;line-height:1.6;color:var(--color-text-secondary)';
      desc.textContent = risk.risk_description;
      body.appendChild(desc);
    }

    // Yes / No applicability buttons
    const btnRow = _el('div', 's5-answer-row');
    [['yes', '✓ Yes', true], ['no', '✗ No', false]].forEach(([key, lbl, val]) => {
      const btn = _el('button', `s5-answer-btn s5-answer-btn--${key}${cur === val ? ' s5-answer-btn--active' : ''}`);
      btn.textContent = lbl;
      btn.addEventListener('click', () => {
        _state.group_standard_risks[risk.pk_Risk_ID] = val;
        btnRow.querySelectorAll('.s5-answer-btn').forEach(b => b.classList.remove('s5-answer-btn--active'));
        btn.classList.add('s5-answer-btn--active');
        const [t, m] = badgeFor(val);
        badge.textContent = t;
        badge.className = `wiz-item-badge${m ? ' wiz-item-badge--' + m : ''}`;
        _autosave();
      });
      btnRow.appendChild(btn);
    });
    body.appendChild(btnRow);

    const { section } = WizUtils.buildCollapsible({ title: risk.risk_name, number: risk.pk_Risk_ID, icon: false, body });
    section.querySelector('.wiz-collapsible-header-right').prepend(badge);
    return section;
  }

  // ---- DPIA Risks pane (read-only list from Step 4) -----------
  function _buildDpiaRisksPane() {
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('h2', 'step-detail-title', { textContent: 'DPIA Risks' }));
    card.appendChild(_el('p', 'step-detail-summary', { textContent: 'Privacy risks identified during the Data Protection Impact Assessment (Step 4).' }));

    const step4 = _record?.['step-4'];
    if (!step4) {
      card.appendChild(_el('p', 'wiz8-notice', { innerHTML: '<strong>Step 4 (DPIA) not yet completed.</strong> Complete and save the DPIA first.' }));
      return card;
    }
    const risks = step4.data_types_identified?.privacy_risks || [];
    if (!risks.length) {
      card.appendChild(_el('p', 'wiz8-notice', { textContent: 'No privacy risks were recorded in the DPIA.' }));
      return card;
    }

    const list = _el('div', '');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px';
    risks.forEach(r => {
      const item = _el('div', '');
      item.style.cssText = 'display:flex;align-items:flex-start;gap:8px;border:1px solid var(--color-border,#2e2a1f);border-radius:6px;padding:10px 12px;background:var(--color-surface,#fff)';
      const dot = _el('span', ''); dot.style.cssText = 'color:#8ce3c6;font-weight:700;flex-shrink:0;line-height:1.5'; dot.textContent = '•';
      const txt = _el('span', ''); txt.style.cssText = 'font-size:13px;line-height:1.5;color:var(--color-text-primary)'; txt.textContent = r;
      item.append(dot, txt);
      list.appendChild(item);
    });
    card.appendChild(list);

    const inh = step4.inherent_risk_rating, res = step4.residual_risk_rating;
    if (inh || res) {
      const r = _el('p', 'step-detail-summary');
      r.style.marginTop = '14px';
      r.innerHTML = `Inherent risk rating: <strong>${inh || '—'}</strong> &nbsp;·&nbsp; Residual risk rating: <strong>${res || '—'}</strong>`;
      card.appendChild(r);
    }
    return card;
  }

  function _handleSaveGroupStandards() {
    if (!_record) _record = {};
    if (!_record._meta) {
      _record._meta = { schema_version: '1.0', title: 'AI Acceptable Use — System Authorisation Record', standard: 'ISO/IEC 42001-aligned', created: new Date().toISOString(), last_modified: new Date().toISOString() };
    }
    _record._meta.last_modified = new Date().toISOString();
    if (!_record['step-5']) _record['step-5'] = {};
    _record['step-5'].group_standard_assessment = _buildGroupStandardOutputRecord();
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Internal Standards assessment saved ✓');
    _renderGroupStandardsPane();
  }

  function _buildGroupStandardOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const gsRisks = (_tblRisks || []).filter(r => r.risk_category === 'Group_Standard');
    const risks = gsRisks.map(r => ({
      risk_id:           r.pk_Risk_ID,
      risk_name:         r.risk_name,
      risk_source:       'Group_Standard',
      groupstandard_ref: r.groupstandard_ref || '',
      selected:          !!_state.group_standard_risks[r.pk_Risk_ID]
    }));
    return {
      completed:       true,
      assessment_date: today,
      total_risks:     gsRisks.length,
      selected_count:  risks.filter(r => r.selected).length,
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
    for (const risk of (_tblRisks || [])) {
      const articleName = WizUtils.ARTICLES_BY_ID?.get(risk.fk_AI_Article_ID)?.article_name
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
.wiz8-source-card{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz5-source-card--dpia{background:rgba(138,130,235,0.10);border-color:rgba(138,130,235,0.40)}
.wiz8-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#a4ccf6;margin:0 0 10px}
.wiz5-source-card--dpia .wiz8-source-label{color:#bfb8ff}
.wiz8-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.wiz8-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz8-cell-label{font-size:11px;color:var(--color-text-tertiary);font-weight:500}
.wiz8-cell-value{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz8-cell-value--badge{font-size:11px;font-weight:700;text-transform:uppercase;background:rgba(93,202,165,0.16);color:#8ce3c6;padding:2px 8px;border-radius:10px;display:inline-block}
.wiz8-cell-value--num{font-size:18px;font-weight:700;color:var(--teal-600,#8ce3c6)}
.wiz8-cell-value--danger{font-size:13px;font-weight:700;color:#fba4a3}
.wiz8-warn{background:rgba(212,184,96,0.12);border:1px solid rgba(212,184,96,0.40);border-radius:6px;padding:10px 14px;font-size:13px;color:#ecd489;line-height:1.55}
.wiz8-info{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:6px;padding:10px 14px;font-size:13px;color:#a4ccf6;line-height:1.55}
.wiz8-instruction{font-size:13px;color:var(--color-text-secondary);margin:0 0 12px;line-height:1.6}
.wiz8-high-count{color:#fba4a3}
.wiz8-notice{font-size:13px;color:var(--color-text-tertiary);padding:20px 0}

/* Filter bar */
.wiz8-filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.wiz8-filter-label{font-size:12px;font-weight:600;color:var(--color-text-secondary)}
.wiz8-filter-btn{padding:5px 12px;font-size:12px;font-weight:500;border:1px solid var(--color-border);border-radius:20px;cursor:pointer;background:var(--color-surface);color:var(--color-text-secondary);font-family:inherit;transition:background .15s,border-color .15s;display:inline-flex;align-items:center}
.wiz8-filter-btn:hover{background:var(--color-bg-subtle,#211d15)}
.wiz8-filter-btn--active{background:#211d15;border-color:var(--teal-400,#2dd4bf);color:var(--teal-700,#8ce3c6);font-weight:600}
.wiz8-filter-btn--high.wiz8-filter-btn--active{background:rgba(226,90,88,0.16);border-color:rgba(226,90,88,0.50);color:#fba4a3}

/* FieldGroup accordion */
.wiz8-fg{border:1px solid var(--color-border);border-radius:8px;overflow:hidden;margin-bottom:10px}
.wiz8-fg-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none;gap:10px}
.wiz8-fg-header:hover{background:var(--color-bg-hover,#262219)}
.wiz8-fg-header-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.wiz8-fg-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz8-badge-risks{font-size:11px;font-weight:600;background:rgba(226,90,88,0.16);color:#fba4a3;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-badge-high{font-size:11px;font-weight:700;background:rgba(212,184,96,0.16);color:#ecd489;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz8-fg-header-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz8-sel-btn{font-size:11px;font-weight:500;color:var(--teal-600,#8ce3c6);background:none;border:1px solid rgba(93,202,165,0.45);border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.wiz8-sel-btn:hover{background:rgba(93,202,165,0.10)}
.wiz8-fg-sel-count{font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;white-space:nowrap;min-width:40px;text-align:center}
.wiz8-fg-sel-count--all{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz8-fg-sel-count--partial{background:rgba(212,184,96,0.16);color:#ecd489}
.wiz8-fg-sel-count--none{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz8-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz8-fg-body{padding:12px 14px;display:flex;flex-direction:column;gap:14px}
.wiz8-collapsed{display:none}
.wiz8-hidden,.wiz8-filter-hidden,.wiz8-search-hidden{display:none!important}

/* Risk card */
.wiz8-risk-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:14px 16px}
.wiz8-risk-card[data-relevance="high"]{border-left:3px solid rgba(226,90,88,0.50)}

/* Risk header */
.wiz8-risk-header{display:flex;align-items:center;gap:7px;margin-bottom:10px;flex-wrap:wrap}
.wiz8-risk-cb{flex-shrink:0;accent-color:var(--teal-600,#8ce3c6);width:15px;height:15px;cursor:pointer;margin-top:1px}
.wiz8-risk-icon{display:flex;color:#ec6a68;flex-shrink:0}
.wiz8-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary);flex:1;min-width:140px}
.wiz8-role-badge{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;background:rgba(138,130,235,0.16);color:#bfb8ff;padding:2px 7px;border-radius:4px;white-space:nowrap}

/* Category tag */
.wiz8-cat-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}

/* Count badge (used by reference pane) */
.wiz8-count-badge{font-size:11px;font-weight:600;background:rgba(93,202,165,0.16);color:#8ce3c6;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}

/* Risk list */
.s5-legal-wrap{display:flex;flex-direction:column}
.s5-saved-note{background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:7px;padding:10px 14px;font-size:13px;color:#8cebb0;line-height:1.5;margin:12px 24px 0}
.s5-risk-list{display:flex;flex-direction:column}
.s5-risk-body{display:flex;flex-direction:column;gap:10px}
.s5-prefilter-note{background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:6px;padding:9px 13px;font-size:12px;color:#ecd489;line-height:1.55}
.s5-applies-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:0 0 5px}
.s5-applies-list{margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.s5-applies-list li{font-size:12px;color:var(--color-text-secondary);line-height:1.5;padding:4px 10px 4px 26px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:5px;position:relative}
.s5-applies-list li::before{content:"✓";position:absolute;left:8px;color:#8ce3c6;font-weight:700;font-size:11px;top:5px}
.s5-analog-row{font-size:12px;color:#cfc7b2;line-height:1.5;padding:8px 12px;background:#211d15;border-radius:6px;border:1px solid var(--color-border)}
.s5-answer-row{display:flex;gap:6px;flex-wrap:wrap}
.s5-answer-btn{padding:7px 14px;font-size:12px;font-weight:600;border:1px solid var(--color-border);border-radius:6px;cursor:pointer;background:var(--color-surface);color:var(--color-text-secondary);font-family:inherit;transition:background .12s,border-color .12s}
.s5-answer-btn--yes.s5-answer-btn--active{background:rgba(52,199,120,0.10);border-color:#46c17f;color:#8cebb0}
.s5-answer-btn--partially.s5-answer-btn--active{background:rgba(212,184,96,0.12);border-color:#e0b94a;color:#ecd489}
.s5-answer-btn--no.s5-answer-btn--active{background:#211d15;border-color:#8b8574;color:#b1a992}
.s5-rationale-ta{width:100%;box-sizing:border-box;font-size:12px;font-family:inherit;color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;line-height:1.5;resize:vertical;background:var(--color-bg-subtle,#211d15)}
.s5-rationale-ta:focus{outline:none;border-color:#8ce3c6;background:var(--color-surface)}

/* Step A question block + Step B requirement areas */
.s5-qblock{white-space:pre-wrap;font-size:12px;line-height:1.6;color:var(--color-text-secondary);background:var(--color-bg-subtle,#211d15);border:1px solid var(--color-border);border-radius:6px;padding:9px 12px}
.s5-stepb{display:flex;flex-direction:column;gap:8px;padding-left:2px;border-left:2px solid rgba(93,202,165,0.35);margin-left:1px}
.s5-area-hint{font-size:12px;color:var(--color-text-tertiary);margin:0}
.s5-area-row{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--color-border);border-radius:7px;padding:10px 12px;background:var(--color-surface);cursor:pointer}
.s5-area-row:hover{border-color:rgba(93,202,165,0.45)}
.s5-area-cb{flex-shrink:0;width:16px;height:16px;margin-top:2px;cursor:pointer;accent-color:var(--teal-400,#5dcaa5)}
.s5-area-main{display:flex;flex-direction:column;gap:5px;min-width:0}
.s5-area-name{font-size:12.5px;font-weight:700;color:var(--color-text-primary)}
.s5-area-q{white-space:pre-wrap;font-size:11.5px;line-height:1.55;color:var(--color-text-secondary)}
.s5-area-refs{display:flex;flex-wrap:wrap;gap:5px;margin-top:2px}
.s5-ref-chip{font-size:10.5px;font-weight:600;background:rgba(80,150,225,0.14);color:#a4ccf6;border-radius:5px;padding:2px 7px;white-space:nowrap}
/* Step B — requirement selection */
.s5-stepb-hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.s5-stepb-tools{display:flex;align-items:center;gap:6px;font-size:11.5px}
.s5-sub-label{font-size:11.5px;font-weight:700;color:var(--color-text-secondary);margin:8px 0 2px;padding-left:2px;border-left:2px solid rgba(93,202,165,0.4)}
.s5-req-row{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--color-border);border-radius:7px;padding:9px 12px;background:var(--color-surface);cursor:pointer}
.s5-req-row:hover{border-color:rgba(93,202,165,0.45)}
.s5-req-cb{flex-shrink:0;width:16px;height:16px;margin-top:2px;cursor:pointer;accent-color:var(--teal-400,#5dcaa5)}
.s5-req-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.s5-req-hdr{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.s5-req-name{font-size:12.5px;font-weight:700;color:var(--color-text-primary)}
.s5-req-desc{font-size:11.5px;line-height:1.55;color:var(--color-text-secondary)}
.s5-req-wrap{display:flex;flex-direction:column;gap:6px;border:1px solid transparent;border-radius:8px}
.s5-req-wrap.needs-reason{border-color:rgba(224,150,80,0.55);background:rgba(224,120,80,0.05);padding:2px}
.s5-req-reason{display:flex;flex-direction:column;gap:4px;margin:0 0 4px 28px}
.s5-req-reason-lbl{font-size:11px;font-weight:600;color:#f0b878}
.s5-req-reason-ta{width:100%;box-sizing:border-box;font-size:12px;font-family:inherit;color:var(--color-text-primary);border:1px solid rgba(224,150,80,0.45);border-radius:6px;padding:7px 10px;line-height:1.5;resize:vertical;background:var(--color-surface)}
.s5-req-reason-ta:focus{outline:none;border-color:#e0964f}

/* Challenge cycle */
.s5-challenge-wrap{margin-top:8px}
.s5-challenge-btn{font-size:11.5px;font-weight:600;color:#e0b94a;background:none;border:1px solid rgba(224,150,80,0.45);border-radius:6px;padding:5px 12px;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s}
.s5-challenge-btn:hover{background:rgba(224,150,80,0.10)}
.s5-challenge-btn.is-active{background:rgba(224,120,80,0.14);border-color:#e0964f;color:#f0b878}
.s5-challenge-panel{margin-top:8px;padding:10px 12px;border:1px solid rgba(224,150,80,0.35);border-radius:6px;background:rgba(224,120,80,0.06)}
.s5-challenge-label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#e0b94a;margin:0 0 6px}
.s5-challenge-ta{width:100%;box-sizing:border-box;font-size:12px;font-family:inherit;color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;line-height:1.5;resize:vertical;background:var(--color-surface)}
.s5-challenge-ta:focus{outline:none;border-color:#e0964f}
.s5-challenge-clear{margin-top:6px;font-size:11px;color:var(--color-text-tertiary);background:none;border:none;cursor:pointer;font-family:inherit;text-decoration:underline;padding:0}
.s5-challenge-clear:hover{color:#fba4a3}

/* Wave 1 — consolidated risk list */
.s5-consol-list{display:flex;flex-direction:column;gap:12px}
.s5-src-chip{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.s5-src-chip--legal{background:rgba(80,150,225,0.16);color:#a4ccf6}
.s5-src-chip--nist{background:rgba(93,130,214,0.16);color:#a4ccf6}
.s5-src-chip--internal{background:rgba(212,184,96,0.16);color:#ecd489}
.s5-src-chip--privacy{background:rgba(52,199,120,0.16);color:#8cebb0}
.s5-riskhead{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 10px;padding-top:14px;border-top:1px solid var(--color-border)}
.s5-riskhead-left{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.s5-riskhead-summary{font-size:13px;color:var(--color-text-secondary)}
.s5-riskhead-summary strong{color:var(--color-text-primary)}
.s5-riskhead-excl{color:var(--color-text-tertiary)}
.s5-autosave-hint{font-size:11px;color:var(--color-text-tertiary)}
.s5-saved-flag{font-size:11px;font-weight:600;color:#8cebb0;opacity:0;transform:translateY(-2px);transition:opacity .2s,transform .2s}
.s5-saved-flag.is-on{opacity:1;transform:translateY(0)}
.s5-riskhead-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.s5-riskhead-toggle{font-size:11.5px;font-weight:500;color:var(--teal-600,#8ce3c6);background:none;border:1px solid rgba(93,202,165,0.45);border-radius:6px;padding:5px 10px;cursor:pointer;font-family:inherit}
.s5-riskhead-toggle:hover{background:rgba(93,202,165,0.10)}
.s5-dpia-risk{display:flex;align-items:flex-start;gap:10px;border:1px solid var(--color-border);border-radius:6px;padding:10px 12px;background:var(--color-surface)}
.s5-dpia-risk-txt{font-size:12.5px;line-height:1.5;color:var(--color-text-primary)}
/* Priority tiers */
.s5-group-hdr{display:flex;align-items:center;gap:12px;margin:20px 0 10px;padding:10px 14px;border-radius:8px;border-left:4px solid}
.s5-group-hdr--req{background:rgba(226,90,88,0.08);border-left-color:#e25a58}
.s5-group-hdr--rec{background:var(--color-bg-subtle,#211d15);border-left-color:var(--color-border-mid,#4a4636)}
.s5-group-hdr--excl{background:rgba(224,150,80,0.08);border-left-color:#e0964f}
.s5-excl-approve{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 12px;padding:11px 14px;border:1px solid rgba(224,150,80,0.4);border-radius:8px;background:rgba(224,120,80,0.06)}
.s5-excl-approve.is-approved{border-color:rgba(52,199,120,0.45);background:rgba(52,199,120,0.07)}
.s5-excl-approve-row{display:flex;align-items:flex-start;gap:9px;cursor:pointer;min-width:0}
.s5-excl-approve-cb{flex-shrink:0;width:16px;height:16px;margin-top:1px;cursor:pointer;accent-color:var(--teal-400,#5dcaa5)}
.s5-excl-approve-txt{font-size:12.5px;line-height:1.5;color:var(--color-text-primary)}
.s5-excl-approve-status{font-size:11.5px;font-weight:700;white-space:nowrap;flex-shrink:0}
.s5-excl-approve-status.is-ok{color:#8cebb0}
.s5-excl-approve-status.is-warn{color:#f0b878}
.s5-group-hdr--btn{cursor:pointer;user-select:none}
.s5-group-hdr--btn:hover{filter:brightness(1.04)}
.s5-group-main{flex:1;min-width:0}
.s5-group-title{font-size:13.5px;font-weight:700;color:var(--color-text-primary);display:flex;align-items:center;gap:8px}
.s5-group-count{font-size:11px;font-weight:700;padding:1px 9px;border-radius:10px;background:rgba(255,255,255,0.08);color:var(--color-text-secondary)}
.s5-group-sub{font-size:11.5px;color:var(--color-text-tertiary);line-height:1.5;margin:3px 0 0}
.s5-group-chev{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
.s5-req-badge{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:9px;background:rgba(226,90,88,0.18);color:#fba4a3;white-space:nowrap;flex-shrink:0}
.s5-empty-note{font-size:12.5px;color:var(--color-text-secondary);background:var(--color-bg-subtle,#211d15);border:1px solid var(--color-border);border-radius:6px;padding:12px 14px;margin:6px 0}
.s5-rec-check{width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:var(--teal-400,#5dcaa5)}
.s5-recbulk{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:10px 12px;border:1px dashed var(--color-border-mid,var(--color-border));border-radius:8px;background:var(--color-bg-subtle,#211d15)}
.s5-recbulk-sel{display:flex;align-items:center;gap:6px;font-size:11.5px}
.s5-recbulk-link{background:none;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:600;color:var(--teal-600,#8ce3c6);padding:0}
.s5-recbulk-link:hover{text-decoration:underline}
.s5-recbulk-reason{flex:1;min-width:200px;padding:7px 10px;border:1px solid var(--color-border-mid,var(--color-border));border-radius:6px;font-size:12px;font-family:inherit;color:var(--color-text-primary);background:var(--color-surface)}
.s5-recbulk-reason:focus{outline:none;border-color:var(--teal-400,#2dd4bf)}

/* Reference pane */
.wiz8-cat-legend{display:flex;flex-direction:column;gap:8px;margin-bottom:20px}
.wiz8-cat-legend-item{display:flex;align-items:flex-start;gap:10px}
.wiz8-cat-legend-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.5}
.wiz8-ref-fg{margin-bottom:28px}
.wiz8-ref-fg-header{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:6px;border-bottom:2px solid var(--color-border)}
.wiz8-ref-fg-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz8-ref-risk{margin-bottom:12px;padding-left:12px;border-left:3px solid rgba(226,90,88,0.40)}
.wiz8-ref-risk-header{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap}
.wiz8-ref-risk-name{font-size:12px;font-weight:700;color:#fba4a3;margin:0}
.wiz8-ref-analog{font-size:11px;color:var(--color-text-secondary);margin:0;line-height:1.55;font-style:italic}

/* ---- Source badges ---- */
.wiz8-diag-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;line-height:1.4}
.wiz8-diag-src-badge--eu{background:rgba(80,150,225,0.16);color:#a4ccf6}

/* ---- Legal pane ---- */

/* ---- Combined Review pane ---- */
.wiz8-review-sec{border:1px solid var(--color-border);border-radius:8px;padding:16px 18px;margin-bottom:16px}
.wiz8-review-sec-hdr{display:flex;align-items:center;justify-content:flex-end;margin-bottom:6px}
.wiz8-review-status{font-size:11px;font-weight:700;padding:3px 9px;border-radius:10px;white-space:nowrap}
.wiz8-review-status--done{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz8-review-status--pending{background:rgba(212,184,96,0.16);color:#ecd489}
.wiz8-review-sec-sub{font-size:12px;color:var(--color-text-secondary);line-height:1.55;margin:0 0 12px;font-style:italic}
.wiz8-review-empty{font-size:13px;color:var(--color-text-tertiary);padding:8px 0;margin:0}
.wiz8-review-stats{display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap}
.wiz8-review-risk-list{display:flex;flex-direction:column;gap:5px}
.wiz8-review-risk-row{display:flex;align-items:center;gap:7px;padding:5px 8px;background:var(--color-bg-subtle,#211d15);border-radius:5px;flex-wrap:wrap}
.wiz8-review-risk-name{font-size:12px;font-weight:600;color:var(--color-text-primary);flex:1;min-width:120px}
.wiz8-review-risk-icon--tech{font-size:14px;color:#8ce3c6;flex-shrink:0}
.wiz8-review-risk-icon--legal{font-size:14px;color:#a4ccf6;flex-shrink:0}
.wiz8-review-partial-badge{font-size:10px;font-weight:700;background:rgba(212,184,96,0.16);color:#ecd489;padding:1px 7px;border-radius:8px;white-space:nowrap;flex-shrink:0}
.wiz8-review-gate{margin-top:20px}
.wiz8-review-warn{background:rgba(212,184,96,0.12);border:1px solid rgba(212,184,96,0.40);border-radius:7px;padding:12px 16px;font-size:13px;color:#ecd489;line-height:1.6}
.wiz8-review-complete{background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:7px;padding:12px 16px;font-size:13px;color:#8cebb0;line-height:1.6}

/* Pre-filter styles (Step 3 classification → legal risk filtering) */
.wiz8-q-card--prefiltered{opacity:.75;border-left:3px solid rgba(224,120,80,0.40)}
.wiz8-prefilter-note{background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:6px;padding:9px 13px;font-size:12px;color:#ecd489;line-height:1.55;margin-bottom:14px}
.wiz8-prefilter-summary{background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:6px;padding:10px 14px;font-size:12px;color:#ecd489;line-height:1.6;margin-bottom:10px}
.wiz8-prefilter-list{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
.wiz8-prefilter-item{display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--color-surface);border:1px solid rgba(224,120,80,0.40);border-radius:5px;flex-wrap:wrap}
.wiz8-prefilter-risk-name{font-size:12px;font-weight:600;color:var(--color-text-primary);flex:1;min-width:0}
.wiz8-prefilter-art-tag{font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px;background:rgba(224,120,80,0.16);color:#f3ab8a;white-space:nowrap}

/* Ask your AI tool collapsible */
.s5-ai-section{margin:16px 24px;border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.s5-ai-header{padding:12px 16px;background:var(--teal-50,rgba(93,202,165,0.10));cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;gap:12px}
.s5-ai-header:hover{background:var(--teal-100,rgba(93,202,165,0.16))}
.s5-ai-header-left{flex:1}
.s5-ai-header-left .section-label{margin-bottom:0}
.s5-ai-header-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
.s5-ai-body{padding:14px 16px;border-top:1px solid var(--color-border)}
.s5-ai-chevron{display:flex;align-items:center;color:var(--color-text-tertiary);transition:transform .2s}
.s5-ai-instructions{font-size:12px;color:var(--color-text-secondary);background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:12px 14px;margin-bottom:14px;line-height:1.6}
.s5-prompt-wrap{display:flex;flex-direction:column;gap:8px}
.s5-prompt-area{width:100%;padding:12px;border:1px solid var(--color-border-mid);border-radius:6px;font-size:11px;font-family:var(--font-mono,monospace);color:var(--color-text-secondary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.6}
    `);
  }

})();
