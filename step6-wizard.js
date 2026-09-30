/* Step 6 — Control Identification
   Reads selected risks from record['step-5'].legal_assessment.
   Risk team uses Step Wizard tab to select controls per individual risk.
   Compliance team uses AI Act Compliance View tab to fill HS gaps.
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _tblData = null, _record = null;
  let _riskData = []; // [{ risk_id, display_name, risk_type, risk_source, risk_description, controls }]
  let _tcByRC   = null; // fk_Risk_Control_ID → test control (R→T pairing)
  let _step5RefsByRisk = new Map(); // risk_id → [HS refs the Step 5 area selections flagged]

  const _state = {
    riskSelected: {},       // derived: pk_Risk_Control_ID → bool (bridge for Step 7 / report)
    hsSelected: {}          // source of truth: `${riskId}::${standard_ref}` → bool
  };

  // ---- Public API ---------------------------------------------
  window.mountStep6Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _tblData    = null;
    _hsMap6     = null;
    _record     = null;
    _riskData   = [];
    _tcByRC     = null;
    _state.riskSelected = {};
    _state.hsSelected = {};

    _injectStyles();

    const shell = _el('div', 'wiz-shell');
    shell.appendChild(WizUtils.buildStepHeader(_step, _colorKey, _phaseTitle, { hideDetails: true }));
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _loadData(pw);
  };

  // ---- Data loading -------------------------------------------
  async function _loadData(pw) {
    const [risks, controls, hs] = await WizUtils.fetchAll([
      'tbl_Risks.json',
      'tbl_Risk_Controls.json',
      'tbl_Harmonised_Standards.json',
    ]);
    if (!risks || !controls || !hs) {
      pw.innerHTML = `<p style="padding:24px;color:#ec6a68">Could not load risk data files.</p>`;
      return;
    }
    _tblData = { risks, controls, hs, testControls: [] };
    _tcByRC  = new Map();

    _record = WizUtils.loadRecord();

    _riskData = _buildRiskControlData();

    // Requirements each risk carries into Step 6 = the HS refs the assessor's
    // Step 5 area selections flagged (fine-trimmed/confirmed here).
    _step5RefsByRisk = new Map();
    ((_record?.['step-5']?.legal_assessment?.risks) || []).forEach(r => {
      if (r.risk_id && Array.isArray(r.selected_refs) && r.selected_refs.length) {
        _step5RefsByRisk.set(r.risk_id, r.selected_refs.slice());
      }
    });

    // Step 6 is a read-only confirmation of Step 5's selection: always mirror the
    // current Step 5 requirement picks (do not restore a stale Step 6 record).
    _riskData.forEach(risk => _riskHsRefs(risk).forEach(ref => { _state.hsSelected[_hsKey(risk.risk_id, ref)] = true; }));
    _deriveRiskSelected(); // populate _state.riskSelected (incl. always-on Framework_Statement)

    _renderPanes(pw);
  }

  // ---- Build individual risk data from tbl_* data -------------
  function _buildRiskControlData() {
    if (!_tblData) return [];
    const saved8        = _record?.['step-5'];
    const legalSelected = (saved8?.legal_assessment?.risks || []).filter(r => r.selected);
    if (!legalSelected.length) return [];

    const tblRiskByName = new Map(_tblData.risks.map(r => [r.risk_name, r]));

    // Build controls-by-risk map
    const ctrlsByRisk = new Map(); // fk_Risk_ID → [ctrl, ...]
    for (const ctrl of _tblData.controls) {
      if (!ctrlsByRisk.has(ctrl.fk_Risk_ID)) ctrlsByRisk.set(ctrl.fk_Risk_ID, []);
      ctrlsByRisk.get(ctrl.fk_Risk_ID).push(ctrl);
    }

    const seenRiskIds = new Set();
    const result = [];

    // Process legal (EU AI Act) risks
    legalSelected.forEach(r8 => {
      const tblRisk = tblRiskByName.get(r8.risk_name);
      if (!tblRisk) return;
      if (seenRiskIds.has(tblRisk.pk_Risk_ID)) return;
      seenRiskIds.add(tblRisk.pk_Risk_ID);
      const controls = (ctrlsByRisk.get(tblRisk.pk_Risk_ID) || []).map(ctrl => ({ ...ctrl }));
      result.push({
        risk_id:           tblRisk.pk_Risk_ID,
        display_name:      tblRisk.risk_name,
        fk_AI_Article_ID:  tblRisk.fk_AI_Article_ID || '',
        fk_Harmonised_Standard_IDs: tblRisk.fk_Harmonised_Standard_IDs || '',
        risk_type:         'legal',
        risk_source:       'EU_AI_Act',
        risk_description:  tblRisk.risk_description || '',
        controls
      });
    });

    return result;
  }

  // ---- Panes --------------------------------------------------
  function _renderPanes(pw) {
    pw.innerHTML = '';
    const wz = _el('div', 'wiz-pane'); wz.dataset.pane = 'wizard';
    wz.appendChild(_buildWizardPane());
    pw.appendChild(wz);
    if (WizUtils.glossify) { try { WizUtils.glossify(wz); } catch (_) {} }
  }

  // ---- Wizard pane --------------------------------------------
  function _buildWizardPane() {
    const card = _el('div', 'step-detail-card');

    if (_riskData.length === 0) {
      const warn = _el('div', 'wiz9-warn');
      warn.innerHTML = '<strong>No risks selected in Step 5.</strong> Complete the Risk Identification (Step 5) and confirm at least one risk before returning to this step.';
      card.appendChild(warn);
      return card;
    }

    card.appendChild(_el('p', 'wiz-panel-lead', {
      textContent: 'Final review. These are the applicable risks and the requirements you selected in Step 5. Approve & Save to confirm — this is the record Step 7 and the report use. To change what’s selected, go back to Step 5.'
    }));

    // ── Already Met By Workflow (read-only) ──
    const wfPanel = _buildWorkflowPanelRO();
    if (wfPanel) card.appendChild(wfPanel);

    // ── Risks & requirements — group header holding one task panel per risk ──
    const riskBody = _el('div', '');
    riskBody.appendChild(_buildValidationBanner());
    const normalRisks = _riskData.filter(r => !_riskIsFullyWf(r));
    const techRisks  = normalRisks.filter(r => r.risk_type === 'technical');
    const legalRisks = normalRisks.filter(r => r.risk_type === 'legal');
    if (legalRisks.length > 0) {
      riskBody.appendChild(_sectionLabel(`Legal / EU AI Act risks (${legalRisks.length})`));
      legalRisks.forEach((r, i) => riskBody.appendChild(_buildRiskAccordion(r, i)));
    }
    if (techRisks.length > 0) {
      riskBody.appendChild(_sectionLabel(`Technical risks (${techRisks.length})`));
      techRisks.forEach((r, i) => riskBody.appendChild(_buildRiskAccordion(r, i)));
    }
    card.appendChild(WizUtils.buildStepGroup({
      title: 'Risks & requirements',
      description: 'The applicable risks and the harmonised-standard requirements selected in Step 5. Review each, then approve below.',
      status: String(normalRisks.length), statusKind: 'progress',
      body: riskBody
    }).el);

    // ── DPIA — carried from Step 4 (group header) ──
    const dpia = _buildDpiaReviewBlock();
    if (dpia) card.appendChild(WizUtils.buildStepGroup({
      title: 'DPIA — privacy risks & security measures',
      description: 'Carried from your Step 4 DPIA. The privacy risks are treated by the security measures, which you evidence in Step 7. To change these, edit the DPIA in Step 4.',
      body: dpia
    }).el);

    card.appendChild(WizUtils.buildSaveBlock({ label: 'Approve & Save', onSave: _handleSave }).el);
    return card;
  }

  // ---- DPIA review (read-only, carried from Step 4) -----------
  function _buildDpiaReviewBlock() {
    const di = _record?.['step-4']?.data_types_identified;
    if (!di) return null;
    const privacy  = di.privacy_risks || [];
    const measures = di.security_measures || [];
    if (!privacy.length && !measures.length) return null;

    const wrap = _el('div', '');

    if (privacy.length) {
      wrap.appendChild(_el('p', 'wiz9-sub-label', { textContent: `Privacy risks (${privacy.length})` }));
      const ul = _el('ul', ''); ul.style.cssText = 'margin:0 0 8px;padding-left:18px;font-size:12.5px;line-height:1.7;color:var(--color-text-primary)';
      privacy.forEach(p => { const li = document.createElement('li'); li.textContent = p; ul.appendChild(li); });
      wrap.appendChild(ul);
    }
    wrap.appendChild(_el('p', 'wiz9-sub-label', { textContent: `Security measures (${measures.length})` }));
    if (measures.length) {
      measures.forEach(m => {
        const item = _el('div', 'wiz9-hs-item');
        item.appendChild(_el('span', 'wiz9-hs-tick', { textContent: '✓' }));
        const txt = _el('div', 'wiz9-hs-item-txt');
        txt.appendChild(_el('span', 'wiz9-hs-group-name', { textContent: m }));
        item.appendChild(txt);
        wrap.appendChild(item);
      });
    } else {
      wrap.appendChild(_el('p', 'wiz9-intro', { textContent: 'No security measures were recorded in the DPIA — add them in Step 4 so they can be evidenced in Step 7.' }));
    }
    return wrap;
  }

  // ---- Validation banner --------------------------------------
  function _buildValidationBanner() {
    const wrap = _el('div', 'wiz9-val-wrap');
    wrap.id = 'wiz9-val-banner';
    _updateValidationBanner(wrap);
    return wrap;
  }

  function _updateValidationBanner(wrap) {
    const el = wrap || _container.querySelector('#wiz9-val-banner');
    if (!el) return;
    const uncovered = _riskData.filter(r => _selectedCountForRisk(r) === 0);
    el.innerHTML = '';
    if (uncovered.length === 0) {
      const ok = _el('div', 'wiz9-val-ok');
      ok.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> All ${_riskData.length} risk${_riskData.length !== 1 ? 's' : ''} have at least one requirement selected.`;
      el.appendChild(ok);
    } else {
      const err = _el('div', 'wiz9-val-err');
      err.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> <strong>${uncovered.length} risk${uncovered.length !== 1 ? 's' : ''}</strong> still need${uncovered.length === 1 ? 's' : ''} a requirement selected: ${uncovered.map(r => r.display_name).join(', ')}.`;
      el.appendChild(err);
    }
  }

  // ---- HS-level selection (the HS requirement is the selectable unit) ------
  const _hsKey = (riskId, ref) => `${riskId}::${ref}`;
  const _ctrlRefs = ctrl => (ctrl.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean);

  // Ordered distinct HS refs a risk addresses. Sourced from the direct
  // risk↔HS link (tbl_Risks.fk_Harmonised_Standard_IDs); falls back to
  // deriving from the risk's non-FS controls for any risk without it.
  function _riskHsRefs(risk) {
    // Prefer the requirements the Step 5 area selections flagged for this risk.
    const sel = _step5RefsByRisk.get(risk.risk_id);
    if (sel && sel.length) return sel;
    // Fallback: every HS requirement the risk maps to (Step 5 recorded no areas).
    if (risk.fk_Harmonised_Standard_IDs) {
      return risk.fk_Harmonised_Standard_IDs.split(',').map(s => s.trim()).filter(Boolean);
    }
    const seen = new Set(); const order = [];
    risk.controls.filter(c => c.control_source !== 'Framework_Statement').forEach(c => {
      (_ctrlRefs(c).length ? _ctrlRefs(c) : ['—']).forEach(ref => {
        if (!seen.has(ref)) { seen.add(ref); order.push(ref); }
      });
    });
    return order;
  }

  // ── "Already Met By Workflow" support ──
  let _hsMap6 = null;
  function _hs6map() { if (!_hsMap6) _hsMap6 = new Map((_tblData?.hs || []).map(h => [h.standard_ref, h])); return _hsMap6; }
  function _isWfRef6(ref) { return (_hs6map().get(ref) || {}).coverage_type === 'Workflow'; }
  // Selected workflow refs for a risk (in Step 5's selection order).
  function _riskWfRefs(risk) {
    return _riskHsRefs(risk).filter(r => r !== '—' && _isWfRef6(r) && _state.hsSelected[_hsKey(risk.risk_id, r)]);
  }
  // A risk whose every selected requirement is workflow-met → shown only in the panel.
  function _riskIsFullyWf(risk) {
    const refs = _riskHsRefs(risk).filter(r => r !== '—' && _state.hsSelected[_hsKey(risk.risk_id, r)]);
    return refs.length > 0 && refs.every(_isWfRef6);
  }

  // Derive control selection from the HS selection: a control is selected when
  // any HS requirement it satisfies is selected. Framework_Statement is always on.
  function _deriveRiskSelectedForRisk(risk) {
    risk.controls.forEach(c => {
      if (c.control_source === 'Framework_Statement') { _state.riskSelected[c.pk_Risk_Control_ID] = true; return; }
      const keys = (_ctrlRefs(c).length ? _ctrlRefs(c) : ['—']).map(r => _hsKey(risk.risk_id, r));
      _state.riskSelected[c.pk_Risk_Control_ID] = keys.some(k => !!_state.hsSelected[k]);
    });
  }
  function _deriveRiskSelected() { _riskData.forEach(_deriveRiskSelectedForRisk); }

  function _selectedCountForRisk(risk) {
    return _riskHsRefs(risk).filter(ref => _state.hsSelected[_hsKey(risk.risk_id, ref)]).length;
  }

  // Read-only "Already Met By Workflow" panel — the claimed workflow requirements
  // grouped by risk, each mapped to the step that meets it. Editing is in Step 5.
  function _buildWorkflowPanelRO() {
    const map = _hs6map();
    const groups = [];
    _riskData.forEach(risk => {
      const refs = _riskWfRefs(risk);
      if (refs.length) groups.push({ risk, refs });
    });
    if (!groups.length) return null;
    const body = _el('div', '');
    body.appendChild(_el('p', 'wiz-panel-lead', {
      textContent: 'Requirements satisfied by completing this governance workflow. Claimed in Step 5 and evidenced in Step 7, each mapped to the step that meets it. To change what is claimed, go back to Step 5.'
    }));
    let total = 0;
    groups.forEach(g => {
      body.appendChild(_el('p', 'wiz9-sub-label', { textContent: `${g.risk.risk_id} — ${g.risk.display_name}` }));
      g.refs.forEach(ref => {
        total++;
        const h = map.get(ref) || {};
        const item = _el('div', 'wiz9-hs-item');
        item.appendChild(_el('span', 'wiz9-hs-tick', { textContent: '✓' }));
        const txt = _el('div', 'wiz9-hs-item-txt');
        const hd = _el('div', 'wiz9-hs-item-hdr');
        hd.appendChild(_el('span', 'wiz9-cmp-ref-tag', { textContent: WizUtils.fmtStdRef(ref) }));
        hd.appendChild(_el('span', 'wiz9-hs-group-name', { textContent: h.standard_name || ref }));
        if (h.workflow_step_label) hd.appendChild(_el('span', 'wiz-wf-step', { textContent: '⚙ ' + h.workflow_step_label }));
        txt.appendChild(hd);
        item.appendChild(txt);
        body.appendChild(item);
      });
    });
    return WizUtils.buildStepPanel({
      title: 'Already Met By Workflow',
      description: 'Requirements the governance workflow itself satisfies — claimed and mapped to the step that meets them.',
      status: String(total), statusKind: 'done',
      body
    }).el;
  }

  // ---- Risk accordion (individual risk) -----------------------
  function _buildRiskAccordion(risk, idx) {
    // Body (built first so the panel can wrap it)
    const body = _el('div', '');

    // Risk description
    if (risk.risk_description) {
      const desc = _el('p', 'wiz9-risk-desc');
      desc.textContent = risk.risk_description;
      body.appendChild(desc);
    }

    // Harmonised standard requirements this risk addresses — the selectable
    // treatment units, sourced from the direct risk↔HS link (no controls shown).
    const fsCtrls = risk.controls.filter(c => c.control_source === 'Framework_Statement');
    // Workflow-met requirements are shown in the "Already Met By Workflow" panel.
    const hsRefs  = _riskHsRefs(risk).filter(r => r !== '—' && !_isWfRef6(r));

    if (hsRefs.length > 0) {
      const hsByRef = new Map((_tblData.hs || []).map(h => [h.standard_ref, h]));
      body.appendChild(_el('p', 'wiz9-ctrl-section-label', { textContent: `Requirements to implement (${hsRefs.length})` }));

      // Group the requirements by their subcategory, mirroring Step 5's areas.
      let lastSub = null;
      hsRefs.forEach(ref => {
        const h = hsByRef.get(ref);
        if (h && h.subcategory && h.subcategory !== lastSub) {
          lastSub = h.subcategory;
          body.appendChild(_el('p', 'wiz9-sub-label', { textContent: h.subcategory }));
        }
        const item = _el('div', 'wiz9-hs-item');
        item.appendChild(_el('span', 'wiz9-hs-tick', { textContent: '✓' }));
        const txt = _el('div', 'wiz9-hs-item-txt');
        const hdrRow = _el('div', 'wiz9-hs-item-hdr');
        hdrRow.appendChild(_el('span', 'wiz9-cmp-ref-tag', { textContent: WizUtils.fmtStdRef(ref) }));
        hdrRow.appendChild(_el('span', 'wiz9-hs-group-name', { textContent: h?.standard_name || ref }));
        txt.appendChild(hdrRow);
        if (h?.standard_text) txt.appendChild(_el('p', 'wiz9-hs-item-desc', { textContent: h.standard_text }));
        item.appendChild(txt);
        body.appendChild(item);
      });
    } else if (fsCtrls.length === 0) {
      body.appendChild(_el('p', 'wiz9-intro', { textContent: 'No harmonised standard requirements were flagged for this risk in Step 5.' }));
    }

    if (fsCtrls.length > 0) {
      const fsLbl = _el('p', 'wiz9-ctrl-section-label wiz9-ctrl-section-label--fs');
      fsLbl.textContent = `Framework Self-Certifications (${fsCtrls.length})`;
      body.appendChild(fsLbl);
      fsCtrls.forEach(ctrl => {
        const card = _el('div', 'wiz9-ctrl-card wiz9-fs-ctrl-card');
        const hdr  = _el('div', 'wiz9-ctrl-hdr');
        const icon = _el('span', 'wiz9-ctrl-icon');
        icon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
        hdr.appendChild(icon);
        const badge = _el('span', 'wiz9-src-badge wiz9-fs-src-badge'); badge.textContent = 'Self-certified';
        hdr.appendChild(badge);
        hdr.appendChild(_el('span', 'wiz9-ctrl-name', { textContent: ctrl.jkName }));
        if (ctrl.fk_Harmonised_Standard_IDs) hdr.appendChild(_el('span', 'wiz9-standard-ref', { textContent: WizUtils.fmtStdRef(ctrl.fk_Harmonised_Standard_IDs) }));
        card.appendChild(hdr);
        if (ctrl.jkObjective) {
          const obj = _el('p', 'wiz9-ctrl-obj'); obj.textContent = ctrl.jkObjective; card.appendChild(obj);
        }
        body.appendChild(card);
      });
    }

    // Selection status (read-only — the requirement picks are made in Step 5).
    const refs  = _riskHsRefs(risk);
    const total = refs.length;
    const sel   = refs.filter(ref => _state.hsSelected[_hsKey(risk.risk_id, ref)]).length;
    const statusTxt  = total ? `${sel} / ${total}` : 'self-cert';
    const statusKind = (total === 0 || sel === total) ? 'done' : sel === 0 ? 'todo' : 'progress';

    const panel = WizUtils.buildStepPanel({
      num: risk.risk_id,
      title: risk.display_name,
      ref: risk.fk_AI_Article_ID ? WizUtils.artLabel(risk.fk_AI_Article_ID) : '',
      status: statusTxt, statusKind,
      check: { checked: true, disabled: true, title: 'Selected in Step 5 — change what applies there' },
      body
    });
    panel.el.dataset.riskId = risk.risk_id;
    return panel.el;
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    // Validate: every risk must have ≥1 requirement selected
    const uncovered = _riskData.filter(r => _selectedCountForRisk(r) === 0);
    if (uncovered.length > 0) {
      _updateValidationBanner();
      const firstSec = _container.querySelector(
        `[data-risk-id="${CSS.escape(uncovered[0].risk_id)}"]`
      );
      if (firstSec) {
        firstSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        firstSec.classList.add('wiz9-risk-sec--error');
        setTimeout(() => firstSec.classList.remove('wiz9-risk-sec--error'), 2500);
      }
      return null; // validation failed — no summary
    }

    const rec9 = _buildOutputRecord();
    if (!_record) {
      _record = { _meta: { schema_version: '1.0', created: new Date().toISOString(), last_modified: new Date().toISOString() } };
    }
    _record._meta.last_modified = new Date().toISOString();
    _record['step-6'] = rec9;
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Step 6 saved ✓');
    // Summary = the exact "Compliance & Requirement Traceability" table from the
    // conformity report, so the assessor sees what will be submitted.
    return window.ReportSections.frame('traceability', _record)
      .then(f => ({ title: 'Requirement selection Result', el: f }));
  }

  function _buildOutputRecord() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};
    const hsByRef = new Map((_tblData.hs || []).map(h => [h.standard_ref, h]));

    // HS requirement is the selectable unit: per-risk selection + a flat list.
    const selected_hs = {};            // risk_id → [refs]
    const selected_requirements = [];  // flat, for Step 7 (evidence) and the report
    _riskData.forEach(r => {
      const refs = _riskHsRefs(r).filter(ref => ref !== '—' && _state.hsSelected[_hsKey(r.risk_id, ref)]);
      if (refs.length) selected_hs[r.risk_id] = refs;
      refs.forEach(ref => {
        const h = hsByRef.get(ref) || {};
        selected_requirements.push({
          risk_id:       r.risk_id,
          risk_name:     r.display_name,
          standard_ref:  ref,
          standard_name: h.standard_name || '',
          subcategory:   h.subcategory || '',
          coverage_type: h.coverage_type || ''
        });
      });
    });

    return {
      step_id: 'step-6', step_title: 'Control identification',
      assessment_date: today,
      assessed_by:  meta.assessed_by || '',
      use_case_id:  meta.use_case_id || '',
      total_risks:         _riskData.length,
      risks_covered:       _riskData.filter(r => _selectedCountForRisk(r) > 0).length,
      total_requirements:  selected_requirements.length,
      selected_hs,
      selected_requirements
    };
  }

  // ================================================================
  // ---- AI Act Compliance View ---------------------------------
  // ================================================================

  // ---- Style injection ----------------------------------------
  function _injectStyles() {
    WizUtils.injectStyles('wiz9-styles', `
.wiz8-stat{display:flex;flex-direction:column;gap:2px}
.wiz8-stat-num{font-size:24px;font-weight:700;color:#8cebb0;line-height:1}
.wiz8-stat-lbl{font-size:10px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.05em}
/* Source card */
.wiz9-source-card{background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:8px;padding:14px 16px;margin-bottom:12px}
.wiz9-source-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#8cebb0;margin:0 0 10px}
.wiz9-source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.wiz9-source-cell{display:flex;flex-direction:column;gap:3px}
.wiz9-cell-label{font-size:11px;color:var(--color-text-tertiary);font-weight:500}
.wiz9-cell-value{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.wiz9-cell-value--num{font-size:18px;font-weight:700;color:#8ce3c6}
.wiz9-cell-value--high{font-size:14px;font-weight:700;color:#fba4a3}
.wiz9-cell-value--ok{font-size:14px;font-weight:700;color:#8cebb0}

/* Info / warn */
.wiz9-warn{background:rgba(212,184,96,0.12);border:1px solid rgba(212,184,96,0.40);border-radius:6px;padding:12px 16px;font-size:13px;color:#ecd489;margin-bottom:12px}
.wiz9-info{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:6px;padding:12px 16px;font-size:13px;color:#a4ccf6}
.wiz9-intro{font-size:13px;color:var(--color-text-secondary);margin:0 0 12px;line-height:1.6}

/* Validation banner */
.wiz9-val-wrap{margin-bottom:14px}
.wiz9-val-ok{display:flex;align-items:center;gap:7px;background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:6px;padding:9px 14px;font-size:13px;color:#8cebb0;font-weight:500}
.wiz9-val-err{display:flex;align-items:flex-start;gap:7px;background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);border-radius:6px;padding:9px 14px;font-size:13px;color:#f3ab8a;line-height:1.55}

/* Risk accordion */
.wiz9-risk-list{display:flex;flex-direction:column;gap:10px}
.wiz9-risk-sec{border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.wiz9-risk-sec--error{animation:wiz9-shake .4s ease;border-color:rgba(226,90,88,0.50)!important}
@keyframes wiz9-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.wiz9-risk-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none;gap:10px}
.wiz9-risk-hdr:hover{background:var(--color-bg-hover,#262219)}
.wiz9-risk-hdr-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.wiz9-risk-icon{display:flex;color:#ec6a68;flex-shrink:0}
.wiz9-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz9-cat-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz9-rel-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.wiz9-rel-badge--high{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz9-rel-badge--medium{background:#262219;color:#b1a992}
.wiz9-risk-hdr-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.wiz9-sel-btn{font-size:11px;font-weight:500;color:var(--teal-600,#8ce3c6);background:none;border:1px solid rgba(93,202,165,0.45);border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap}
.wiz9-sel-btn:hover{background:rgba(93,202,165,0.10)}
.wiz9-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.wiz9-risk-body{padding:16px;display:flex;flex-direction:column;gap:12px}
.wiz9-collapsed{display:none}

/* Risk body */
.wiz9-risk-desc{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0;padding:10px 12px;background:#211d15;border-radius:5px;border-left:3px solid var(--color-border)}
.wiz9-ctrl-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:0}
.wiz9-sub-label{font-size:11.5px;font-weight:700;color:var(--color-text-secondary);margin:12px 0 2px;padding-left:2px;border-left:2px solid rgba(93,202,165,0.4)}
.wiz9-hs-group-hdr{display:flex;align-items:center;gap:8px;margin:12px 0 6px;padding-left:2px;cursor:pointer}
.wiz9-hs-cb{width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:var(--gold,#0d9488)}
.wiz9-hs-group-name{font-size:12.5px;font-weight:600;color:var(--color-text-primary)}
.wiz9-ctrl-card--nested{margin-left:23px}
.wiz9-hs-item{display:flex;align-items:flex-start;gap:10px;padding:9px 4px;border-top:1px solid var(--color-border)}
.wiz9-hs-item:first-of-type{border-top:none}
.wiz9-hs-tick{flex-shrink:0;color:#8cebb0;font-weight:700;font-size:13px;line-height:1.5;margin-top:1px}
.wiz9-hs-item-txt{min-width:0}
.wiz9-hs-item-hdr{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wiz9-hs-item-desc{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--color-text-secondary)}
.wiz9-ctrl-section-label--eu{color:#a4ccf6}

/* EU AI Act risk descriptions */
.wiz9-eu-risks-wrap{display:flex;flex-direction:column;gap:8px}
.wiz9-eu-risk-desc{background:rgba(80,150,225,0.12);border:1px solid rgba(80,150,225,0.40);border-radius:5px;padding:10px 12px;border-left:3px solid #3b82f6}
.wiz9-eu-risk-label{font-size:11px;font-weight:700;color:#a4ccf6;display:block;margin-bottom:4px}
.wiz9-eu-risk-text{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* Source badges */
.wiz9-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;letter-spacing:.03em}
.wiz9-src-badge--eu{background:rgba(80,150,225,0.16);color:#a4ccf6}
.wiz9-src-badge--gs{background:rgba(80,150,225,0.12);color:#bfb8ff}

/* Legal risk names in cluster header */
.wiz9-legal-risk-names{font-size:11px;color:var(--color-text-tertiary);font-style:italic;min-width:0;overflow:hidden;text-overflow:ellipsis}

/* Standard reference badge */
.wiz9-standard-ref{font-size:10px;font-weight:600;background:rgba(138,130,235,0.16);color:#bfb8ff;padding:2px 7px;border-radius:4px;white-space:nowrap;word-break:break-all}

/* Control card */
.wiz9-ctrl-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;padding:14px 16px}
.wiz9-ctrl-hdr{display:flex;align-items:center;gap:7px;margin-bottom:10px;flex-wrap:wrap}
.wiz9-ctrl-cb{flex-shrink:0;accent-color:var(--teal-600,#8ce3c6);width:15px;height:15px;cursor:pointer}
.wiz9-ctrl-icon{display:flex;color:#bfb8ff;flex-shrink:0}
.wiz9-ctrl-name{font-size:13px;font-weight:700;color:var(--color-text-primary);flex:1;min-width:120px}
.wiz9-rcn-badge{font-size:10px;font-weight:600;background:rgba(138,130,235,0.16);color:#bfb8ff;padding:2px 7px;border-radius:4px;white-space:nowrap;word-break:break-all}
.wiz9-maturity-badge{font-size:10px;font-weight:600;background:rgba(52,199,120,0.16);color:#8cebb0;padding:2px 7px;border-radius:4px;white-space:nowrap}
.wiz9-test-pair-badge{font-size:10px;font-weight:600;background:rgba(212,184,96,0.16);color:#ecd489;padding:2px 7px;border-radius:4px;white-space:nowrap;cursor:default}
.wiz9-ctrl-obj{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0 0 10px}
.wiz9-evidence-wrap{font-size:11px;color:var(--color-text-tertiary);margin-bottom:10px}
.wiz9-evidence-label{font-weight:600}
.wiz9-evidence-text{font-style:italic}

/* Task / Code section */
.wiz9-tasks-wrap{border:1px solid var(--color-border);border-radius:6px;overflow:hidden;margin-top:4px}
.wiz9-tasks-hdr{display:flex;align-items:center;gap:7px;padding:8px 12px;background:var(--color-bg-subtle,#211d15);cursor:pointer;user-select:none}
.wiz9-tasks-hdr:hover{background:var(--color-bg-hover,#262219)}
.wiz9-tasks-icon{display:flex;color:#bfb8ff;flex-shrink:0}
.wiz9-tasks-lbl{font-size:12px;font-weight:600;color:#bfb8ff;flex:1}
.wiz9-tasks-chv{display:flex;color:var(--color-text-tertiary);transition:transform .2s}
.wiz9-tasks-body{padding:14px;display:flex;flex-direction:column;gap:20px;background:#211d15}

/* Task / Code pair */
.wiz9-pair{display:flex;flex-direction:column;gap:8px;padding:10px 12px;background:var(--color-surface);border:1px solid rgba(138,130,235,0.16);border-radius:6px}
.wiz9-task-wrap{display:flex;flex-direction:column;gap:5px}
.wiz9-task-num{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#bfb8ff;background:rgba(138,130,235,0.16);padding:2px 8px;border-radius:4px;display:inline-block;width:fit-content}
.wiz9-task-text{font-size:12px;color:var(--color-text-secondary);line-height:1.65;margin:0}
.wiz9-code-wrap{display:flex;flex-direction:column;gap:5px}
.wiz9-code-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8cebb0;background:rgba(52,199,120,0.16);padding:2px 8px;border-radius:4px;display:inline-block;width:fit-content}
.wiz9-code-block{background:#1e293b;color:#2e2a1f;font-size:11px;line-height:1.6;padding:12px 14px;border-radius:6px;overflow-x:auto;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;white-space:pre}
.wiz9-code-block code{background:none;padding:0;font-size:inherit;color:inherit;font-family:inherit}

/* Count / action */
.wiz9-count-badge{font-size:13px;font-weight:600;padding:4px 12px;border-radius:10px}
.wiz9-count-badge--ok{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-count-badge--warn{background:rgba(226,90,88,0.16);color:#fba4a3}

/* Results */
.wiz9-results{margin-top:16px}
.wiz9-result-card{background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);border-radius:8px;padding:20px}
.wiz9-result-title{font-size:14px;font-weight:700;color:#8cebb0;margin:0 0 14px}
.wiz9-result-stats{display:flex;gap:24px;margin-bottom:14px;flex-wrap:wrap}
.wiz9-result-note{font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0}

/* Reference pane */
.wiz9-ref-summary{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.wiz9-ref-sum-badge{font-size:12px;font-weight:700;padding:4px 12px;border-radius:10px}
.wiz9-ref-sum-badge--ok{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-ref-sum-badge--warn{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz9-ref-uncovered{font-size:12px;font-weight:600;color:#fba4a3;background:rgba(226,90,88,0.12);padding:3px 10px;border-radius:6px}
.wiz9-ref-hint{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0 0 20px;line-height:1.5}
.wiz9-ref-risk-sec{margin-bottom:28px}
.wiz9-ref-risk-hdr{display:flex;align-items:center;gap:8px;padding-bottom:6px;border-bottom:2px solid var(--color-border);margin-bottom:12px;flex-wrap:wrap}
.wiz9-ref-risk-name{font-size:13px;font-weight:700;color:var(--color-text-primary)}
.wiz9-ref-ctrl{margin-bottom:10px;padding-left:12px;border-left:3px solid #a5b4fc}
.wiz9-ref-ctrl--deselected{border-left-color:#2e2a1f;opacity:.55}
.wiz9-ref-ctrl-hdr{display:flex;align-items:center;gap:7px;margin-bottom:6px;flex-wrap:wrap}
.wiz9-ref-ctrl-name{font-size:12px;font-weight:700;color:#bfb8ff}
.wiz9-ref-sel-ind{font-size:11px;font-weight:800;width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
.wiz9-ref-sel-ind--on{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-ref-sel-ind--off{background:#262219;color:#8b8574}
.wiz9-ref-ctrl-skip{font-size:11px;color:#8b8574;font-style:italic;margin:0 0 4px}
.wiz9-ref-pair{margin-bottom:12px;padding:8px 10px;background:#211d15;border:1px solid rgba(138,130,235,0.16);border-radius:5px;display:flex;flex-direction:column;gap:6px}

/* ── AI Act Compliance View ─────────────────────────────────── */
.wiz9-cmp-wrap{padding:0 0 40px}
.wiz9-cmp-header{padding:20px 24px 16px;border-bottom:1px solid var(--color-border)}
.wiz9-cmp-title{font-size:16px;font-weight:600;color:var(--color-text-primary);margin:0 0 6px}
.wiz9-cmp-subtitle{font-size:12px;color:var(--color-text-secondary);margin:0 0 6px;line-height:1.5}
.wiz9-cmp-desc{font-size:12px;color:var(--color-text-secondary);margin:0 0 10px;line-height:1.6;padding:10px 14px;background:var(--color-bg-subtle,#211d15);border:1px solid var(--color-border);border-radius:6px}
.wiz9-cmp-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wiz9-cmp-pending-note{background:rgba(212,184,96,0.12);border:1px solid rgba(212,184,96,0.40);border-radius:6px;padding:10px 14px;font-size:12px;color:#ecd489;margin-top:8px}

/* Article accordion */
.wiz9-cmp-article{border-bottom:1px solid var(--color-border)}
.wiz9-cmp-article:last-child{border-bottom:none}
.wiz9-cmp-art-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;cursor:pointer;user-select:none;background:var(--color-surface,#fff);transition:background .15s}
.wiz9-cmp-art-hdr:hover{background:var(--color-bg,#211d15)}
.wiz9-cmp-art-left{display:flex;align-items:baseline;gap:8px;flex:1;min-width:0}
.wiz9-cmp-art-id{font-size:10px;font-weight:700;font-family:monospace;color:var(--color-text-tertiary);white-space:nowrap}
.wiz9-cmp-art-name{font-size:13px;font-weight:500;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wiz9-cmp-art-right{display:grid;grid-template-columns:116px 44px 58px 52px 60px 18px;align-items:center;gap:6px;flex-shrink:0}
.wiz9-cmp-chevron{font-size:12px;color:var(--color-text-tertiary);text-align:center}
.wiz9-cmp-count{font-size:10px;font-weight:500;padding:2px 6px;border-radius:4px;white-space:nowrap;text-align:center}
.wiz9-cmp-count--hs{background:rgba(138,130,235,0.16);color:#bfb8ff}
.wiz9-cmp-count--risk{background:rgba(226,90,88,0.16);color:#fba4a3}

/* Relevance badges */
.wiz9-cmp-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;text-transform:uppercase;letter-spacing:.03em}
.wiz9-cmp-badge--applicable{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-cmp-badge--na{background:#262219;color:#b1a992}
.wiz9-cmp-badge--pending{background:rgba(212,184,96,0.16);color:#ecd489}
.wiz9-cmp-badge--blocked{background:rgba(226,90,88,0.16);color:#fba4a3}
.wiz9-cmp-obl{font-size:10px;color:var(--color-text-tertiary);font-style:italic;white-space:nowrap}

/* Article body */
.wiz9-cmp-art-body{padding:0 24px 20px;background:var(--color-bg,#211d15)}
.wiz9-cmp-reason{font-size:12px;line-height:1.55;padding:8px 12px;border-radius:5px;margin:10px 0}
.wiz9-cmp-reason--applicable{background:rgba(52,199,120,0.10);color:#8cebb0;border-left:3px solid #46c17f}
.wiz9-cmp-reason--na{background:#211d15;color:#b1a992;border-left:3px solid rgba(240,232,208,0.30)}
.wiz9-cmp-reason--pending{background:rgba(212,184,96,0.12);color:#ecd489;border-left:3px solid #e0b94a}
.wiz9-cmp-reason--blocked{background:rgba(226,90,88,0.12);color:#fba4a3;border-left:3px solid #ec6a68}

/* View wrappers — the two views within each article body */
.wiz9-cmp-view-wrap{margin-top:14px;border:1px solid var(--color-border);border-radius:8px;overflow:hidden}
.wiz9-cmp-view-wrap--risk{margin-top:10px}
.wiz9-cmp-view-hdr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--color-border)}
.wiz9-cmp-view-hdr--compliance{background:rgba(80,150,225,0.12)}
.wiz9-cmp-view-hdr--risk{background:rgba(226,90,88,0.12)}
.wiz9-cmp-view-icon{font-size:14px;flex-shrink:0;margin-top:1px}
.wiz9-cmp-view-title-wrap{display:flex;flex-direction:column;gap:2px}
.wiz9-cmp-view-title{font-size:12px;font-weight:700;color:var(--color-text-primary)}
.wiz9-cmp-view-sub{font-size:11px;color:var(--color-text-secondary);line-height:1.4}

/* Empty state */
.wiz9-cmp-empty{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:4px 0}
.wiz9-cmp-empty--indent{padding:10px 14px}

/* HS list inside compliance view */
.wiz9-cmp-hs-list{display:flex;flex-direction:column;gap:0;padding:4px 0}
.wiz9-cmp-hs-item{padding:10px 14px;border-bottom:1px solid rgba(138,130,235,0.16)}
.wiz9-cmp-hs-item:last-child{border-bottom:none}
.wiz9-cmp-hs-ref-row{display:flex;gap:8px;align-items:flex-start;margin-bottom:6px}
.wiz9-cmp-ref-tag{font-size:10px;font-weight:600;font-family:monospace;padding:2px 6px;background:rgba(138,130,235,0.12);border:1px solid rgba(138,130,235,0.40);border-radius:3px;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-hs-txt{display:flex;flex-direction:column;gap:1px}
.wiz9-cmp-hs-name{font-size:12px;font-weight:600;color:var(--color-text-primary)}
.wiz9-cmp-hs-desc{font-size:11px;color:var(--color-text-secondary);line-height:1.45}

/* Controls + tests area inside each HS item */
.wiz9-cmp-hs-impl{padding:6px 0 2px 12px;border-left:2px solid rgba(138,130,235,0.40);margin-left:4px;display:flex;flex-direction:column;gap:4px}

/* Shared sub-label */
.wiz9-cmp-sub-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:4px 0 3px}

/* Test rows */
.wiz9-cmp-test-row{display:flex;align-items:flex-start;gap:6px;padding-top:2px}
.wiz9-cmp-test-icon{font-size:11px;flex-shrink:0;margin-top:2px}
.wiz9-cmp-test-chips{display:flex;flex-wrap:wrap;gap:4px}
.wiz9-cmp-test-chip{font-size:10px;font-weight:500;padding:2px 7px;border-radius:4px;background:rgba(52,199,120,0.10);border:1px solid rgba(52,199,120,0.40);color:#8cebb0;cursor:default;white-space:nowrap}
.wiz9-cmp-test-chip:hover{background:rgba(52,199,120,0.16)}

/* Risk items (inside risk view wrapper) */
.wiz9-cmp-risk-item{padding:10px 14px;border-bottom:1px solid rgba(226,90,88,0.40)}
.wiz9-cmp-risk-item:last-child{border-bottom:none}
.wiz9-cmp-risk-hdr{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.wiz9-cmp-risk-id{font-size:10px;font-weight:700;font-family:monospace;color:var(--color-text-tertiary)}
.wiz9-cmp-src-tag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px}
.wiz9-cmp-src-tag--legal{background:rgba(138,130,235,0.16);color:#bfb8ff}
.wiz9-cmp-risk-name{font-size:12px;font-weight:600;color:var(--color-text-primary)}

/* Controls */
.wiz9-cmp-ctrl-wrap{margin-bottom:8px}
.wiz9-cmp-ctrl-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;background:#211d15;margin-bottom:3px;flex-wrap:wrap}
.wiz9-cmp-ctrl-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.wiz9-cmp-ctrl-dot--hs{background:#bfb8ff}
.wiz9-cmp-ctrl-dot--fs{background:#8b5cf6}
.wiz9-cmp-ctrl-id{font-size:10px;font-weight:600;font-family:monospace;color:var(--color-text-tertiary);white-space:nowrap}
.wiz9-cmp-ctrl-name{font-size:11px;color:var(--color-text-secondary);flex:1;min-width:0}
.wiz9-cmp-task-chips{display:flex;align-items:center;gap:3px;flex-wrap:wrap}
.wiz9-cmp-task-chip{font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(138,130,235,0.16);color:#bfb8ff;white-space:nowrap;cursor:default}

/* Test plans */
.wiz9-cmp-tp-wrap{border-top:1px solid rgba(226,90,88,0.40);padding-top:8px}
.wiz9-cmp-tp-row{display:flex;align-items:flex-start;gap:8px;padding:4px 0;flex-wrap:wrap}
.wiz9-cmp-tp-name{font-size:11px;color:var(--color-text-secondary);flex:1;min-width:0}

/* Risk type section labels in wizard tab */
.section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-tertiary);margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--color-border)}

/* Compliance additions section in wizard tab */
.wiz9-comp-adds-wrap{margin-top:24px;border:1px solid rgba(138,130,235,0.40);border-radius:8px;overflow:hidden}
.wiz9-comp-adds-hdr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(80,150,225,0.12);border-bottom:1px solid rgba(138,130,235,0.40)}
.wiz9-comp-adds-icon{font-size:14px;flex-shrink:0}
.wiz9-comp-adds-title-wrap{display:flex;flex-direction:column;gap:2px}
.wiz9-comp-adds-title{font-size:12px;font-weight:700;color:#bfb8ff}
.wiz9-comp-adds-sub{font-size:11px;color:var(--color-text-secondary);line-height:1.4}
.wiz9-comp-adds-body{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.wiz9-comp-adds-empty{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0}
.wiz9-comp-add-item{display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(138,130,235,0.10);border-radius:5px;flex-wrap:wrap}
.wiz9-comp-adds-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(138,130,235,0.16);color:#bfb8ff;white-space:nowrap}

/* DPIA additions section in wizard tab */
.wiz9-dpia-adds-wrap{margin-top:24px;border:1px solid rgba(93,202,165,0.45);border-radius:8px;overflow:hidden}
.wiz9-dpia-adds-hdr{display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:rgba(93,202,165,0.10);border-bottom:1px solid rgba(93,202,165,0.45)}
.wiz9-dpia-adds-icon{flex-shrink:0;color:#8ce3c6;margin-top:1px}
.wiz9-dpia-adds-title-wrap{display:flex;flex-direction:column;gap:2px}
.wiz9-dpia-adds-title{font-size:12px;font-weight:700;color:#8ce3c6}
.wiz9-dpia-adds-sub{font-size:11px;color:var(--color-text-secondary);line-height:1.4}
.wiz9-dpia-adds-body{padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.wiz9-dpia-adds-empty{font-size:12px;color:var(--color-text-tertiary);font-style:italic;margin:0}
.wiz9-dpia-add-item{display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(93,202,165,0.10);border-radius:5px;flex-wrap:wrap}
.wiz9-dpia-dot{width:7px;height:7px;border-radius:50%;background:#d4b860;flex-shrink:0}
.wiz9-dpia-add-name{font-size:12px;color:var(--color-text-primary);flex:1}
.wiz9-dpia-badge{font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(93,202,165,0.16);color:#8ce3c6;white-space:nowrap}

.wiz9-cmp-count--ctrl{background:rgba(52,199,120,0.16);color:#8cebb0}
.wiz9-cmp-count--test{background:rgba(212,184,96,0.16);color:#ecd489}

/* Gap / N/A badges on HS items */
.wiz9-cmp-gap-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);color:#c2410c;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-na-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:#262219;border:1px solid rgba(240,232,208,0.30);color:#b1a992;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-na-btn{font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;border:1px solid rgba(240,232,208,0.30);background:#211d15;color:#b1a992;cursor:pointer;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-na-btn:hover{background:#262219}
.wiz9-cmp-na-btn--edit{color:#8ce3c6;border-color:rgba(93,202,165,0.45);background:rgba(93,202,165,0.10)}
.wiz9-cmp-na-btn--edit:hover{background:rgba(93,202,165,0.16)}
.wiz9-cmp-na-reason{font-size:11px;color:#b1a992;font-style:italic;padding:4px 8px 6px;border-left:2px solid rgba(240,232,208,0.30);margin:4px 0 2px}
.wiz9-cmp-na-form{margin:8px 0 4px;padding:10px 12px;background:#211d15;border:1px solid #2e2a1f;border-radius:6px;display:flex;flex-direction:column;gap:8px}
.wiz9-cmp-na-form-lbl{font-size:11px;font-weight:600;color:#b1a992;text-transform:uppercase;letter-spacing:.04em}
.wiz9-cmp-na-textarea{font-size:12px;color:#1e293b;border:1px solid rgba(240,232,208,0.30);border-radius:4px;padding:6px 8px;resize:vertical;font-family:inherit;line-height:1.4;width:100%;box-sizing:border-box}
.wiz9-cmp-na-textarea:focus{outline:none;border-color:#8ce3c6}
.wiz9-cmp-na-form-btns{display:flex;gap:6px;flex-wrap:wrap}
.wiz9-cmp-na-confirm-btn{font-size:12px;font-weight:600;padding:5px 12px;border-radius:4px;border:none;background:#8ce3c6;color:#241d08;cursor:pointer}
.wiz9-cmp-na-confirm-btn:hover{background:#8ce3c6}
.wiz9-cmp-na-cancel-btn{font-size:12px;font-weight:500;padding:5px 12px;border-radius:4px;border:1px solid #2e2a1f;background:var(--color-surface);color:#b1a992;cursor:pointer}
.wiz9-cmp-na-cancel-btn:hover{background:#211d15}
.wiz9-cmp-na-clear-btn{font-size:12px;font-weight:500;padding:5px 12px;border-radius:4px;border:1px solid rgba(226,90,88,0.50);background:var(--color-surface);color:#ec6a68;cursor:pointer;margin-left:auto}
.wiz9-cmp-na-clear-btn:hover{background:rgba(226,90,88,0.12)}

/* Sub-label variants */
.wiz9-cmp-sub-lbl--comp{color:#bfb8ff}
.wiz9-cmp-sub-lbl--avail{color:#c2410c}
.wiz9-cmp-sub-lbl--fs{color:#bfb8ff}
.wiz9-cmp-self-cert-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(138,130,235,0.16);color:#bfb8ff;border:1px solid #c4b5fd;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-self-cert-badge--sm{font-size:10px;padding:1px 6px}
.wiz9-cmp-fs-row{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:4px;background:rgba(138,130,235,0.10);margin-bottom:3px;flex-wrap:wrap}
.wiz9-cmp-fs-stmt{font-size:12px;color:#bfb8ff;background:rgba(138,130,235,0.10);border:1px solid rgba(138,130,235,0.40);border-radius:5px;padding:8px 12px;margin:2px 0 8px 16px;line-height:1.55}
.wiz9-fs-ctrl-card{border-color:rgba(138,130,235,0.40)!important;background:rgba(138,130,235,0.10)!important}
.wiz9-fs-src-badge{background:rgba(138,130,235,0.16)!important;color:#bfb8ff!important;border:1px solid #c4b5fd!important}
.wiz9-ctrl-section-label--fs{color:#bfb8ff}

/* Available controls row (compliance team adds) */
.wiz9-cmp-avail-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;background:rgba(224,120,80,0.12);border:1px solid rgba(224,120,80,0.40);margin-bottom:3px;flex-wrap:wrap}
.wiz9-cmp-add-btn{font-size:11px;font-weight:600;color:#241d08;background:#bfb8ff;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;white-space:nowrap;flex-shrink:0}
.wiz9-cmp-add-btn:hover{background:#bfb8ff}

/* Remove button on compliance additions */
.wiz9-cmp-remove-btn{font-size:10px;font-weight:600;color:#fba4a3;background:none;border:1px solid rgba(226,90,88,0.50);border-radius:4px;padding:2px 6px;cursor:pointer;white-space:nowrap;margin-left:auto;flex-shrink:0}
.wiz9-cmp-remove-btn:hover{background:rgba(226,90,88,0.12)}

/* Compliance save bar */
.wiz9-cmp-save-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 24px;background:rgba(138,130,235,0.10);border-bottom:1px solid rgba(138,130,235,0.40);flex-wrap:wrap}
.wiz9-cmp-save-summary{font-size:12px;color:#bfb8ff;font-weight:500}
.wiz9-cmp-save-btn{padding:7px 16px;background:#bfb8ff;color:#241d08;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.wiz9-cmp-save-btn:hover{background:#bfb8ff}
    `);
  }

  function _safeId(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
  }

})();
