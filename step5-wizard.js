/* Step 5 — Risk Assessment Wizard (Guided)
   Data sources: tbl_Risks.json, tbl_Risk_Controls.json, tbl_AI_Articles.json
   Guidance (analogues, applies-if, relevance, categories) loaded from step8-legal-risk-guidance.json.
   Selection at risk level. Identity from central _meta.
   Informed by Step 3 (RCN filter + relevance) and Step 7 (DPIA data types + relevance).
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _legalGuidance = null, _record = null;
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
    complete:   false
  };

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
  window.mountStep5Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _legalGuidance  = null;
    _record         = null;
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
    const [risksRes, ctrlsRes, artsRes, lgdRes] = await Promise.allSettled([
      fetch('tbl_Risks.json'),
      fetch('tbl_Risk_Controls.json'),
      fetch('tbl_AI_Articles.json'),
      fetch('step8-legal-risk-guidance.json'),
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

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

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
      const wqs = _legalGuidance?.wizard_questions;
      if (wqs && Object.keys(_wizState.answers).length >= wqs.length) {
        _wizState.complete = true;
      }
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
    const strip = _el('div', 'wiz-tab-strip');
    [['legal', 'Legal/Regulatory Risk Assessment'], ['review', 'Review'], ['reference', 'Reference']].forEach(([id, lbl], i) => {
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

  function _buildStep5Prompt() {
    return `You are an AI governance specialist completing a Risk Assessment (Step 5) and Control Identification (Step 6) for an AI use case that has already been classified and had a DPIA completed.

CONTEXT — paste the full Stage 1 report (classification and DPIA) below this line, then run the prompt:

[PASTE STAGE 1 REPORT HERE]

---

Using the classification and DPIA above as your context, produce a structured risk assessment and control schedule. For every risk answer YES or PARTIALLY and explain the specific scenario. For every risk answered NO briefly state why it does not apply. Use the "This risk applies if any of the following are true" criteria to guide your assessment.

OUTPUT FORMAT: Use the section headers exactly as shown. Label every answer "Answer:" and every explanation "Reasoning:". At the very end, output the JSON summary block exactly as specified.

===================================================================
PART 1 — RISK ASSESSMENT (Step 5)
===================================================================

For each risk below: Answer YES, PARTIALLY, or NO. Then provide Reasoning (2–4 sentences), list the specific Attack vectors relevant to this use case, and rate the Severity as Low, Medium, or High.

---

R01 — Human Oversight Bypass Failure  [Human Control]
This risk applies if any of the following are true:
  • AI output is used to make or significantly influence decisions without a mandatory human review step
  • Users have no mechanism to override, halt, or contest AI-driven actions
  • The AI system provides no confidence indicator or explanation alongside its outputs

Question: Does the AI system make or significantly influence decisions without a mandatory human review or override step?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R02 — Subgroup Coverage Failure  [Bias & Fairness]
This risk applies if any of the following are true:
  • The AI system processes data about or makes decisions that affect distinct groups of people (by age, gender, ethnicity, disability, or other protected characteristic)
  • Training data was collected over a period or from a source where certain groups may have been underrepresented
  • The AI system's outputs affect employment, credit, benefits, healthcare access, or other individually significant decisions

Question: Does the AI system process data about, or make decisions that affect, people from distinct demographic or protected groups?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R03 — Proxy Discrimination Propagation Failure  [Bias & Fairness]
This risk applies if any of the following are true:
  • The AI uses data variables that may correlate with protected characteristics (e.g. location, purchasing patterns, social connections)
  • The AI ranks, scores, or filters individuals for employment, credit, insurance, benefits, or similar consequential decisions
  • Historical decisions are used as training labels and may embed past discriminatory patterns

Question: Does the AI use input variables — such as location, purchasing history, or social network data — that could act as proxies for protected characteristics?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R04 — Dataset Lifecycle Integrity Failure  [Data Integrity]
This risk applies if any of the following are true:
  • The AI model is periodically retrained or fine-tuned on updated data
  • The system's knowledge base (RAG pipeline) is refreshed with new documents or data feeds
  • Third-party or externally sourced datasets are ingested without formal versioning and validation

Question: Are formal controls in place governing the collection, labelling, versioning, and retirement of all training datasets?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R05 — Data Governance Documentation Failure  [Data Integrity]
This risk applies if any of the following are true:
  • The AI system uses training or retrieval data whose selection rationale, legal permission, and preparation history are not formally documented
  • The organisation cannot trace which datasets were used, when they were collected, or why they were selected — meaning it cannot produce this evidence to a regulator examining Art.10(2) or Art.11/Annex IV compliance
  • Multiple data sources are combined without a documented provenance chain that records origin, transformation steps, and legal basis for each source

Question: Is the data lineage, schema, and quality thresholds for all training data formally documented and maintained?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R06 — Data Quality Measurement Failure  [Data Integrity]
This risk applies if any of the following are true:
  • The AI system's outputs depend directly on the quality and completeness of input data
  • No formal data quality metrics, thresholds, or validation rules are applied before data is used
  • Errors in input data would propagate into AI-driven decisions without triggering an alert or rejection

Question: Is the quality, completeness, and representativeness of training data regularly measured and reported against defined thresholds?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R07 — Audit Log Integrity Failure  [Monitoring & Audit]
This risk applies if any of the following are true:
  • The AI system is subject to regulatory logging requirements (EU AI Act Art.12, GDPR Art.5(1)(f), internal compliance policy)
  • Audit trails are required to reconstruct or justify AI decisions in the event of a complaint, legal challenge, or regulatory review
  • AI decision logs are stored in a system where they could be modified, deleted, or are not protected from tampering

Question: Does the AI system generate comprehensive, tamper-evident audit logs of its decisions, inputs, and actions?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R08 — Log Retention Violation  [Monitoring & Audit]
This risk applies if any of the following are true:
  • The AI system's operational logs are subject to a defined minimum retention period (regulatory, contractual, or internal policy)
  • Logs are stored in systems with automatic deletion, rolling overwrite, or size-based truncation that could violate retention requirements
  • Historical AI decision logs may be required for regulatory audit, data subject requests, or post-incident investigation

Question: Are AI system logs retained for the full period required by applicable regulations, internal policies, or contractual obligations?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R09 — Adversarial Input Evasion Failure  [Cybersecurity]
This risk applies if any of the following are true:
  • The AI system accepts natural language or structured input directly from users (prompt injection risk)
  • The system is exposed to potentially adversarial, untrusted, or external users or data sources
  • Security controls rely on the AI model itself to detect and reject malicious inputs rather than a separate validation layer

Question: Does the AI system accept external or user-supplied inputs that directly influence its predictions or decisions?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R10 — Unauthorised Access and Privilege Escalation Failure  [Access Control]
This risk applies if any of the following are true:
  • The AI system stores sensitive data (training data, personal data, model weights, inference logs) requiring formal access controls
  • Multiple users, teams, or automated systems have access to the AI infrastructure with different privilege levels
  • Access to the AI model, its data, or its configuration is not governed by a documented and enforced IAM policy

Question: Are role-based access controls in place limiting who can query, modify, retrain, or administer the AI system?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R11 — Cyber Attack Detection Failure  [Cybersecurity]
This risk applies if any of the following are true:
  • The AI system processes sensitive or personal data that could be targeted for exfiltration via query manipulation
  • Prompt injection or adversarial inputs could manipulate AI outputs to bypass controls or leak information
  • No automated monitoring exists to detect unusual query volumes, anomalous output patterns, or potential AI-layer attacks

Question: Does the AI system have monitoring controls to detect anomalous query patterns, unusual output behaviour, or attempted intrusions?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R12 — Accuracy Measurement and Drift Failure  [Performance Integrity]
This risk applies if any of the following are true:
  • The AI system makes consequential decisions that depend on maintaining a defined level of accuracy or performance
  • The system is deployed in an environment where the characteristics of input data may evolve over time
  • No baseline accuracy metric, monitoring threshold, or automated drift detection alert has been defined

Question: Is the AI system's accuracy formally measured at deployment and monitored on an ongoing basis for model drift or degradation?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R13 — Feedback Loop Contamination Failure  [Performance Integrity]
This risk applies if any of the following are true:
  • The AI system learns from, adapts to, or is retrained using user interactions, feedback, or behavioural signals
  • The system is periodically retrained on data that includes outputs previously generated by the AI itself
  • Errors or biases in current AI outputs could become embedded as ground truth in future training data

Question: Does the AI system use its own historical outputs — directly or indirectly — as future training or reinforcement data?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R14 — Output Reproducibility Failure  [Performance Integrity]
This risk applies if any of the following are true:
  • AI-generated outputs must be reproducible for regulatory audit, legal proceedings, or compliance review
  • Identical or equivalent inputs should produce consistent results for legal, contractual, or risk management reasons
  • Post-incident investigation requires the ability to reconstruct and replay a specific AI decision or output

Question: Is reproducibility required for this system — must the same input reliably produce the same output across runs and environments?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R15 — Input Corruption Propagation Failure  [Performance Integrity]
This risk applies if any of the following are true:
  • The AI system ingests real-time or externally sourced data feeds that could be corrupted, incomplete, or manipulated
  • No validation or sanity-check gate exists between data ingestion and AI processing
  • Corrupted or anomalous inputs would propagate directly into AI outputs without triggering an alert or rejection

Question: Could corrupted, spoofed, or low-quality data reach the model without detection by an upstream validation or anomaly-detection layer?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R16 — Fail-Safe Activation Failure  [Availability & Resilience]
This risk applies if any of the following are true:
  • The AI system is relied upon for time-sensitive or operationally critical functions where failure causes direct harm
  • A system fault would leave users, staff, or affected individuals without a safe fallback or manual alternative
  • No defined safe-state, limited-functionality mode, or emergency halt mechanism has been designed and tested

Question: Is a fail-safe or fallback mode defined and tested for when the AI system becomes unavailable or produces outputs below an acceptable confidence threshold?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R17 — AI Disclosure Mechanism Failure  [Transparency]
This risk applies if any of the following are true:
  • The AI system interacts directly with members of the public, customers, or employees in a way that could be mistaken for human interaction
  • AI-generated content is published, distributed, or used to inform decisions without labelling or attribution
  • The EU AI Act Art.50 transparency obligations apply to this system's output or interaction modality

Question: Are users or individuals affected by the system's outputs notified that they are interacting with, or being assessed by, an AI system?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R18 — Deployer Instructions and Intended Use Failure  [Documentation & Transparency]
This risk applies if any of the following are true:
  • The AI system has not produced formal instructions documenting its intended purpose and the specific tasks it is designed to perform
  • Known limitations, failure modes, or scenarios in which the AI should not be used are not documented and provided to deployers
  • Deployers cannot access documented information on what human oversight measures, technical configurations, or competence requirements are needed to operate the system safely
  • Performance data, accuracy levels, and the metrics used to measure them are not declared in the documentation provided to deployers

Question: Has the organisation produced formal instructions for deployers that document the system's intended purpose, known limitations, required oversight measures, and achieved performance levels?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

R19 — Quality Management System Conformity Failure  [Governance & Compliance]
This risk applies if any of the following are true:
  • The organisation does not have a documented QMS covering the AI system's full lifecycle from design through post-market monitoring
  • There are no documented roles and responsibilities for AI safety and compliance within the organisation
  • Design changes, model updates, or changes to retrieval data are not subject to a formal change control or impact assessment process
  • There is no formal incident reporting process, or reported incidents are not reviewed and acted upon within defined timeframes
  • Post-market monitoring data is not collected, reviewed, or used to trigger corrective actions

Question: Does the organisation have a documented Quality Management System (QMS) covering AI design controls, change management, post-market monitoring, and incident reporting for this AI system?
Answer (YES / PARTIALLY / NO):
Reasoning:
Attack vectors:
Severity (Low / Medium / High):

---

OVERALL RISK LEVEL
State the overall risk level: Low / Medium / High / Very High
Overall risk level:
Reasoning (reference the highest-severity risks driving this rating):

===================================================================
PART 2 — CONTROL IDENTIFICATION (Step 6)
===================================================================

For each risk rated YES or PARTIALLY, define the controls required. For each control provide:
  • Control type: Technical | Operational | Contractual | Governance
  • Control description: what specifically must be implemented
  • Owner: who is responsible for implementing and maintaining this control
  • Verification method: how compliance will be confirmed

List controls grouped by risk, using the risk reference number (R01, R02, etc.):

===================================================================
PART 3 — DISCLOSURE FRAMEWORK (complete only if Article 50 applies)
===================================================================

  • Disclaimer text to display to users at the point of AI interaction:
  • Internal content labelling standard (how AI-generated content is marked in documents):
  • Version control approach (how AI-assisted documents are tracked):

===================================================================
RISK ASSESSMENT SUMMARY (JSON) — output this block exactly at the end
===================================================================

--- RISK ASSESSMENT SUMMARY (JSON) ---
{
  "risks": {
    "R01_Human_Oversight_Bypass_Failure": "yes or partially or no",
    "R02_Subgroup_Coverage_Failure": "yes or partially or no",
    "R03_Proxy_Discrimination_Propagation_Failure": "yes or partially or no",
    "R04_Dataset_Lifecycle_Integrity_Failure": "yes or partially or no",
    "R05_Data_Governance_Documentation_Failure": "yes or partially or no",
    "R06_Data_Quality_Measurement_Failure": "yes or partially or no",
    "R07_Audit_Log_Integrity_Failure": "yes or partially or no",
    "R08_Log_Retention_Violation": "yes or partially or no",
    "R09_Adversarial_Input_Evasion_Failure": "yes or partially or no",
    "R10_Unauthorised_Access_and_Privilege_Escalation_Failure": "yes or partially or no",
    "R11_Cyber_Attack_Detection_Failure": "yes or partially or no",
    "R12_Accuracy_Measurement_and_Drift_Failure": "yes or partially or no",
    "R13_Feedback_Loop_Contamination_Failure": "yes or partially or no",
    "R14_Output_Reproducibility_Failure": "yes or partially or no",
    "R15_Input_Corruption_Propagation_Failure": "yes or partially or no",
    "R16_Fail_Safe_Activation_Failure": "yes or partially or no",
    "R17_AI_Disclosure_Mechanism_Failure": "yes or partially or no",
    "R18_Deployer_Instructions_and_Intended_Use_Failure": "yes or partially or no",
    "R19_Quality_Management_System_Conformity_Failure": "yes or partially or no"
  },
  "overall_risk_level": "Low or Medium or High or Very High",
  "article_50_disclosure_required": true or false,
  "human_review_checkpoint_required": true or false,
  "controls_identified": ["list", "key", "control", "names"]
}
--- END RISK ASSESSMENT SUMMARY ---`;

{
  "report_metadata": {
    "report_type": "Risk_Assessment_and_Control_Schedule",
    "steps_covered": ["step_5", "step_6"],
    "regulation": "EU AI Act (Regulation EU 2024/1689) + ISO/IEC 42001",
    "generated_by": "JAKE — on-premise AI assistant",
    "generated_at": "[INSERT ISO 8601 TIMESTAMP]"
  },
  "part_1_risk_assessment": {
    "R01_Human_Oversight_Bypass_Failure": {
      "category": "Human Control",
      "question": "Does the AI system make or significantly influence decisions without a mandatory human review or override step?",
      "applies_if_any": [
        "AI output is used to make or significantly influence decisions without a mandatory human review step",
        "Users have no mechanism to override, halt, or contest AI-driven actions",
        "The AI system provides no confidence indicator or explanation alongside its outputs"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R02_Subgroup_Coverage_Failure": {
      "category": "Bias & Fairness",
      "question": "Does the AI system process data about, or make decisions that affect, people from distinct demographic or protected groups (age, gender, ethnicity, disability, etc.)?",
      "applies_if_any": [
        "The AI system processes data about or makes decisions that affect distinct groups of people (by age, gender, ethnicity, disability, or other protected characteristic)",
        "Training data was collected over a period or from a source where certain groups may have been underrepresented",
        "The AI system's outputs affect employment, credit, benefits, healthcare access, or other individually significant decisions"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R03_Proxy_Discrimination_Propagation_Failure": {
      "category": "Bias & Fairness",
      "question": "Does the AI use input variables — such as location, purchasing history, or social network data — that could act as proxies for protected characteristics?",
      "applies_if_any": [
        "The AI uses data variables that may correlate with protected characteristics (e.g. location, purchasing patterns, social connections)",
        "The AI ranks, scores, or filters individuals for employment, credit, insurance, benefits, or similar consequential decisions",
        "Historical decisions are used as training labels and may embed past discriminatory patterns"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R04_Dataset_Lifecycle_Integrity_Failure": {
      "category": "Data Integrity",
      "question": "Are formal controls in place governing the collection, labelling, versioning, and retirement of all training datasets?",
      "applies_if_any": [
        "The AI model is periodically retrained or fine-tuned on updated data",
        "The system's knowledge base (RAG pipeline) is refreshed with new documents or data feeds",
        "Third-party or externally sourced datasets are ingested without formal versioning and validation"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R05_Data_Governance_Documentation_Failure": {
      "category": "Data Integrity",
      "question": "Is the data lineage, schema, and quality thresholds for all training data formally documented and maintained?",
      "applies_if_any": [
        "The AI system uses training or retrieval data whose selection rationale, legal permission, and preparation history are not formally documented",
        "The organisation cannot trace which datasets were used, when they were collected, or why they were selected — meaning it cannot produce this evidence to a regulator examining Art.10(2) or Art.11/Annex IV compliance",
        "Multiple data sources are combined without a documented provenance chain that records origin, transformation steps, and legal basis for each source"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R06_Data_Quality_Measurement_Failure": {
      "category": "Data Integrity",
      "question": "Is the quality, completeness, and representativeness of training data regularly measured and reported against defined thresholds?",
      "applies_if_any": [
        "The AI system's outputs depend directly on the quality and completeness of input data",
        "No formal data quality metrics, thresholds, or validation rules are applied before data is used",
        "Errors in input data would propagate into AI-driven decisions without triggering an alert or rejection"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R07_Audit_Log_Integrity_Failure": {
      "category": "Monitoring & Audit",
      "question": "Does the AI system generate comprehensive, tamper-evident audit logs of its decisions, inputs, and actions?",
      "applies_if_any": [
        "The AI system is subject to regulatory logging requirements (EU AI Act Art.12, GDPR Art.5(1)(f) accountability obligations, internal compliance policy)",
        "Audit trails are required to reconstruct or justify AI decisions in the event of a complaint, legal challenge, or regulatory review",
        "AI decision logs are stored in a system where they could be modified, deleted, or are not protected from tampering"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R08_Log_Retention_Violation": {
      "category": "Monitoring & Audit",
      "question": "Are AI system logs retained for the full period required by applicable regulations, internal policies, or contractual obligations?",
      "applies_if_any": [
        "The AI system's operational logs are subject to a defined minimum retention period (regulatory, contractual, or internal policy)",
        "Logs are stored in systems with automatic deletion, rolling overwrite, or size-based truncation that could violate retention requirements",
        "Historical AI decision logs may be required for regulatory audit, data subject requests, or post-incident investigation"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R09_Adversarial_Input_Evasion_Failure": {
      "category": "Cybersecurity",
      "question": "Does the AI system accept external or user-supplied inputs that directly influence its predictions or decisions?",
      "applies_if_any": [
        "The AI system accepts natural language or structured input directly from users (prompt injection risk)",
        "The system is exposed to potentially adversarial, untrusted, or external users or data sources",
        "Security controls rely on the AI model itself to detect and reject malicious inputs rather than a separate validation layer"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R10_Unauthorised_Access_and_Privilege_Escalation_Failure": {
      "category": "Access Control",
      "question": "Are role-based access controls in place limiting who can query, modify, retrain, or administer the AI system?",
      "applies_if_any": [
        "The AI system stores sensitive data (training data, personal data, model weights, inference logs) requiring formal access controls",
        "Multiple users, teams, or automated systems have access to the AI infrastructure with different privilege levels",
        "Access to the AI model, its data, or its configuration is not governed by a documented and enforced IAM policy"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R11_Cyber_Attack_Detection_Failure": {
      "category": "Cybersecurity",
      "question": "Does the AI system have monitoring controls to detect anomalous query patterns, unusual output behaviour, or attempted intrusions?",
      "applies_if_any": [
        "The AI system processes sensitive or personal data that could be targeted for exfiltration via query manipulation",
        "Prompt injection or adversarial inputs could manipulate AI outputs to bypass controls or leak information",
        "No automated monitoring exists to detect unusual query volumes, anomalous output patterns, or potential AI-layer attacks"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R12_Accuracy_Measurement_and_Drift_Failure": {
      "category": "Performance Integrity",
      "question": "Is the AI system's accuracy formally measured at deployment and monitored on an ongoing basis for model drift or degradation?",
      "applies_if_any": [
        "The AI system makes consequential decisions that depend on maintaining a defined level of accuracy or performance",
        "The system is deployed in an environment where the characteristics of input data may evolve over time",
        "No baseline accuracy metric, monitoring threshold, or automated drift detection alert has been defined"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R13_Feedback_Loop_Contamination_Failure": {
      "category": "Performance Integrity",
      "question": "Does the AI system use its own historical outputs — directly or indirectly — as future training or reinforcement data?",
      "applies_if_any": [
        "The AI system learns from, adapts to, or is retrained using user interactions, feedback, or behavioural signals",
        "The system is periodically retrained on data that includes outputs previously generated by the AI itself",
        "Errors or biases in current AI outputs could become embedded as ground truth in future training data"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R14_Output_Reproducibility_Failure": {
      "category": "Performance Integrity",
      "question": "Is reproducibility required for this system — must the same input reliably produce the same output across runs and environments?",
      "applies_if_any": [
        "AI-generated outputs must be reproducible for regulatory audit, legal proceedings, or compliance review",
        "Identical or equivalent inputs should produce consistent results for legal, contractual, or risk management reasons",
        "Post-incident investigation requires the ability to reconstruct and replay a specific AI decision or output"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R15_Input_Corruption_Propagation_Failure": {
      "category": "Performance Integrity",
      "question": "Could corrupted, spoofed, or low-quality data reach the model without detection by an upstream validation or anomaly-detection layer?",
      "applies_if_any": [
        "The AI system ingests real-time or externally sourced data feeds that could be corrupted, incomplete, or manipulated",
        "No validation or sanity-check gate exists between data ingestion and AI processing",
        "Corrupted or anomalous inputs would propagate directly into AI outputs without triggering an alert or rejection"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R16_Fail_Safe_Activation_Failure": {
      "category": "Availability & Resilience",
      "question": "Is a fail-safe or fallback mode defined and tested for when the AI system becomes unavailable or produces outputs below an acceptable confidence threshold?",
      "applies_if_any": [
        "The AI system is relied upon for time-sensitive or operationally critical functions where failure causes direct harm",
        "A system fault would leave users, staff, or affected individuals without a safe fallback or manual alternative",
        "No defined safe-state, limited-functionality mode, or emergency halt mechanism has been designed and tested"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R17_AI_Disclosure_Mechanism_Failure": {
      "category": "Transparency",
      "question": "Are users or individuals affected by the system's outputs notified that they are interacting with, or being assessed by, an AI system?",
      "applies_if_any": [
        "The AI system interacts directly with members of the public, customers, or employees in a way that could be mistaken for human interaction",
        "AI-generated content is published, distributed, or used to inform decisions without labelling or attribution",
        "The EU AI Act Art.50 transparency obligations apply to this system's output or interaction modality"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R18_Deployer_Instructions_and_Intended_Use_Failure": {
      "category": "Documentation & Transparency",
      "question": "Has the organisation produced formal instructions for deployers that document the system's intended purpose, known limitations, required oversight measures, and achieved performance levels?",
      "applies_if_any": [
        "The AI system has not produced formal instructions documenting its intended purpose and the specific tasks it is designed to perform",
        "Known limitations, failure modes, or scenarios in which the AI should not be used are not documented and provided to deployers",
        "Deployers cannot access documented information on what human oversight measures, technical configurations, or competence requirements are needed to operate the system safely",
        "Performance data, accuracy levels, and the metrics used to measure them are not declared in the documentation provided to deployers"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    },
    "R19_Quality_Management_System_Conformity_Failure": {
      "category": "Governance & Compliance",
      "question": "Does the organisation have a documented Quality Management System (QMS) covering AI design controls, change management, post-market monitoring, and incident reporting for this AI system?",
      "applies_if_any": [
        "The organisation does not have a documented QMS covering the AI system's full lifecycle from design through post-market monitoring",
        "There are no documented roles and responsibilities for AI safety and compliance within the organisation",
        "Design changes, model updates, or changes to retrieval data are not subject to a formal change control or impact assessment process",
        "There is no formal incident reporting process, or reported incidents are not reviewed and acted upon within defined timeframes",
        "Post-market monitoring data is not collected, reviewed, or used to trigger corrective actions"
      ],
      "answer": "yes | partially | no",
      "reasoning": "",
      "severity": "Low | Medium | High",
      "attack_vectors": [],
      "controls": []
    }
  },
  "part_2_disclosure_framework": {
    "note": "Complete this section only if article_50_applies is true in the Stage 1 JSON",
    "disclaimer_text_for_users": "",
    "internal_content_labelling_standard": "",
    "version_control_approach": ""
  },
  "risk_assessment_summary": {
    "overall_risk_level": "Low | Medium | High | Very High",
    "overall_risk_reasoning": "",
    "risks_confirmed_yes": [],
    "risks_confirmed_partially": [],
    "risks_confirmed_no": [],
    "article_50_disclosure_required": true,
    "human_review_checkpoint_required": true,
    "total_controls_identified": 0
  }
}`;
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
      p.innerHTML = 'No wizard questions defined. Add a <code>wizard_questions</code> array to <strong>step8-legal-risk-guidance.json</strong> to enable guided mode.';
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
    if (!_record['step-5']) _record['step-5'] = {};
    _record['step-5'].legal_assessment = _buildLegalOutputRecord();
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
    title.textContent = 'Risk Assessment Review';
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
    if (document.getElementById('wiz5-styles')) return;
    const s = document.createElement('style');
    s.id = 'wiz5-styles';
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
