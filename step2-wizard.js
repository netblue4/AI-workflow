// step2-wizard.js
// Business Case Documentation — Step 2.
// Captures the business case description and URL, and provides the
// combined Stage 1 "Ask JAKE" prompt for Steps 3 (Classification) and 4 (DPIA).

(function () {
  'use strict';

  let _stylesInjected = false;
  let _state = { business_case: '', business_case_url: '' };
  let _record = {};

  // ── Public API ────────────────────────────────────────────────────────────

  window.mountStep2Wizard = function (container, step, detail, colorKey, phaseTitle) {
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
    return `You are an AI governance specialist completing an EU AI Act system classification and a GDPR Data Protection Impact Assessment (DPIA) for a new AI use case. Your analysis will be saved as a supporting document alongside a formal governance record and must be detailed enough for a DPO and AI Change Board to review.

BUSINESS CASE:
${bc}

---

Analyse the business case above and produce a structured report. For every question provide your answer and a clear explanation of your reasoning (2–4 sentences). Do not skip any question.

===================================================================
PART 1 — SYSTEM CLASSIFICATION (Step 3)
===================================================================

AXIS A — INTERNAL GOVERNANCE TIER

Our standard defines two tiers:
• Tier 1 (General productivity): AI output does not directly and significantly influence business decisions, external communications, or regulated processes. Examples: rewriting internal documents, research, brainstorming, internal drafts not published externally.
• Tier 2 (Business-impacting content): AI output significantly influences decisions or is used in regulated, external-facing, or high-stakes contexts. Examples: marketing documents, legal/compliance documents, financial reports, code development, translation of regulated content.
Escalation rule: If data identification in Step 4 reveals personal, confidential, or Group-identifying data is involved, treat as Tier 2 regardless of content type.

A1: Which governance tier applies to this use case?
Select: Tier 1 — General productivity | Tier 2 — Business-impacting content
Answer:
Reasoning:

---

AXIS B — EU AI ACT CLASSIFICATION (Gates G1–G5)

GATE G1 — PROHIBITED PRACTICES SCREEN (Article 5)
IMPORTANT: If the answer to G1 is YES, classification is PROHIBITED. Assessment ends — do not answer other gates.

G1: Does this AI system involve ANY of the following prohibited practices?
  • Subliminal, manipulative, or deceptive techniques to distort a person's behaviour causing harm (Art.5(1)(a))
  • Exploitation of vulnerable groups (age, disability, socioeconomic situation) to distort behaviour harmfully (Art.5(1)(b))
  • Social scoring of natural persons by public authorities leading to detrimental or disproportionate treatment (Art.5(1)(c))
  • Predicting the risk of a person committing a crime based solely on profiling or personality traits (Art.5(1)(d))
  • Compiling facial recognition databases by untargeted scraping of facial images from the internet or CCTV (Art.5(1)(e))
  • Inferring emotions of natural persons in the workplace or in educational institutions, except for safety or medical reasons (Art.5(1)(f))
  • Biometric categorisation to deduce or infer race, political opinions, trade union membership, religious beliefs, or sexual orientation (Art.5(1)(g))
  • Real-time remote biometric identification in publicly accessible spaces for law enforcement purposes (Art.5(1)(h))

G1 Answer (YES = PROHIBITED and assessment ends / NO = proceed to G2):
Reasoning:

---

GATE G2 — AI SYSTEM DEFINITION CHECK (Article 3(1))
If ANY answer is NO, the system is OUT OF SCOPE of the EU AI Act. Internal governance tier (Axis A) still applies.

G2_Q1: Is the system a machine-based system designed to operate with varying levels of autonomy that may exhibit adaptiveness after deployment? (Art.3(1))
Answer (YES / NO):
Reasoning:

G2_Q2: Are the system's outputs (predictions, recommendations, decisions, or content) intended to influence real or virtual environments? (Art.3(1))
Answer (YES / NO):
Reasoning:

---

GATE G3 — HIGH-RISK CLASSIFICATION — ANNEX III
G3: Does this system fall within ANY of the following Annex III high-risk domains? Answer YES or NO. If YES, identify which domain(s) apply.
  • Biometric identification or categorisation of natural persons (Annex III(1))
  • Management or operation of critical infrastructure — roads, water, gas, heating, electricity (Annex III(2))
  • Education or vocational training — determining access, evaluating students, monitoring during exams (Annex III(3))
  • Employment, workers management, or self-employment — recruitment, promotion, task allocation, performance monitoring (Annex III(4))
  • Eligibility for or assessment of essential private or public services — credit scoring, insurance risk, emergency dispatch, social benefits (Annex III(5))
  • Law enforcement — individual risk assessment, polygraph, crime analytics, evidence reliability evaluation (Annex III(6))
  • Migration, asylum, or border control management — risk assessment, application examination, document verification (Annex III(7))
  • Administration of justice or democratic processes — assisting courts applying law, influencing elections (Annex III(8))

G3 Answer (YES = HIGH RISK / NO = proceed to G4):
If YES — which Annex III domain(s) apply:
Reasoning:

---

GATE G4 — ARTICLE 50 TRANSPARENCY OBLIGATIONS
This gate applies to ALL use cases regardless of G3 outcome.

G4_Q1: Does the system interact directly with natural persons in a conversational or text-based interface (e.g. a chatbot)? (Art.50(1))
Answer (YES / NO):
Reasoning:

G4_Q2: Does the system generate synthetic audio, image, video, or text content that could deceive persons into thinking it is human-generated — e.g. deepfakes? (Art.50(2))
Answer (YES / NO):
Reasoning:

G4_Q3: Does the system generate or manipulate text that is published and could constitute information of public interest — e.g. news articles or public affairs content? (Art.50(3))
Answer (YES / NO):
Reasoning:

---

GATE G5 — ORGANISATION ROLE AND DEPLOYER OBLIGATIONS (Articles 3(4), 3(7), 25, 26)

G5_Q0: How is the organisation using this AI system?
  • Provider: Building or developing it using APIs, open-source models, fine-tuning, or RAG. The organisation is responsible for the AI system's design and behaviour.
  • Deployer: Subscribing to a ready-made third-party AI service (e.g. Microsoft Copilot, Google Workspace AI) largely as provided by the supplier.
Answer (Provider / Deployer):
Reasoning:

Answer G5_Q1 through G5_Q3 only if the system was classified HIGH RISK in G3 AND the organisation is a Deployer. Otherwise mark as Not applicable.

G5_Q1: Is the AI system high-risk and developed by a third-party provider? (Art.26)
Answer (YES / NO / Not applicable):

G5_Q2: Do natural persons in your organisation use the system's outputs to make decisions that affect other natural persons? (Art.26(2))
Answer (YES / NO / Not applicable):

G5_Q3 — Substantial modification check (Art.25). Answer only if Deployer:
Are you fine-tuning or retraining the model on your own data? (Art.25(1))
Answer:
Are you changing the system's intended purpose beyond what the provider designed it for? (Art.25(1))
Answer:
Are you adding retrieval-augmented generation (RAG) using your own proprietary datasets? (Art.25(1))
Answer:
Are you integrating the system as a safety-critical or regulated component in a product? (Art.25(1))
Answer:

---

COMBINED OUTCOME
Based on Axis A and Axis B, select and explain the combined outcome:
  • ISG fast-track (Tier 1 + MINIMAL_RISK)
  • ISG fast-track with Article 50 disclosure (Tier 1 + LIMITED_RISK)
  • Full due diligence — internal governance driver (Tier 2 + MINIMAL_RISK)
  • Full due diligence with Article 50 disclosure (Tier 2 + LIMITED_RISK)
  • Mandatory escalation to Tier 2 — AI Act override (Tier 1 + HIGH_RISK)
  • Full due diligence plus conformity assessment (Tier 2 + HIGH_RISK)

Combined outcome:
AI Change Board approval required (YES / NO):
DPIA required (YES / NO / data identification determines):
Article 14 human oversight legally required (YES / NO):
Article 50 transparency disclosure required (YES / NO):
Reasoning:

===================================================================
PART 2 — DATA IDENTIFICATION AND DPIA (Step 4)
===================================================================

S1 — SYSTEM DESCRIPTION (Art.35(7)(a))

S1_1: Describe what the AI system does with personal data — what it receives, processes, and outputs, including any downstream use of AI output:

S1_2: State the specific purposes for which personal data is processed by or through the AI system (be specific — vague purposes do not satisfy Art.35(7)(a)):

S1_3: Controller / processor relationship:
Select: Organisation is data controller | Organisation is data processor | Joint controllership | Not yet determined
Answer:

S1_4: Vendor / AI provider data processing agreement status:
Select: Yes — DPA signed | In progress | No — required before go-live | Not applicable (no third-party processing)
Answer:

---

S2 — DATA INVENTORY

S2_1: Which categories of data subjects are involved? Select all that apply and explain.
Options: Employees/staff | Customers/clients | Prospective customers | Job applicants | Children (under 18) | Vulnerable adults | Members of the public | Suppliers/contractors | Other | None — no personal data processed
Answer:
Explanation (describe who each selected category refers to in this use case):

S2_2: Which personal data types are likely to be processed? Select all that apply and explain the specific data involved for each type.
Options: Name and contact details | Identity documents | Financial data | Location data | Online identifiers | Behavioural/usage data | Professional/employment data | Communications content | Photographs/images | Voice recordings/transcripts | Inferred/derived data | Other | None
Answer:
Explanation (detail the specific data for each type selected):

S2_3: Estimated volume of data subjects:
Select: Fewer than 100 | 100–1,000 | 1,000–10,000 | 10,000–100,000 | Over 100,000 | Not yet known
Answer:

S2_4: Data retention period (e.g. 90 days / 7 years):
Answer:

---

S3 — SPECIAL CATEGORY DATA (Art.9)

S3_1: Does the system process special category data? Select all that apply.
Options: Racial or ethnic origin | Political opinions | Religious or philosophical beliefs | Trade union membership | Genetic data | Biometric data (for unique identification) | Health/medical data | Sex life or sexual orientation | None — no special category data
Answer:

If special category data is present:
S3_2: Which Art.9(2) condition is relied upon?
Answer:
S3_3: What specific safeguards are in place?
Answer:

If no special category data: Describe any policy controls required to prevent special category data from entering the system:
Answer:

---

S4 — LAWFUL BASIS FOR PROCESSING (Art.6)

S4_1: Primary lawful basis. Select and explain why it applies.
Options: Art.6(1)(a) Consent | Art.6(1)(b) Performance of a contract | Art.6(1)(c) Legal obligation | Art.6(1)(d) Vital interests | Art.6(1)(e) Public task | Art.6(1)(f) Legitimate interests
Answer:
Explanation (justify why this basis applies to this specific use case):

S4_2: If Art.6(1)(f) Legitimate interests is selected — has a Legitimate Interests Assessment (LIA) been completed?
Select: Not required | Yes — LIA completed and documented | In progress | No — required before go-live
Answer:
Explanation (outline the three-part LIA test: purpose, necessity, balancing):

S4_3: Data subject notification mechanism:
Select: Privacy notice updated to include this processing | Specific notice at point of collection | Existing notice already covers this processing | Notice not yet updated — required before go-live | Not applicable
Answer:
Explanation:

---

S5 — AUTOMATED DECISION-MAKING (Art.22)

S5_1: Does the AI system make automated decisions with legal or similarly significant effects on individuals?
Select: No — output is advisory only; human makes all decisions | Partially — AI influences but human reviews every case | Yes — AI directly determines outcomes | Not yet assessed
Answer:
Reasoning:

S5_4: AI system explainability level:
Select: Full explainability — decision factors disclosed | Partial — high-level rationale provided | Black-box — output only, no rationale | Not yet assessed
Answer:

---

S6 — DATA FLOWS AND THIRD PARTIES

S6_1: Is personal data transferred outside the EEA?
Select: No — all processing within EEA | Yes — adequacy decision applies | Yes — Standard Contractual Clauses in place | Yes — Binding Corporate Rules | Yes — transfer mechanism not yet confirmed | Unknown
Answer:

S6_2: List all third parties (including the AI vendor) that receive or process personal data as part of this system:
Answer:

S6_3: Is personal data used to train or fine-tune the AI model?
Select: No — inference only; no training data retained by vendor | Yes — explicit basis obtained | Unknown — vendor contract does not address this | Not applicable
Answer:

---

S9 — NECESSITY AND PROPORTIONALITY (Art.35(7)(b))

S9_1: Could the business purpose be achieved with less personal data or without AI?
Select: No — AI and this level of data are necessary for the stated purpose | Partially — some data could be reduced; mitigation documented | Yes — redesign required before proceeding | Not yet assessed
Answer:

S9_2: Write a proportionality and necessity statement justifying why the scope of personal data processing by the AI system is proportionate to the business purpose:

---

S10 — RISK IDENTIFICATION, CONTROLS AND RATING (Art.35(7)(c))

S10_1: Identify all applicable privacy risks. For each risk selected, explain the specific scenario in the context of this use case.
Options:
  • Unauthorised access to personal data via AI interface
  • Re-identification of pseudonymised data through AI inference
  • AI-generated output revealing personal data inadvertently
  • Bias / discriminatory outcomes affecting protected characteristics
  • Unlawful profiling or scoring of individuals
  • Personal data retained in AI model weights / caches
  • Third-country transfer without adequate safeguards
  • Data subject unaware of AI-driven processing
  • Inaccurate AI output used to make decisions about individuals
  • Vendor data breach or model exfiltration
Answer (list all that apply):
Explanation per risk:

S10_2: Technical security measures in place or planned. Select all that apply.
Options: Encryption at rest | Encryption in transit (TLS 1.2+) | Access controls / role-based access | Multi-factor authentication (MFA) | Audit logging of access and processing | Data masking / pseudonymisation before AI input | Automated anomaly detection | Penetration testing of AI interface | Data loss prevention (DLP) controls | None currently in place
Answer:

S10_3: Describe the data minimisation approach — how personal data is minimised before being input to the AI system:

S10_4: Can personal data be erased from AI model outputs and logs?
Select: Yes — erasure process confirmed with vendor | Partial — logs erased but model weights cannot be adjusted | No — technical limitation prevents erasure | Not assessed
Answer:

S10_5: Inherent privacy risk rating (before controls):
Select: Low | Medium | High | Very High
Answer:
Reasoning (explain what drives this inherent rating):

S10_6: Residual privacy risk rating (after controls):
Select: Low | Medium | High | Very High
Answer:
Reasoning (explain how controls reduce the risk and what residual risk remains):

---

S11 — DPO CONSULTATION (Art.35(2) and Art.36)

S11_1: Has the DPO been consulted?
Select: Yes — DPO reviewed and approved | Yes — DPO noted concerns (documented) | Consultation in progress | No — DPO not required (no DPO designated) | No — not yet consulted
Answer:

S11_3: Is Art.36 supervisory authority prior consultation required?
Select: No — residual risk is acceptable | Yes — Art.36 prior consultation initiated | Under assessment
Answer:
Note: Art.36 consultation is required where residual risk remains High or Very High after mitigation.

===================================================================
OUTPUT FORMAT INSTRUCTIONS
===================================================================

Produce the full narrative report answering every question with Answer: and Reasoning: clearly labelled throughout.

At the very end of your response, output the following block exactly — do not omit it:

--- CLASSIFICATION SUMMARY (JSON) ---
{
  "axis_a": "tier_1 or tier_2",
  "axis_b_outcome": "PROHIBITED or OUT_OF_SCOPE or HIGH_RISK or LIMITED_RISK or MINIMAL_RISK",
  "organisation_role": "provider or deployer",
  "article_50_applies": true or false,
  "combined_outcome": "label from the combined outcome matrix",
  "change_board_required": true or false,
  "data_subjects": ["list", "applicable", "categories"],
  "personal_data_types": ["list", "applicable", "types"],
  "special_category_data": "none or list types",
  "lawful_basis": "Art.6(1)(?) — description",
  "automated_decision_making": "no — advisory only or partial or yes — determinative",
  "dpia_inherent_risk": "Low or Medium or High or Very High",
  "dpia_residual_risk": "Low or Medium or High or Very High",
  "dpo_consultation_required": true or false,
  "art36_consultation_required": true or false
}
--- END CLASSIFICATION SUMMARY ---`;
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
