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
    return `You are an AI governance specialist. Output ONLY valid JSON — no text, explanation, or markdown before or after the JSON object. Do not wrap the output in a code block. Fill in every "answer" and "reasoning" field in the template below based on the business case provided. Use the allowed values shown in each "answer" field (select the single most appropriate value and replace the placeholder). Write 2–4 sentences in every "reasoning" field. Do not leave any field empty.

BUSINESS CASE:
${bc}

OUTPUT THE FOLLOWING JSON OBJECT WITH ALL FIELDS COMPLETED:

{
  "report_metadata": {
    "report_type": "AI_Classification_and_DPIA",
    "steps_covered": ["step_3", "step_4"],
    "regulation": "EU AI Act (Regulation EU 2024/1689) + GDPR Art.35",
    "generated_by": "JAKE — on-premise AI assistant",
    "generated_at": "[INSERT ISO 8601 TIMESTAMP]"
  },
  "part_1_system_classification": {
    "axis_a_governance_tier": {
      "answer": "tier_1 — General productivity | tier_2 — Business-impacting content",
      "tier_label": "",
      "reasoning": ""
    },
    "axis_b_eu_ai_act": {
      "g1_prohibited_practices": {
        "question": "Does this AI system involve any prohibited practice under Art.5 EU AI Act (subliminal manipulation, vulnerable-group exploitation, social scoring, crime prediction by profiling, facial recognition DB scraping, workplace emotion inference, biometric categorisation for protected characteristics, real-time remote biometric ID for law enforcement)?",
        "answer": "yes | no",
        "reasoning": "",
        "note": "If answer is yes, set axis_b_outcome to PROHIBITED and leave g2 through g5 as not_applicable"
      },
      "g2_ai_system_definition": {
        "q1_machine_based_autonomous": {
          "question": "Is the system a machine-based system designed to operate with varying levels of autonomy that may exhibit adaptiveness after deployment? (Art.3(1))",
          "answer": "yes | no",
          "reasoning": ""
        },
        "q2_outputs_influence_environment": {
          "question": "Are the system outputs (predictions, recommendations, decisions, or content) intended to influence real or virtual environments? (Art.3(1))",
          "answer": "yes | no",
          "reasoning": ""
        },
        "gate_outcome": "in_scope | out_of_scope",
        "note": "If gate_outcome is out_of_scope, set g3 through g5 as not_applicable and axis_b_outcome to OUT_OF_SCOPE"
      },
      "g3_high_risk_annex_iii": {
        "question": "Does this system fall within any Annex III high-risk domain? (biometric ID, critical infrastructure, education, employment, essential services, law enforcement, migration, administration of justice)",
        "answer": "yes | no | not_applicable",
        "domains_triggered": [],
        "reasoning": ""
      },
      "g4_article_50_transparency": {
        "q1_conversational_interface": {
          "question": "Does the system interact directly with natural persons in a conversational or text-based interface? (Art.50(1))",
          "answer": "yes | no",
          "reasoning": ""
        },
        "q2_synthetic_deceptive_content": {
          "question": "Does the system generate synthetic audio, image, video, or text that could deceive persons into thinking it is human-generated? (Art.50(2))",
          "answer": "yes | no",
          "reasoning": ""
        },
        "q3_public_interest_text": {
          "question": "Does the system generate or manipulate text published as information of public interest (e.g. news, public affairs)? (Art.50(3))",
          "answer": "yes | no",
          "reasoning": ""
        },
        "article_50_applies": true
      },
      "g5_organisation_role": {
        "q0_role": {
          "question": "Is the organisation a Provider (building/developing using APIs, open-source, fine-tuning, RAG) or a Deployer (subscribing to a ready-made third-party AI service)?",
          "answer": "provider | deployer",
          "reasoning": ""
        },
        "q1_high_risk_deployer": {
          "question": "Is the AI system high-risk and developed by a third-party provider? (Art.26) — answer only if HIGH RISK and Deployer",
          "answer": "yes | no | not_applicable",
          "reasoning": ""
        },
        "q2_decisions_affecting_persons": {
          "question": "Do natural persons in the organisation use AI outputs to make decisions affecting other natural persons? (Art.26(2)) — answer only if HIGH RISK and Deployer",
          "answer": "yes | no | not_applicable",
          "reasoning": ""
        },
        "q3_substantial_modification": {
          "sq1_fine_tuning": {
            "question": "Are you fine-tuning or retraining the model on your own data? (Art.25(1))",
            "answer": "yes | no | not_applicable",
            "reasoning": ""
          },
          "sq2_purpose_change": {
            "question": "Are you changing the system intended purpose beyond what the provider designed it for? (Art.25(1))",
            "answer": "yes | no | not_applicable",
            "reasoning": ""
          },
          "sq3_rag_proprietary": {
            "question": "Are you adding retrieval-augmented generation (RAG) using your own proprietary datasets? (Art.25(1))",
            "answer": "yes | no | not_applicable",
            "reasoning": ""
          },
          "sq4_safety_critical": {
            "question": "Are you integrating the system as a safety-critical or regulated component in a product? (Art.25(1))",
            "answer": "yes | no | not_applicable",
            "reasoning": ""
          }
        }
      }
    },
    "combined_outcome": {
      "label": "ISG fast-track | ISG fast-track with Article 50 disclosure | Full due diligence — internal governance driver | Full due diligence with Article 50 disclosure | Mandatory escalation to Tier 2 — AI Act override | Full due diligence plus conformity assessment",
      "axis_a": "tier_1 | tier_2",
      "axis_b_outcome": "PROHIBITED | OUT_OF_SCOPE | HIGH_RISK | LIMITED_RISK | MINIMAL_RISK",
      "organisation_role": "provider | deployer",
      "article_50_applies": true,
      "change_board_required": true,
      "dpia_required": "yes | no | data_identification_determines",
      "article_14_human_oversight_legally_required": false,
      "article_50_disclosure_required": true,
      "reasoning": ""
    }
  },
  "part_2_dpia": {
    "s1_system_description": {
      "processing_description": "",
      "processing_purposes": "",
      "controller_processor_relationship": {
        "answer": "Organisation is data controller | Organisation is data processor | Joint controllership | Not yet determined",
        "reasoning": ""
      },
      "vendor_dpa_status": {
        "answer": "Yes — DPA signed | In progress | No — required before go-live | Not applicable — no third-party processing",
        "reasoning": ""
      }
    },
    "s2_data_inventory": {
      "data_subjects": {
        "selected": [],
        "allowed_values": ["Employees/staff", "Customers/clients", "Prospective customers", "Job applicants", "Children under 18", "Vulnerable adults", "Members of the public", "Suppliers/contractors", "Other", "None — no personal data processed"],
        "explanation": ""
      },
      "personal_data_types": {
        "selected": [],
        "allowed_values": ["Name and contact details", "Identity documents", "Financial data", "Location data", "Online identifiers", "Behavioural/usage data", "Professional/employment data", "Communications content", "Photographs/images", "Voice recordings/transcripts", "Inferred/derived data", "Other", "None"],
        "explanation": ""
      },
      "estimated_volume_of_data_subjects": "Fewer than 100 | 100–1,000 | 1,000–10,000 | 10,000–100,000 | Over 100,000 | Not yet known",
      "data_retention_period": ""
    },
    "s3_special_category_data": {
      "selected": [],
      "allowed_values": ["Racial or ethnic origin", "Political opinions", "Religious or philosophical beliefs", "Trade union membership", "Genetic data", "Biometric data for unique identification", "Health/medical data", "Sex life or sexual orientation", "None — no special category data"],
      "art9_2_condition": "",
      "safeguards": "",
      "policy_controls_if_none": ""
    },
    "s4_lawful_basis": {
      "primary_basis": {
        "answer": "Art.6(1)(a) Consent | Art.6(1)(b) Performance of a contract | Art.6(1)(c) Legal obligation | Art.6(1)(d) Vital interests | Art.6(1)(e) Public task | Art.6(1)(f) Legitimate interests",
        "reasoning": ""
      },
      "legitimate_interests_assessment": {
        "answer": "Not required | Yes — LIA completed and documented | In progress | No — required before go-live",
        "lia_three_part_test": ""
      },
      "data_subject_notification": {
        "answer": "Privacy notice updated to include this processing | Specific notice at point of collection | Existing notice already covers this processing | Notice not yet updated — required before go-live | Not applicable",
        "reasoning": ""
      }
    },
    "s5_automated_decision_making": {
      "art22_applies": {
        "answer": "No — output is advisory only; human makes all decisions | Partially — AI influences but human reviews every case | Yes — AI directly determines outcomes | Not yet assessed",
        "reasoning": ""
      },
      "explainability_level": {
        "answer": "Full explainability — decision factors disclosed | Partial — high-level rationale provided | Black-box — output only, no rationale | Not yet assessed",
        "reasoning": ""
      }
    },
    "s6_data_flows_and_third_parties": {
      "eea_transfer": {
        "answer": "No — all processing within EEA | Yes — adequacy decision applies | Yes — Standard Contractual Clauses in place | Yes — Binding Corporate Rules | Yes — transfer mechanism not yet confirmed | Unknown",
        "reasoning": ""
      },
      "third_party_recipients": "",
      "training_data_use": {
        "answer": "No — inference only; no training data retained by vendor | Yes — explicit basis obtained | Unknown — vendor contract does not address this | Not applicable",
        "reasoning": ""
      }
    },
    "s9_necessity_and_proportionality": {
      "less_data_possible": {
        "answer": "No — AI and this level of data are necessary for the stated purpose | Partially — some data could be reduced; mitigation documented | Yes — redesign required before proceeding | Not yet assessed",
        "reasoning": ""
      },
      "proportionality_statement": ""
    },
    "s10_risk_identification_controls_rating": {
      "privacy_risks_identified": {
        "selected": [],
        "allowed_values": ["Unauthorised access to personal data via AI interface", "Re-identification of pseudonymised data through AI inference", "AI-generated output revealing personal data inadvertently", "Bias/discriminatory outcomes affecting protected characteristics", "Unlawful profiling or scoring of individuals", "Personal data retained in AI model weights/caches", "Third-country transfer without adequate safeguards", "Data subject unaware of AI-driven processing", "Inaccurate AI output used to make decisions about individuals", "Vendor data breach or model exfiltration"],
        "explanation_per_risk": ""
      },
      "technical_security_measures": {
        "selected": [],
        "allowed_values": ["Encryption at rest", "Encryption in transit (TLS 1.2+)", "Access controls/role-based access", "Multi-factor authentication (MFA)", "Audit logging of access and processing", "Data masking/pseudonymisation before AI input", "Automated anomaly detection", "Penetration testing of AI interface", "Data loss prevention (DLP) controls", "None currently in place"],
        "reasoning": ""
      },
      "data_minimisation_approach": "",
      "erasure_capability": {
        "answer": "Yes — erasure process confirmed with vendor | Partial — logs erased but model weights cannot be adjusted | No — technical limitation prevents erasure | Not assessed",
        "reasoning": ""
      },
      "inherent_risk_rating": {
        "answer": "Low | Medium | High | Very High",
        "reasoning": ""
      },
      "residual_risk_rating": {
        "answer": "Low | Medium | High | Very High",
        "reasoning": ""
      }
    },
    "s11_dpo_consultation": {
      "dpo_consulted": {
        "answer": "Yes — DPO reviewed and approved | Yes — DPO noted concerns (documented) | Consultation in progress | No — DPO not required (no DPO designated) | No — not yet consulted",
        "reasoning": ""
      },
      "art36_consultation_required": {
        "answer": "No — residual risk is acceptable | Yes — Art.36 prior consultation initiated | Under assessment",
        "reasoning": "",
        "note": "Art.36 consultation is required where residual risk remains High or Very High after mitigation"
      }
    }
  },
  "classification_summary": {
    "axis_a": "tier_1 | tier_2",
    "axis_b_outcome": "PROHIBITED | OUT_OF_SCOPE | HIGH_RISK | LIMITED_RISK | MINIMAL_RISK",
    "organisation_role": "provider | deployer",
    "article_50_applies": true,
    "combined_outcome": "",
    "change_board_required": true,
    "data_subjects": [],
    "personal_data_types": [],
    "special_category_data": "none",
    "lawful_basis": "",
    "automated_decision_making": "",
    "dpia_inherent_risk": "Low | Medium | High | Very High",
    "dpia_residual_risk": "Low | Medium | High | Very High",
    "dpo_consultation_required": true,
    "art36_consultation_required": false
  }
}`;
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
