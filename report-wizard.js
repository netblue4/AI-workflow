/* Report Wizard — AI System Conformity Assessment Report
   Aggregates outputs from Steps 3, 8, 9, 10 and tbl_ reference data.
   Generates a printable HTML conformity assessment document for AI Change Board submission.
   Satisfies Article 43 HS requirements [18286.16]–[18286.20].
   Mounts on step-11.
*/
(function () {
  'use strict';

  let _container = null, _record = null, _tbl = null;

  // ---- Public API ---------------------------------------------
  window.mountReportWizard = function (container) {
    _container = container;
    _record    = null;
    _tbl       = null;
    container.innerHTML = '<p style="padding:32px;color:#64748b;font-size:13px">Loading report data…</p>';
    _loadData();
  };

  // ---- Public: reuse a report section as a step's save summary ----
  // Each step renders the EXACT report section (same builder + same CSS) so the
  // assessor sees what will be submitted, and any later change to a section — or
  // its styling — reflects in both the report and the step summary automatically.
  let _sectionsDataP = null;
  function _readRecordFromStore() {
    try { const s = sessionStorage.getItem('ai_workflow_system_record'); return s ? JSON.parse(s) : {}; } catch (_) { return {}; }
  }
  window.ReportSections = {
    // Ensure the reference tables are loaded (idempotent, cached).
    ready() {
      if (!_sectionsDataP) _sectionsDataP = _fetchTables().catch(e => { _sectionsDataP = null; throw e; });
      return _sectionsDataP;
    },
    // Returns an auto-sized <iframe> rendering the named section with the report's
    // own CSS. kind: 'classification' | 'dpia' | 'risk' | 'traceability'.
    async frame(kind, record) {
      await this.ready();
      _record = record || _readRecordFromStore();
      const s3 = _record?.['step-3'] || null;
      const s4 = _record?.['step-4'] || null;
      const s8 = _record?.['step-5'] || null;
      const s9 = _record?.['step-6'] || null;
      const s10 = _record?.['step-7'] || null;
      let inner = '';
      if (kind === 'classification')    inner = _classificationSection(s3);
      else if (kind === 'dpia')         inner = _dpiaSummarySection(s4);
      else if (kind === 'risk')         inner = _riskAssessmentSection(s8, s10);
      else if (kind === 'traceability') inner = _section3Content(s3, s9, s10);
      const f = document.createElement('iframe');
      f.className = 'rpt-embed-frame';
      f.setAttribute('scrolling', 'no');
      // No background override — inherit the report's own theme (dark or light,
      // via its prefers-color-scheme rules) so the embed matches the report.
      f.style.cssText = 'width:100%;border:0;display:block;border-radius:8px';
      f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${_reportCSS()}</style>`
        + `<style>html,body{margin:0;padding:14px 16px}</style></head>`
        + `<body>${inner || '<p class="section-meta">Nothing recorded yet.</p>'}</body></html>`;
      const size = () => { try { f.style.height = (f.contentDocument.documentElement.scrollHeight + 2) + 'px'; } catch (_) {} };
      f.addEventListener('load', () => { size(); setTimeout(size, 50); setTimeout(size, 250); });
      return f;
    }
  };

  // ---- Data loading -------------------------------------------
  // Fetch the reference tables into _tbl. Shared by the full report mount and by
  // the ReportSections API (so a step can render a report section on its own).
  async function _fetchTables() {
    const [rRes, rcRes, hsRes, srRes, wfRes, lgRes] = await Promise.all([
      fetch('tbl_Risks.json'),
      fetch('tbl_Risk_Controls.json'),
      fetch('tbl_Harmonised_Standards.json'),
      fetch('tbl_AI_SR_Controls.json'),
      fetch('workflow.json'),
      fetch('step5-legal-risk-guidance.json')
    ]);
    if (!rRes.ok || !rcRes.ok || !hsRes.ok || !srRes.ok || !wfRes.ok) throw new Error('fetch failed');
    const [risks, riskControls, hs, srControls, workflow] = await Promise.all([
      rRes.json(), rcRes.json(), hsRes.json(), srRes.json(), wfRes.json()
    ]);
    const legalGuidance = lgRes.ok ? await lgRes.json() : {};
    _tbl = { risks, riskControls, hs, testControls: [], srControls, workflow, legalGuidance };
    return _tbl;
  }

  async function _loadData() {
    try {
      await _fetchTables();
    } catch (_) {
      _container.innerHTML = '<p style="padding:32px;color:#dc2626">Could not load reference data files.</p>';
      return;
    }
    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}
    _render();
  }

  // ---- UI shell -----------------------------------------------
  function _render() {
    _container.innerHTML = '';
    _injectStyles();

    const shell = document.createElement('div');
    shell.className = 'rpt-shell';

    // Action bar
    const bar = document.createElement('div');
    bar.className = 'rpt-action-bar';
    const barTitle = document.createElement('div');
    barTitle.className = 'rpt-bar-title';
    barTitle.textContent = 'AI System Conformity Assessment Report';
    const printBtn = document.createElement('button');
    printBtn.className = 'rpt-print-btn';
    printBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg> Print / Export PDF`;
    printBtn.addEventListener('click', _handlePrint);
    bar.appendChild(barTitle);
    bar.appendChild(printBtn);
    shell.appendChild(bar);

    // Iframe preview (built first so the approval panel can refresh it)
    const iframe = document.createElement('iframe');
    iframe.className = 'rpt-iframe';
    iframe.setAttribute('title', 'Conformity Assessment Report Preview');

    // Digital AI Change Board approval — replaces the paper signature.
    // Ticking the box + naming the approver records step-8 evidence digitally.
    if (window.WizUtils) {
      const approval = WizUtils.buildAttestation({
        stepId: 'step-8',
        title: 'AI Change Board Decision',
        statement: 'The AI Change Board has reviewed this conformity assessment and approves the identified AI system for deployment.',
        nameLabel: 'Approver name (AI Change Board)',
        onChange: () => {
          _record = WizUtils.loadRecord();
          iframe.srcdoc = _buildReportHTML();
        }
      });
      shell.appendChild(approval);
    }

    shell.appendChild(iframe);
    _container.appendChild(shell);

    iframe.srcdoc = _buildReportHTML();
  }

  function _handlePrint() {
    const html = _buildReportHTML();
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  }

  // ============================================================
  // ---- Report HTML builder -----------------------------------
  // ============================================================
  function _buildReportHTML() {
    const s3  = _record?.['step-3']  || null;
    const s4  = _record?.['step-4']  || null;
    const s8  = _record?.['step-5']  || null;
    const s9  = _record?.['step-6']  || null;
    const s10 = _record?.['step-7']  || null;
    const meta = _record?._meta      || {};

    const today = new Date().toISOString().slice(0, 10);
    const useCase = meta.use_case_id || s3?.use_case_id || '—';
    const assessedBy = meta.assessed_by || s3?.classified_by || '—';

    // Report structure = Part A (regulator conformity dossier) then Part B
    // (internal governance & sign-off). The plain-language reader's guide in the
    // "About the framework" page mirrors this section list — KEEP IN SYNC: if a
    // section below is renamed, reordered, added or removed, update
    // _REPORT_PART_A / _REPORT_PART_B in about-framework.js to match.
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Conformity Assessment Report — ${_esc(useCase)}</title>
<style>${_reportCSS()}</style>
</head>
<body>
${_coverPage(s3, s8, s9, s10, meta, today, useCase, assessedBy)}

${_partBanner('A', 'EU AI Act Conformity Dossier', 'The formal EU AI Act conformity assessment for this system — the complete evidence dossier. It is produced first and submitted to the AI Change Board for review, and can be printed and provided to a regulator on its own.')}
${_section(1, 'System Classification', 'What the system is and how it is classified under the EU AI Act — which determines exactly which legal obligations apply. Confirms the assessment addressed the right requirements.', _classificationSection(s3))}
${_section(2, 'Risk Identification', 'The risks this system poses, identified against the pre-mapped catalogue (the Article&nbsp;9 risk-management step). Shows the hazards were named systematically, not ad hoc.', _riskAssessmentSection(s8, s10))}
${_section(3, 'Data Privacy Impact Assessment (DPIA)', 'A summary of the GDPR Article&nbsp;35 Data Protection Impact Assessment: the data processed, the lawful basis, the privacy risks, and the inherent and residual risk ratings recorded in Step&nbsp;4.', _dpiaSummarySection(s4))}
${_section(4, 'Compliance &amp; Requirement Traceability', 'Maps each applicable AI Act obligation to the harmonised-standard requirement that makes it testable, and the evidence that the requirement is implemented. This is the core evidence that every obligation is covered — nothing unaddressed.', _section3Content(s3, s9, s10))}
${_section(5, 'Conformity Assessment Conclusion', 'The assessor&rsquo;s conclusion that, on the evidence above, the system meets its applicable requirements — the basis of conformity submitted to the Board for decision.', _conformityConclusionSection(s3, s9, s10, today, useCase, assessedBy))}

${_partDivider('End of Part&nbsp;A — EU AI Act Conformity Dossier. The assessment above is submitted to the AI Change Board; Part&nbsp;B records the Board&rsquo;s review and decision on it.')}

${_partBanner('B', 'Internal Governance &amp; Sign-off', 'The internal governance layer: the Board&rsquo;s at-a-glance status, then the AI Tool &amp; Use Case Approval Form — the organisation&rsquo;s own approval record, populated from this assessment and signed off by the requester, InfoSec Governance and the Change Board.')}
${_ragSummaryPage(s9, s10)}
${_section(6, 'AI Tool &amp; Use Case Approval Form', 'The organisation&rsquo;s internal approval form, pre-filled from this assessment. It carries the requester, InfoSec Governance and AI Change Board sign-off, and its approval status records the Board&rsquo;s decision — which on approval authorises deployment and triggers the formal EU Declaration of Conformity (Article&nbsp;47).', _approvalFormSection(s3, s8, s9, s10, meta, today))}
</body>
</html>`;
  }

  // ============================================================
  // ---- Legal domain: HS requirements as the treatment unit ---
  // Legal/regulatory risks are treated by activating harmonised-standard (HS)
  // requirements, not by the legacy `control_source: "Harmonised_Standard"`
  // controls. These helpers reconstruct the legal treatment picture from the
  // durable step-6 (`selected_hs`) and step-7 (`hs_activation`) records so the
  // report renders identically whether or not those controls still exist.
  // ============================================================
  function _hsByRef() {
    return new Map((_tbl.hs || []).map(h => [h.standard_ref, h]));
  }

  // pk_Risk_Control_ID set for the legacy Harmonised_Standard controls, so they
  // can be excluded wherever HS requirements now stand in for them.
  function _legalHsControlIds() {
    return new Set((_tbl.riskControls || [])
      .filter(rc => rc.control_source === 'Harmonised_Standard')
      .map(rc => rc.pk_Risk_Control_ID));
  }

  function _hsActStatus(s10, riskId, ref) {
    return s10?.hs_activation?.[riskId]?.[ref]?.status || 'not_started';
  }

  // Per-risk selected HS refs, preferring step-6 `selected_hs`; falls back to the
  // selected Harmonised_Standard controls for legacy records saved before that
  // field existed (yields nothing once those controls are removed — by which
  // point every record carries `selected_hs`).
  function _selectedHsByRisk(s9) {
    const sel = s9?.selected_hs;
    if (sel && Object.keys(sel).length) return sel;
    const derived = {};
    (s9?.risk_controls || [])
      .filter(c => c.selected && c.control_source === 'Harmonised_Standard')
      .forEach(c => {
        (c.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean).forEach(ref => {
          (derived[c.risk_id] = derived[c.risk_id] || []);
          if (!derived[c.risk_id].includes(ref)) derived[c.risk_id].push(ref);
        });
      });
    return derived;
  }

  // Synthetic treatment rows for the legal domain, shaped like `risk_controls`
  // so they drop into the existing schedule / RAG / outstanding rendering.
  // control_id is a stable "riskId::ref" key; status comes from HS activation.
  function _legalHsTreatments(s9, s10) {
    const hsByRef = _hsByRef();
    const rows = [];
    const statusByKey = new Map();
    Object.entries(_selectedHsByRisk(s9)).forEach(([riskId, refs]) => {
      (Array.isArray(refs) ? refs : []).forEach(ref => {
        const h   = hsByRef.get(ref);
        const key = riskId + '::' + ref;
        rows.push({
          control_id:   key,
          control_name: h?.standard_name || ref,
          fk_Harmonised_Standard_IDs: ref,
          risk_id:      riskId,
          control_source: 'Harmonised_Standard_Req',
          selected:     true
        });
        statusByKey.set(key, _hsActStatus(s10, riskId, ref));
      });
    });
    return { rows, statusByKey };
  }

  // Is an HS requirement selected as a treatment for any legal risk (step-6)?
  function _hsSelectedAnywhere(s9, ref) {
    return Object.values(_selectedHsByRisk(s9)).some(refs => Array.isArray(refs) && refs.includes(ref));
  }

  // Risks that selected a given HS ref, each with its step-7 activation status.
  function _hsRisksForRef(s9, s10, ref) {
    const out = [];
    Object.entries(_selectedHsByRisk(s9)).forEach(([riskId, refs]) => {
      if (Array.isArray(refs) && refs.includes(ref)) out.push({ riskId, status: _hsActStatus(s10, riskId, ref) });
    });
    return out;
  }

  function _hsStatusShort(s) {
    if (s === 'evidence_provided') return '✓ Evidenced';
    if (s === 'waived')            return '— Waived';
    if (s === 'in_progress')       return '◑ In progress';
    return '○ Not started';
  }

  // Per-risk requirement stats from step-6 selection + step-7 evidence.
  // Returns Map<riskId, { total, done, refs:[{ref,name,status}] }>.
  function _reqStatsByRisk(s9, s10) {
    const hsByRef = _hsByRef();
    const DONE = new Set(['evidence_provided', 'waived']);
    const out = new Map();
    Object.entries(_selectedHsByRisk(s9 || {})).forEach(([riskId, refs]) => {
      const list = (Array.isArray(refs) ? refs : []).map(ref => ({
        ref, name: hsByRef.get(ref)?.standard_name || ref, status: _hsActStatus(s10, riskId, ref)
      }));
      out.set(riskId, { total: list.length, done: list.filter(r => DONE.has(r.status)).length, refs: list });
    });
    return out;
  }

  // ---- RAG Summary Page (CAB Sign-off) ----------------------
  function _ragSummaryPage(s9, s10) {
    if (!s9) return '';

    const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));
    const stats = _reqStatsByRisk(s9, s10);

    let totalReq = 0, doneReq = 0;
    stats.forEach(s => { totalReq += s.total; doneReq += s.done; });
    const reqStatClass = totalReq === 0 ? 'warn' : (doneReq === totalReq ? 'ok' : (doneReq > 0 ? 'warn' : 'bad'));

    let overallGreen = 0, overallAmber = 0, overallRed = 0;
    const riskRows = [];
    stats.forEach((s, riskId) => {
      const riskName = riskNameById.get(riskId) || riskId;
      const allDone = s.total > 0 && s.done === s.total;
      let rag;
      if (allDone)          { rag = 'green'; overallGreen++; }
      else if (s.done > 0)  { rag = 'amber'; overallAmber++; }
      else                  { rag = 'red';   overallRed++;   }
      const reqCls = s.total === 0 ? 'na' : (s.done === s.total ? 'ok' : (s.done > 0 ? 'warn' : 'na'));
      const residualLevel = s10?.residual_risks?.[riskId]?.level;
      const residualHtml  = residualLevel
        ? `<span class="rag-residual rag-residual--${_esc(residualLevel)}">${_esc(residualLevel.charAt(0).toUpperCase() + residualLevel.slice(1))}</span>`
        : `<span class="rag-residual rag-residual--na">—</span>`;
      riskRows.push(`<tr>
        <td><span class="risk-id-badge">${_esc(riskId)}</span></td>
        <td>${_esc(riskName)}</td>
        <td class="center"><span class="rag-count rag-count--${reqCls}">${s.done}/${s.total}</span></td>
        <td class="center">${residualHtml}</td>
        <td class="center"><span class="rag-pill rag-pill--${rag}">${rag.charAt(0).toUpperCase() + rag.slice(1)}</span></td>
      </tr>`);
    });

    const overall = overallRed > 0 ? 'red' : (overallAmber > 0 ? 'amber' : 'green');
    const overallLabel = overall === 'green' ? 'All Green' : (overall === 'amber' ? 'Amber' : 'Red');

    return `
<div class="rag-page page-break">
  <div class="rag-page-hdr">
    <div class="rag-page-title">Change Board Sign-off Summary</div>
    <span class="rag-pill rag-pill--${overall} rag-pill--lg">${overallLabel}</span>
  </div>
  <p class="section-desc">A one-page status view for the decision: overall RAG, how many harmonised-standard requirements are evidenced, and the residual risk per risk — the Board's go/no-go at a glance.</p>
  <div class="rag-stat-row">
    <div class="rag-stat rag-stat--${reqStatClass}">
      <div class="rag-stat-num">${doneReq}/${totalReq}</div>
      <div class="rag-stat-lbl">Requirements evidenced</div>
    </div>
    <div class="rag-stat rag-stat--${overall === 'green' ? 'ok' : (overall === 'amber' ? 'warn' : 'bad')}">
      <div class="rag-stat-num">${stats.size}</div>
      <div class="rag-stat-lbl">Risks treated</div>
    </div>
  </div>
  <table class="data-table">
    <thead><tr><th>Risk ID</th><th>Risk Name</th><th class="center">Requirements</th><th class="center">Residual Risk</th><th class="center">Status</th></tr></thead>
    <tbody>${riskRows.join('')}</tbody>
  </table>
  <p class="section-meta">DPIA security measures are assessed as a whole in the DPIA and are not shown in the per-risk table above.</p>
</div>`;
  }

  // ---- Outstanding Items Section -----------------------------
  function _outstandingItemsSection(s9, s10) {
    let html = '';
    if (!s9) {
      return `<div class="outstanding-warn">Step 6 (Control Identification) not yet completed.</div>`;
    }
    if (!s10 || !s10.hs_activation) {
      return `<div class="outstanding-warn">Step 7 (Residual Risk) not yet completed.</div>`;
    }

    const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));

    // Outstanding requirements — selected in Step 6 but not yet evidenced/waived.
    const outstanding = [];
    _reqStatsByRisk(s9, s10).forEach((s, riskId) => {
      s.refs.forEach(r => {
        if (r.status === 'evidence_provided' || r.status === 'waived') return;
        outstanding.push({ ref: r.ref, name: r.name, riskName: riskNameById.get(riskId) || riskId, status: r.status });
      });
    });

    if (outstanding.length === 0) {
      return `<div class="outstanding-clear">✓ Every selected requirement is evidenced or waived. Ready for CAB sign-off.</div>`;
    }

    html += `<h3 class="sub-heading">Outstanding Requirements (${outstanding.length})</h3>
<table class="data-table">
  <thead><tr><th>Requirement</th><th>Name</th><th>Risk</th><th>Current Status</th></tr></thead>
  <tbody>
  ${outstanding.map(o => `<tr>
    <td class="mono">${_esc(o.ref)}</td>
    <td>${_esc(o.name || '—')}</td>
    <td>${_esc(o.riskName)}</td>
    <td>${_ctrlStatusPill(o.status)}</td>
  </tr>`).join('')}
  </tbody>
</table>`;
    return html;
  }

  // ---- Cover page --------------------------------------------
  function _coverPage(s3, s8, s9, s10, meta, today, useCase, assessedBy) {
    const tier     = s3?.axis_a?.tier_label || '—';
    const category = s3?.axis_b?.ai_act_outcome || '—';
    const role     = s3?.axis_b?.organisation_role || '—';
    const artCount = s3?.axis_b?.applicable_articles?.length ?? 0;

    const legalSel   = s8?.legal_assessment?.selected_count ?? '—';
    const legalTotal = s8?.legal_assessment?.total_risks    ?? '—';

    // Legal risks are treated by implementing harmonised-standard requirements.
    let reqSelectedCount = 0;
    _reqStatsByRisk(s9, s10).forEach(s => { reqSelectedCount += s.total; });
    const reqSelected = s9?.total_requirements ?? reqSelectedCount;
    const reqTotal    = s10?.total_requirements ?? reqSelected;
    const reqEvid     = s10?.requirements_evidenced ?? 0;
    const reqWaived   = s10?.requirements_waived ?? 0;
    const reqPend     = s10?.requirements_pending ?? '—';

    const steps = [
      ['System Classification',  !!s3],
      ['Risk Identification',    !!s8?.legal_assessment?.completed],
      ['Requirement Selection',  !!s9],
      ['Requirement Evidence',   !!s10]
    ];

    return `
<div class="cover page-break">
  <div class="cover-header">
    <div class="cover-org">AI Governance Workflow</div>
    <div class="cover-doc-type">CONFORMITY ASSESSMENT REPORT</div>
  </div>
  <div class="cover-body">
    <table class="cover-meta-table">
      <tr><td class="cmt-label">Use Case / System ID</td><td class="cmt-value">${_esc(useCase)}</td></tr>
      <tr><td class="cmt-label">Report Date</td><td class="cmt-value">${today}</td></tr>
      <tr><td class="cmt-label">Prepared By</td><td class="cmt-value">${_esc(assessedBy)}</td></tr>
      <tr><td class="cmt-label">Tier Classification</td><td class="cmt-value">${_esc(tier)}</td></tr>
      <tr><td class="cmt-label">EU AI Act Category</td><td class="cmt-value"><span class="cat-badge cat-badge--${_catKey(category)}">${_esc(category.replace(/_/g,' '))}</span></td></tr>
      <tr><td class="cmt-label">Organisation Role</td><td class="cmt-value">${_cap(role)}</td></tr>
      <tr><td class="cmt-label">Applicable Articles</td><td class="cmt-value">${artCount}</td></tr>
    </table>

    <div class="cover-stats">
      <div class="cs-box">
        <div class="cs-num">${legalSel}</div>
        <div class="cs-lbl">Risks accepted<br><span class="cs-sub">${legalTotal} legal/regulatory risks assessed</span></div>
      </div>
      <div class="cs-box">
        <div class="cs-num">${reqSelected}</div>
        <div class="cs-lbl">Requirements selected<br><span class="cs-sub">harmonised-standard requirements to implement</span></div>
      </div>
      <div class="cs-box">
        <div class="cs-num">${reqEvid + reqWaived}${typeof reqTotal === 'number' ? `/${reqTotal}` : ''}</div>
        <div class="cs-lbl">Requirements evidenced<br><span class="cs-sub">${reqEvid} evidenced · ${reqWaived} waived · ${reqPend} pending</span></div>
      </div>
    </div>

    <div class="cover-status-block">
      <div class="csb-title">Workflow Completion Status</div>
      ${steps.map(([lbl, done]) => `
      <div class="csb-row">
        <span class="csb-icon ${done ? 'csb-icon--done' : 'csb-icon--pend'}">${done ? '✓' : '○'}</span>
        <span class="csb-lbl">${lbl}</span>
        <span class="csb-status ${done ? 'csb-status--done' : 'csb-status--pend'}">${done ? 'Complete' : 'Pending'}</span>
      </div>`).join('')}
    </div>

    <div class="cover-framework">
      <p>This report was generated by the AI Governance Workflow and constitutes the organisation's formal
      conformity assessment record under <strong>Article 43</strong> of Regulation (EU) 2024/1689 (EU AI Act)
      and the organisation's quality management obligations under <strong>Article 17</strong> and
      <strong>ISO/IEC 42001</strong>. It is intended for submission to the AI Change Board for sign-off.</p>
    </div>
  </div>
</div>`;
  }

  // ---- Section 1: System Classification ----------------------
  function _classificationSection(s3) {
    if (!s3) return _notComplete('Step 3 — System Classification has not yet been completed.');

    const axA = s3.axis_a || {};
    const axB = s3.axis_b || {};
    const arts = axB.applicable_articles || [];
    const subMod = axB.substantial_modification_applies;
    const override = axB.art25_override;

    let html = `
<h3 class="sub-heading">Axis A — Tier Classification</h3>
<table class="data-table">
  <tr><td class="dt-label">Tier</td><td>${_esc(axA.tier_label || axA.tier || '—')}</td></tr>
  <tr><td class="dt-label">Classification Date</td><td>${_esc(s3.classification_date || '—')}</td></tr>
</table>

<h3 class="sub-heading">Axis B — EU AI Act Assessment</h3>
<table class="data-table">
  <tr><td class="dt-label">EU AI Act Category</td><td><span class="cat-badge cat-badge--${_catKey(axB.ai_act_outcome || '')}">${(axB.ai_act_outcome || '—').replace(/_/g,' ')}</span></td></tr>
  <tr><td class="dt-label">Organisation Role</td><td>${_cap(axB.organisation_role || '—')}</td></tr>
  <tr><td class="dt-label">Deployer Obligations</td><td>${axB.deployer_obligations_apply ? 'Yes' : 'No'}</td></tr>
  <tr><td class="dt-label">Transparency Obligations (Art.50)</td><td>${axB.transparency_obligations_apply ? 'Yes' : 'No'}</td></tr>
  <tr><td class="dt-label">Substantial Modification (Art.25)</td><td>${subMod ? (override ? 'Yes — legal counsel override applied; proceeding as Deployer' : 'Yes — organisation acting as Provider') : 'No'}</td></tr>
</table>`;

    if (s3.combined_outcome) {
      const co = s3.combined_outcome;
      html += `
<h3 class="sub-heading">Combined Outcome</h3>
<table class="data-table">
  <tr><td class="dt-label">Outcome</td><td>${_esc(co.outcome_label || '—')}</td></tr>
  <tr><td class="dt-label">AI Change Board Required</td><td>${co.change_board_required ? 'Yes' : 'No'}</td></tr>
  <tr><td class="dt-label">Conformity Assessment Required</td><td>${co.requires_conformity_assessment ? 'Yes' : 'No'}</td></tr>
  <tr><td class="dt-label">DPIA Required</td><td>${co.requires_dpia ? 'Yes' : 'No'}</td></tr>
</table>`;
    }

    if (arts.length > 0) {
      html += `
<h3 class="sub-heading">Applicable EU AI Act Articles (${arts.length})</h3>
<table class="data-table">
  <thead><tr><th>Article</th><th>Obligation Type</th><th>Trigger Reason</th></tr></thead>
  <tbody>
  ${arts.map(a => `<tr>
    <td class="mono">${_esc(a.article_number || '—')}</td>
    <td>${_esc((a.obligation_type || '').replace(/_/g,' '))}</td>
    <td class="reason-cell">${_esc(a.trigger_reason || '—')}</td>
  </tr>`).join('')}
  </tbody>
</table>`;
    } else {
      html += '<p class="empty-note">No articles applicable based on current classification.</p>';
    }

    return html;
  }

  // ---- DPIA summary section (Part A) -------------------------
  // A label/value summary of the Step 4 DPIA, formatted like the System
  // Classification section. Part B's DPIA Evidence cell points here as an
  // appendix the assessor prints alongside the approval form.
  function _dpiaSummarySection(s4) {
    if (!s4) return _notComplete('Step 4 — Data Protection Impact Assessment has not yet been completed.');
    const di = s4.data_types_identified || {};
    const list = a => (Array.isArray(a) && a.length) ? a.map(_esc).join(', ') : '—';
    const special = (di.special_category_data || []).filter(x => !/^none/i.test(x));

    let html = `
<h3 class="sub-heading">Assessment Summary</h3>
<table class="data-table">
  <tr><td class="dt-label">DPIA Completed</td><td>${_esc(s4.completion_date || '—')}</td></tr>
  <tr><td class="dt-label">Lawful Basis (GDPR Art.6)</td><td>${_esc(s4.lawful_basis || '—')}</td></tr>
  <tr><td class="dt-label">Inherent Risk</td><td>${_esc(s4.inherent_risk_rating || '—')}</td></tr>
  <tr><td class="dt-label">Residual Risk</td><td>${_esc(s4.residual_risk_rating || '—')}</td></tr>
  <tr><td class="dt-label">DPO Consulted</td><td>${_esc(s4.dpo_consulted || '—')}</td></tr>
  <tr><td class="dt-label">Art.36 Prior Consultation</td><td>${_esc(s4.art36_consultation_required || '—')}</td></tr>
</table>

<h3 class="sub-heading">Data Processed</h3>
<table class="data-table">
  <tr><td class="dt-label">Data Subjects</td><td>${list(di.data_subjects)}</td></tr>
  <tr><td class="dt-label">Personal Data</td><td>${list(di.standard_personal_data)}</td></tr>
  <tr><td class="dt-label">Special-Category Data</td><td>${special.length ? special.map(_esc).join(', ') : 'None'}</td></tr>
  <tr><td class="dt-label">Automated Decision-Making</td><td>${_esc(di.automated_decision_making || '—')}</td></tr>
  <tr><td class="dt-label">Security Measures</td><td>${list(di.security_measures)}</td></tr>
</table>`;

    const pr = di.privacy_risks || [];
    html += `
<h3 class="sub-heading">Privacy Risks Identified (${pr.length})</h3>`;
    html += pr.length
      ? `<table class="data-table"><tbody>${pr.map(r => `<tr><td>${_esc(r)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty-note">No privacy risks were recorded in the DPIA.</p>';
    return html;
  }

  // ---- Section 2: Risk Assessment ----------------------------
  // Section 2 = risk identification + the DPIA risk assessment. Split into two
  // reusable subsections so Step 5 (risk) and Step 4 (DPIA) can render the exact
  // same tables in their save summaries.
  function _riskAssessmentSection(s8, s10) {
    return _riskIdentificationSubsection(s8, s10) + _dpiaRiskSubsection();
  }

  function _riskIdentificationSubsection(s8, s10) {
    if (!s8) return _notComplete('Step 5 — Risk Identification has not yet been completed.');

    let html = '';

    const la = s8.legal_assessment;
    html += `<h3 class="sub-heading">Legal / Regulatory Risk Assessment (EU AI Act)</h3>`;
    if (!la?.completed) {
      html += _notComplete('Legal assessment not yet saved.');
    } else {
      const riskIdByName = new Map((_tbl.risks || []).map(r => [r.risk_name, r.pk_Risk_ID]));

      html += `<p class="section-meta">Completed: ${la.assessment_date} &nbsp;|&nbsp; ${la.selected_count} of ${la.total_risks} risks accepted</p>`;
      html += `<table class="data-table data-table--risk">
  <thead>
    <tr>
      <th style="width:20%">Risk</th>
      <th style="width:8%">Applicable</th>
      <th style="width:9%">Residual Risk</th>
      <th>Rationale</th>
    </tr>
  </thead>
  <tbody>`;

      (la.risks || []).forEach(r => {
        const riskId      = riskIdByName.get(r.risk_name);
        const residual    = s10?.residual_risks?.[riskId];
        const residualHtml = residual?.level
          ? `<span class="rag-residual rag-residual--${_esc(residual.level)}">${_esc(residual.level.charAt(0).toUpperCase() + residual.level.slice(1))}</span>`
          : '—';
        const ans     = (r.wizard_answer || '').toLowerCase();
        const ansKey  = ans === 'yes' ? 'yes' : ans === 'no' ? 'no' : ans === 'partially' ? 'partial' : 'na';
        const ansTxt  = ans === 'yes' ? 'Yes' : ans === 'no' ? 'No' : ans === 'partially' ? 'Partially' : _esc(r.wizard_answer || '—');
        const rowCls  = r.selected ? '' : ' class="row-dim"';
        // Treat the retired bulk-not-applicable stock phrase as "no justification".
        const _boiler = t => /^Not applicable\s*[—–-]\s*outside the scope of this use case\.?$/i.test((t||'').trim()) || /^Not applicable to this use case\.?$/i.test((t||'').trim());
        const rationale = (r.rationale && !_boiler(r.rationale))
          ? _esc(r.rationale)
          : `<span class="trace-none">—</span>`;

        html += `<tr${rowCls}>
      <td>${riskId ? `<span class="risk-id-badge">${_esc(riskId)}</span> ` : ''}${_esc(r.risk_name)}</td>
      <td><span class="ans-pill ans-pill--${ansKey}">${ansTxt}</span></td>
      <td class="center">${residualHtml}</td>
      <td class="reason-cell">${rationale}</td>
    </tr>`;
      });

      html += `</tbody></table>`;
    }

    return html;
  }

  // ---- DPIA Risk Assessment (also the Step 4 save summary) ----
  function _dpiaRiskSubsection() {
    const s4 = _record?.['step-4'];
    let html = `<h3 class="sub-heading">DPIA Risk Assessment</h3>`;
    if (!s4) {
      html += _notComplete('Step 4 — DPIA not yet completed.');
    } else {
      const pr   = (s4.data_types_identified || {}).privacy_risks || [];
      const pill = rating => rating
        ? `<span class="rag-residual rag-residual--${_esc((rating || '').toLowerCase())}">${_esc(rating)}</span>`
        : '—';
      html += `<p class="section-meta">Inherent risk: ${pill(s4.inherent_risk_rating)} &nbsp;|&nbsp; Residual risk: ${pill(s4.residual_risk_rating)} &nbsp;<span class="trace-none">(carried from the Step 4 DPIA)</span></p>`;
      if (pr.length) {
        html += `<ul style="margin:4px 0 0 18px;line-height:1.7">${pr.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>`;
      } else {
        html += _notComplete('No privacy risks recorded in the DPIA.');
      }
    }
    return html;
  }

  // ---- Section 3: Control Schedule ---------------------------
  // Full content of report Section 3: the traceability table, then the
  // Requirement Evidence Register (Requirements by risk + DPIA Controls).
  // Shared by the report and the Step 6/7 save summaries so they stay identical.
  function _section3Content(s3, s9, s10) {
    return _complianceTraceabilitySection(s3, s9, s10)
      + '<h3 class="sub-heading">Requirement Evidence Register</h3>'
      + '<p class="section-meta">The harmonised-standard requirements selected to treat each risk, grouped by risk, with the evidence status recorded in Step 7. Includes the DPIA security measures that support — but sit outside — the per-article map.</p>'
      + _controlScheduleSection(s9, s10);
  }

  function _controlScheduleSection(s9, s10) {
    if (!s9) return _notComplete('Step 6 — Control Identification has not yet been completed.');

    const riskCtrls = s9.risk_controls || [];
    const compAdds  = s9.compliance_additions || [];
    // DPIA security measures come from Step 4; their evidence status is in Step 7.
    const dpiaAdds  = ((_record?.['step-4']?.data_types_identified?.security_measures) || [])
      .map(m => ({ control_name: m }));

    const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));

    // Build lookup: control key → operational status from Step 7 (activation tab)
    const ctrlStatus = new Map();
    (s10?.controls || []).forEach(c => ctrlStatus.set(c.key, c.status));

    // Build lookup: control ID → HS standard refs
    const hsRefByCtrl = new Map((_tbl.riskControls || []).map(rc => [rc.pk_Risk_Control_ID, rc.fk_Harmonised_Standard_IDs || '']));
    // Standards cell: prefer the row's own HS refs (present on risk controls,
    // compliance additions and synthetic HS-requirement rows), else look up.
    const _hsCell = c => {
      const raw  = c.fk_Harmonised_Standard_IDs || hsRefByCtrl.get(c.control_id) || '';
      const refs = raw.split(',').map(s => s.trim()).filter(Boolean);
      return refs.length ? refs.map(r => `<span class="hs-ref-chip">${_esc(WizUtils.fmtStdRef(r))}</span>`).join(' ') : '<span class="ctrl-src src-eu">EU AI Act</span>';
    };

    // Framework_Statement controls are part of the governance framework; they
    // do not belong in the operational control schedule. Their HS coverage is
    // still reflected in the Compliance Traceability section.
    const _isFS = c => (c.control_source || '').includes('Framework');

    // Legal risks are treated by activating HS requirements; their status comes
    // from step-7 HS activation, and they replace the legacy HS controls here.
    const legal = _legalHsTreatments(s9, s10);
    legal.statusByKey.forEach((v, k) => ctrlStatus.set(k, v));

    const byRisk = new Map();
    [...riskCtrls.filter(c => !_isFS(c) && c.control_source !== 'Harmonised_Standard'),
     ...legal.rows].forEach(c => {
      const key = c.risk_id || 'unknown';
      if (!byRisk.has(key)) byRisk.set(key, []);
      byRisk.get(key).push(c);
    });

    const regularAdds = compAdds.filter(c => !_isFS(c));

    const s7date = s10?.assessment_date ? ` &nbsp;|&nbsp; Step 7 recorded: ${s10.assessment_date}` : ' &nbsp;|&nbsp; <em>Step 7 — Residual Risk not yet completed</em>';
    let html = `<p class="section-meta">Step 6 date: ${s9.assessment_date || '—'}${s7date}</p>`;

    // ---- Requirements by risk ---------------------------------------
    const _reqId = c => c.fk_Harmonised_Standard_IDs ? WizUtils.fmtStdRef(c.fk_Harmonised_Standard_IDs) : c.control_id;
    html += `<h3 class="sub-heading">Requirements by risk</h3>`;
    if (byRisk.size === 0) {
      html += _notComplete('No requirements recorded.');
    } else {
      byRisk.forEach((ctrls, riskId) => {
        const selected   = ctrls.filter(c => c.selected);
        const deselected = ctrls.filter(c => !c.selected);
        const riskName   = riskNameById.get(riskId);
        const riskLabel  = riskName ? `${_esc(riskId)} — ${_esc(riskName)}` : _esc(riskId);
        html += `<div class="ctrl-group">
          <div class="ctrl-group-hdr">${riskLabel}</div>
          <table class="data-table data-table--sched">
            <thead><tr><th>Requirement</th><th>Name</th><th>Standard</th><th>Evidence Status</th></tr></thead>
            <tbody>
            ${selected.map(c => `<tr>
              <td class="mono">${_esc(_reqId(c))}</td>
              <td>${_esc(c.control_name || '—')}</td>
              <td>${_hsCell(c)}</td>
              <td>${_ctrlStatusPill(ctrlStatus.get(c.control_id))}</td>
            </tr>`).join('')}
            ${deselected.map(c => `<tr class="ctrl-row--dim">
              <td class="mono">${_esc(_reqId(c))}</td>
              <td>${_esc(c.control_name || '—')}</td>
              <td>${_hsCell(c)}</td>
              <td><span class="status-pill status-pill--excl">✗ Not selected</span></td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      });
    }

    // ---- Compliance Team Additions ----------------------------------
    if (regularAdds.length > 0) {
      html += `<h3 class="sub-heading">Compliance Team Additions</h3>
      <table class="data-table data-table--sched">
        <thead><tr><th>Control ID</th><th>Name</th><th>Standards</th><th>Operational Status</th></tr></thead>
        <tbody>
        ${regularAdds.map(c => `<tr>
          <td class="mono">${_esc(c.control_id)}</td>
          <td>${_esc(c.control_name || '—')}</td>
          <td>${_hsCell(c)}</td>
          <td>${_ctrlStatusPill(ctrlStatus.get(c.control_id))}</td>
        </tr>`).join('')}
        </tbody>
      </table>`;
    }

    // ---- DPIA Controls ----------------------------------------------
    if (dpiaAdds.length > 0) {
      html += `<h3 class="sub-heading">DPIA Controls</h3>
      <p class="section-meta">Technical security measures committed in the DPIA (Step 4) and carried forward into the control register.</p>
      <table class="data-table">
        <thead><tr><th>Name</th><th>Source</th><th>Operational Status</th></tr></thead>
        <tbody>
        ${dpiaAdds.map(c => `<tr>
          <td>${_esc(c.control_name)}</td>
          <td><span class="ctrl-src src-dpia">DPIA</span></td>
          <td>${_ctrlStatusPill(ctrlStatus.get('DPIA__' + c.control_name))}</td>
        </tr>`).join('')}
        </tbody>
      </table>`;
    }

    return html;
  }

  // ---- Section 4: Compliance Traceability --------------------
  // Coverage is driven by the HS model: an HS requirement is covered when it is
  // selected/activated as a treatment for a legal risk (step-6/7), self-certified
  // by a Framework_Statement control, or picked up by a compliance addition.
  function _complianceTraceabilitySection(s3, s9, s10) {
    if (!s3 || !s9) return _notComplete('Steps 3 and 6 must be completed before compliance traceability can be generated.');

    const applicableNums = new Set(
      (s3.axis_b?.applicable_articles || []).map(a => a.article_number)
    );
    if (applicableNums.size === 0) return '<p class="empty-note">No articles applicable — classification returned no EU AI Act obligations.</p>';

    const hsNA = s9.hs_not_applicable || {};

    // Compliance additions that satisfy a given HS ref
    const compAddRefs = new Set();
    (s9.compliance_additions || []).forEach(c => {
      (c.fk_Harmonised_Standard_IDs || '').split(',').map(s => s.trim()).filter(Boolean).forEach(r => compAddRefs.add(r));
    });

    // Build article number → ART-xxx lookup
    const artByNum = new Map();
    WizUtils.ARTICLES.forEach(a => {
      const m = a.article_name.match(/^(Article \d+[a-zA-Z]*)/);
      if (m) artByNum.set(m[1], a);
    });

    // Framework_Statement controls per HS ref → self-certification coverage.
    const fsByRef = new Map();
    (_tbl.riskControls || []).forEach(rc => {
      if (rc.control_source !== 'Framework_Statement' || !rc.fk_Harmonised_Standard_IDs) return;
      rc.fk_Harmonised_Standard_IDs.split(',').map(s => s.trim()).filter(Boolean).forEach(ref => {
        if (!fsByRef.has(ref)) fsByRef.set(ref, []);
        fsByRef.get(ref).push(rc);
      });
    });

    let html = '';
    let coveredCount = 0;   // activated (selected) or evidenced by type
    let byTypeCount = 0;     // workflow/document evidence
    let naCount2 = 0;        // resolved as not applicable (structural or justified exclusion)
    let openCount = 0;       // applies but not addressed and no exclusion recorded
    let unjustifiedCount = 0;// excluded without a recorded reason
    // Per-requirement exclusion reasons captured in Step 5 (ref → reason).
    const reqExcl = _record?.['step-5']?.legal_assessment?.requirement_exclusions || {};

    applicableNums.forEach(artNum => {
      const artDef = artByNum.get(artNum);
      const artId  = artDef?.pk_AI_Article_ID;
      const hsReqs = (_tbl.hs || []).filter(h => h.fk_AI_Article_ID === artId);

      html += `<div class="trace-article">
        <div class="trace-art-hdr">
          <span class="trace-art-num">${_esc(artNum)}</span>
          <span class="trace-art-name">${_esc(artDef?.article_name || artNum)}</span>
        </div>`;

      if (hsReqs.length === 0) {
        html += '<p class="trace-no-hs">No harmonised standard requirements mapped to this article.</p>';
      } else {
        html += `<table class="data-table data-table--trace">
          <thead><tr><th style="width:35%">HS Standard</th><th>Treatment (Risk &middot; Activation)</th><th style="width:16%">Status</th></tr></thead>
          <tbody>`;
        hsReqs.forEach(h => {
          const ref       = h.standard_ref;
          const ctype     = h.coverage_type || 'Test';
          const hsRisks   = _hsRisksForRef(s9, s10, ref);   // legal selection + activation
          const fsCtrls   = (fsByRef.get(ref) || [])
            .filter((c, i, a) => a.findIndex(x => x.pk_Risk_Control_ID === c.pk_Risk_Control_ID) === i);
          const hasCompAdd = compAddRefs.has(ref);
          const selfCert   = fsCtrls.length > 0 || hasCompAdd;
          const activated  = hsRisks.length > 0 || selfCert;
          // Not Applicable: a per-assessment N/A decision recorded against the ref.
          const isNA       = !activated && (!!hsNA[ref] || ctype === 'Not_Applicable');
          // Excluded in Step 5: a recorded exclusion entry, justified when it has a
          // reason. An explicit exclusion is a deliberate human decision, so it is
          // honoured ahead of the Workflow/Document "covered by its own mechanism"
          // default below — otherwise the assessor's N/A call would be silently lost.
          const hasExcl    = !activated && !isNA && Object.prototype.hasOwnProperty.call(reqExcl, ref);
          const exclReason = hasExcl ? String(reqExcl[ref] || '').trim() : '';
          const justifiedNA = hasExcl && !!exclReason;         // excluded with a reason → resolved
          const unjustified = hasExcl && !exclReason;          // excluded, no reason → the real flag
          const open        = !activated && !isNA && !hasExcl; // applies, not addressed
          const covered     = activated;
          // Workflow/Document requirements are met by claiming them like any other
          // requirement (selected in Step 5, evidenced in Step 7). coverage_type no
          // longer grants coverage on its own — it only changes how a *claimed*
          // requirement reads: a distinct badge naming its evidence route.
          const evByType    = activated && (ctype === 'Workflow' || ctype === 'Document');

          if (activated)                coveredCount++;
          else if (isNA || justifiedNA) naCount2++;
          else if (unjustified)         unjustifiedCount++;
          else if (open)                openCount++;
          if (evByType)                 byTypeCount++;

          let badgeKey, badgeTxt;
          if (activated) {
            if (ctype === 'Workflow')      { badgeKey = 'wf';  badgeTxt = '⚙ Workflow'; }
            else if (ctype === 'Document') { badgeKey = 'doc'; badgeTxt = '▤ Document'; }
            else if (hsRisks.length > 0)   { badgeKey = 'ok';  badgeTxt = '✓ Activated'; }
            else                           { badgeKey = 'fs';  badgeTxt = '✓ Self-certified'; }
          }
          else if (isNA)        { badgeKey = 'na';  badgeTxt = '⊘ N/A'; }
          else if (justifiedNA) { badgeKey = 'na';  badgeTxt = '⊘ Not applicable'; }
          else if (unjustified) { badgeKey = 'gap'; badgeTxt = '⚠ Unjustified exclusion'; }
          else                  { badgeKey = 'open'; badgeTxt = '● Open'; }
          const naReason = isNA ? (hsNA[ref] ? hsNA[ref].reason : 'Not applicable to this system type')
                         : justifiedNA ? exclReason
                         : unjustified ? 'Excluded in Step 5 without a recorded reason — add one before sign-off.'
                         : '';
          const rowCls   = (covered || justifiedNA) ? '' : (isNA ? 'trace-row--na' : 'trace-row--gap');

          // Treatment cell: the legal risk(s) activating this HS requirement,
          // else the self-certifying control / compliance addition, else the
          // evidence route implied by the requirement's coverage type.
          let ctrlCell = '';
          if (hsRisks.length > 0) {
            ctrlCell += hsRisks.map(r =>
              `<span class="trace-ctrl-chip"><span class="trace-risk-tag">${_esc(r.riskId)}</span> ${_hsStatusShort(r.status)}</span>`
            ).join('');
          } else if (fsCtrls.length > 0) {
            ctrlCell += fsCtrls.map(c =>
              `<span class="trace-ctrl-chip trace-ctrl-chip--fs"><span class="trace-risk-tag">${_esc(c.fk_Risk_ID)}</span> ${_esc(c.pk_Risk_Control_ID)}</span>`
            ).join('');
          } else if (hasCompAdd) {
            ctrlCell += `<span class="trace-ctrl-chip">Compliance addition</span>`;
          }

          html += `<tr class="${rowCls}">
            <td><span class="mono small">${_esc(WizUtils.fmtStdRef(h.standard_ref))}</span> ${_esc(h.standard_name || '')}${h.standard_text ? `<div class="trace-hs-desc">${_esc(h.standard_text)}</div>` : ''}</td>
            <td><div class="trace-ctrl-list">${ctrlCell || '<span class="trace-none">—</span>'}</div></td>
            <td><span class="trace-cov-badge trace-cov-badge--${badgeKey}">${badgeTxt}</span>${naReason ? `<div class="trace-na-reason">${_esc(naReason)}</div>` : ''}</td>
          </tr>`;
        });
        html += `</tbody></table>`;
      }
      html += `</div>`;
    });

    const blockers     = openCount + unjustifiedCount;
    const summaryClass = blockers === 0 ? 'trace-summary--ok' : 'trace-summary--warn';
    const byTypeNote = byTypeCount > 0 ? ` (${byTypeCount} evidenced by workflow or document)` : '';
    const summaryText  = blockers === 0
      ? `✓ ${coveredCount} requirement${coveredCount !== 1 ? 's' : ''} met${byTypeNote}${naCount2 > 0 ? `, ${naCount2} justified as not applicable` : ''}. No open items.`
      : `⚠ ${blockers} item${blockers !== 1 ? 's' : ''} to resolve before conformity sign-off — ${openCount} open, ${unjustifiedCount} excluded without a reason.${naCount2 > 0 ? ` (${naCount2} justified as not applicable.)` : ''}`;

    const legend = `<details class="trace-legend">
  <summary>What do these statuses mean?</summary>
  <ul class="trace-legend-list">
    <li><span class="trace-cov-badge trace-cov-badge--ok">✓ Activated</span> A risk selected this requirement to treat it; its implementation is evidenced in Step 7.</li>
    <li><span class="trace-cov-badge trace-cov-badge--na">⊘ Not applicable</span> Deliberately excluded with a recorded reason — legitimately out of scope, so it does not affect presumption of conformity.</li>
    <li><span class="trace-cov-badge trace-cov-badge--wf">⚙ Workflow</span> / <span class="trace-cov-badge trace-cov-badge--doc">▤ Document</span> Evidenced by the governance workflow or an external document.</li>
    <li><span class="trace-cov-badge trace-cov-badge--open">● Open</span> Applies to this system but not yet addressed — treat it, or mark it Not applicable with a reason.</li>
    <li><span class="trace-cov-badge trace-cov-badge--gap">⚠ Unjustified exclusion</span> Left out with no reason recorded — the only item that must be fixed before sign-off.</li>
  </ul>
  <p class="trace-legend-note">The legal requirement is the EU AI Act article; each harmonised-standard requirement applies conditionally. Address every requirement whose "applies if" condition is true — evidence it, or record why it is Not applicable. You do not have to meet every clause unconditionally, and satisfying one requirement in a subcategory does not excuse another that applies.</p>
</details>`;

    return legend + `<div class="trace-summary ${summaryClass}">${summaryText}</div>` + html;
  }

  // ---- Section 5: Verification Evidence ----------------------
  function _verificationSection(s10) {
    if (!s10) return _notComplete('Step 7 — Control Verification Testing has not yet been completed.');

    const plans    = s10.plans || [];
    const uncov    = s10.uncovered_controls || [];
    const total    = s10.total_tests ?? 0;
    const done     = s10.evidence_provided_tests ?? s10.completed_tests ?? 0;
    const na       = s10.waived_tests ?? s10.not_applicable_tests ?? 0;
    const pending  = s10.pending_tests ?? 0;

    let html = `<p class="section-meta">
      Assessment date: ${s10.assessment_date || '—'} &nbsp;|&nbsp;
      ${done} evidence provided · ${na} waived · ${pending} pending (${total} total)
    </p>`;

    const pct = total > 0 ? Math.round((done + na) / total * 100) : 0;
    html += `<div class="test-progress-bar">
      <div class="test-progress-fill" style="width:${pct}%"></div>
    </div>
    <p class="test-progress-lbl">${pct}% of tests resolved</p>`;

    const _isFSControl = c => (c.control_source || '').includes('Framework') || (c._isFramework === true);
    const filteredPlans = plans
      .map(p => ({ ...p, test_controls: (p.test_controls || []).filter(tc => !_isFSControl(tc)) }))
      .filter(p => p.test_controls.length > 0);

    if (filteredPlans.length === 0) {
      html += _notComplete('No test plans generated. Ensure Step 6 control selection is complete.');
    } else {
      filteredPlans.forEach(p => {
        html += `<div class="test-plan">
          <div class="test-plan-hdr">
            <span class="test-plan-ref mono">${_esc(p.plan_ref)}</span>
            <span class="test-plan-name">${_esc(p.plan_name)}</span>
          </div>
          <p class="test-plan-risk">Risk: ${_esc(p.risk_name)}</p>
          <table class="data-table data-table--sched">
            <thead><tr><th>Test Control</th><th>Name</th><th>Standards</th><th>Status</th></tr></thead>
            <tbody>
            ${p.test_controls.map(tc => `<tr>
              <td class="mono">${_esc(tc.control_ref || tc.test_control_id)}</td>
              <td>${_esc(tc.control_name)}</td>
              <td class="mono small">${tc.fk_Harmonised_Standard_IDs ? _esc(WizUtils.fmtStdRef(tc.fk_Harmonised_Standard_IDs)) : '—'}</td>
              <td><span class="status-pill status-pill--${_testStatusKey(tc.status)}">${_testStatusLabel(tc.status)}</span></td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      });
    }

    const filteredUncov = uncov.filter(c => !_isFSControl(c));
    if (filteredUncov.length > 0) {
      html += `<h3 class="sub-heading">Controls Without Automated Test Coverage (${filteredUncov.length})</h3>
        <p class="section-meta">Manual evidence review required for the following controls.</p>
        <table class="data-table">
          <thead><tr><th>Control ID</th><th>Name</th><th>Source</th></tr></thead>
          <tbody>
          ${filteredUncov.map(c => `<tr>
            <td class="mono">${_esc(c.control_id)}</td>
            <td>${_esc(c.control_name)}</td>
            <td>${_esc(c.control_source || '—')}</td>
          </tr>`).join('')}
          </tbody>
        </table>`;
    }

    return html;
  }

  // ---- Section 6: Conformity Declaration ---------------------
  function _conformityConclusionSection(s3, s9, s10, today, useCase, assessedBy) {
    const artCount   = s3?.axis_b?.applicable_articles?.length ?? 0;
    // Legal risks are treated by implementing harmonised-standard requirements.
    let reqSelected = 0;
    _reqStatsByRisk(s9, s10).forEach(s => { reqSelected += s.total; });
    if (s9?.total_requirements != null) reqSelected = s9.total_requirements;
    const reqEvid   = s10?.requirements_evidenced ?? '—';
    const reqWaived = s10?.requirements_waived ?? '—';
    const reqPend   = s10?.requirements_pending ?? '—';

    const allDone = !!s3 && !!s9 && !!s10;
    const noPending = typeof reqPend === 'number' && reqPend === 0;

    return `
<h3 class="sub-heading">Article 43 HS Requirements — Completion Checklist</h3>
<table class="data-table">
  <thead><tr><th>HS Ref</th><th>Requirement</th><th>Evidence</th><th>Status</th></tr></thead>
  <tbody>
    <tr>
      <td class="mono">[18286.16]</td>
      <td>Articles 9–17 Completion Verification</td>
      <td>Sections 1–4 of Part A evidence completion of all applicable article requirements</td>
      <td><span class="status-pill status-pill--${allDone ? 'accept' : 'pend'}">${allDone ? '✓ Evidenced' : '○ Pending'}</span></td>
    </tr>
    <tr>
      <td class="mono">[18286.17]</td>
      <td>Competent Reviewer Sign-off</td>
      <td>AI Change Board decision — recorded in Part B</td>
      <td><span class="status-pill status-pill--pend">○ Recorded in Part B</span></td>
    </tr>
    <tr>
      <td class="mono">[18286.18]</td>
      <td>No Critical Gaps Declaration</td>
      <td>Compliance &amp; Requirement Traceability — every applicable HS requirement is Activated/evidenced or justified as Not applicable; no Open or Unjustified-exclusion items remain</td>
      <td><span class="status-pill status-pill--${allDone ? 'accept' : 'pend'}">${allDone ? '✓ See Section 3' : '○ Pending'}</span></td>
    </tr>
    <tr>
      <td class="mono">[18286.19]</td>
      <td>Self-Assessment Conclusion Statement</td>
      <td>This report constitutes the self-assessment conclusion</td>
      <td><span class="status-pill status-pill--accept">✓ This document</span></td>
    </tr>
    <tr>
      <td class="mono">[18286.20]</td>
      <td>Conformity Review Date &amp; Version</td>
      <td>Date: ${today} &nbsp;|&nbsp; Version: 1.0</td>
      <td><span class="status-pill status-pill--accept">✓ Recorded</span></td>
    </tr>
  </tbody>
</table>

<h3 class="sub-heading">Assessment Summary</h3>
<table class="data-table">
  <tr><td class="dt-label">Use Case / System ID</td><td>${_esc(useCase)}</td></tr>
  <tr><td class="dt-label">Applicable EU AI Act Articles</td><td>${artCount}</td></tr>
  <tr><td class="dt-label">Harmonised-Standard Requirements Selected</td><td>${reqSelected}</td></tr>
  <tr><td class="dt-label">Requirements — Evidence Provided</td><td>${reqEvid}</td></tr>
  <tr><td class="dt-label">Requirements — Waived</td><td>${reqWaived}</td></tr>
  <tr><td class="dt-label">Requirements Pending</td><td>${reqPend}</td></tr>
  <tr><td class="dt-label">Report Generated</td><td>${today}</td></tr>
</table>

${!noPending && s10 ? `<div class="warn-banner">⚠ ${reqPend} requirement${reqPend !== 1 ? 's' : ''} remain pending. Every selected requirement must be evidenced or waived before this report can be used as the conformity assessment submission.</div>` : ''}

<h3 class="sub-heading">Basis of Conformity</h3>
<div class="declaration-block">
  <p>This assessment establishes conformity through two complementary routes:</p>
  <ul class="basis-list">
    <li><strong>EU AI Act requirements</strong> are evidenced against <strong>harmonised standard (HS)
    requirements</strong>. For each applicable Article, the corresponding HS requirements are activated as the
    risk-treatment measures and traced in Section 3 (Compliance &amp; Control Traceability). This report records each
    requirement, its activation status and its implementing evidence; the technical implementation of each HS
    requirement is carried out by the development team.</li>
    <li>each requirement's <strong>evidence of implementation</strong> is recorded with its status in the
    Requirement Evidence Register (Section 3), and any residual risk is assessed per risk in Part B.</li>
  </ul>
  <p><strong>Presumption of conformity.</strong> Under <strong>Article 40</strong> of Regulation (EU) 2024/1689,
  an AI system that conforms to harmonised standards — or parts thereof — whose references are published in the
  <em>Official Journal of the European Union</em> is presumed to conform to the corresponding requirements of the
  Regulation. The harmonised standards referenced in this assessment are currently under development. Once their
  references are cited in the Official Journal, the HS-requirement activation records in this report map directly
  to those citations, allowing this AI system to claim presumption of conformity for the covered requirements
  without re-assessment.</p>
</div>

<h3 class="sub-heading">Assessor's Conclusion</h3>
<div class="declaration-block">
  <p>Having assessed the AI system identified above against the applicable requirements of Regulation (EU)
  2024/1689 (EU AI Act) — covering system classification, risk identification, control selection,
  harmonised-standard traceability and verification testing as documented in Part A — the assessor concludes
  that, to the best of their knowledge, the system meets the applicable requirements identified in this
  assessment, subject to the outstanding items noted in Part B.</p>
  <p>This conclusion is submitted to the AI Change Board for decision (Part B). The formal EU Declaration of
  Conformity (Article 47) is issued following Board approval; it is not made by this document.</p>
</div>

<table class="sig-table">
  <tr>
    <td class="sig-cell"><div class="sig-filled">${_esc(assessedBy)}</div><div class="sig-label">Assessed by</div></td>
    <td class="sig-cell"><div class="sig-filled">${today}</div><div class="sig-label">Date</div></td>
    <td class="sig-cell"><div class="sig-line"></div><div class="sig-label">Role — Assessor / Compliance</div></td>
  </tr>
</table>`;
  }

  // Digital AI Change Board approval if recorded; otherwise blank signature lines.
  function _signatureBlock() {
    const a = _record?.['step-8'];
    if (a?.attested) {
      const when = (a.attested_at || new Date().toISOString()).slice(0, 10);
      return `
<table class="sig-table sig-table--approved">
  <tr>
    <td class="sig-cell">
      <div class="sig-approved">✓ Approved</div>
      <div class="sig-label">AI Change Board Decision</div>
    </td>
    <td class="sig-cell">
      <div class="sig-filled">${_esc(a.attested_by || '—')}</div>
      <div class="sig-label">Approver Name</div>
    </td>
    <td class="sig-cell">
      <div class="sig-filled">${_esc(when)}</div>
      <div class="sig-label">Date</div>
    </td>
  </tr>
</table>
<p class="approval-note">Digitally approved via the AI governance workflow — no physical signature required.</p>`;
    }
    return `
<table class="sig-table">
  <tr>
    <td class="sig-cell">
      <div class="sig-line"></div>
      <div class="sig-label">Signature</div>
    </td>
    <td class="sig-cell">
      <div class="sig-line"></div>
      <div class="sig-label">Name</div>
    </td>
    <td class="sig-cell">
      <div class="sig-line"></div>
      <div class="sig-label">Date</div>
    </td>
  </tr>
  <tr>
    <td class="sig-cell" colspan="3">
      <div class="sig-line"></div>
      <div class="sig-label">Role — AI Change Board</div>
    </td>
  </tr>
</table>`;
  }

  // ---- Section 7: Internal Standard Compliance ---------------
  function _srControlsSection() {
    const srControls = _tbl.srControls || [];
    const workflow   = _tbl.workflow   || { steps: [] };

    if (!srControls.length) return _notComplete('tbl_AI_SR_Controls.json could not be loaded.');

    // Step metadata lookup from workflow.json
    const stepById = new Map((workflow.steps || []).map(s => [s.id, s]));

    // Steps that can be completed digitally — full wizards (3–7) plus the
    // lighter checkbox/attestation steps (1, 2, 8, 10–12). Completing any of
    // these in-app records evidence without a file upload.
    const TRACKED_STEPS = new Set([
      'step-1', 'step-2', 'step-3', 'step-4', 'step-5',
      'step-6', 'step-7', 'step-8', 'step-10', 'step-11', 'step-12'
    ]);
    const stepComplete = id => {
      if (id === 'step-5') return !!_record?.['step-5']?.legal_assessment?.completed;
      return !!_record?.[id];
    };

    // Overall status counts for the summary banner
    let evidenced = 0, partial = 0, pending = 0;

    const rows = srControls.map(ctrl => {
      const steps = (ctrl.workflow_steps || []).map(id => stepById.get(id)).filter(Boolean);
      const trackedSteps = steps.filter(s => TRACKED_STEPS.has(s.id));
      const completedTracked = trackedSteps.filter(s => stepComplete(s.id));

      let status, statusClass;
      if (trackedSteps.length === 0) {
        status = '— Manual evidence'; statusClass = 'manual';
      } else if (completedTracked.length === trackedSteps.length) {
        status = '✓ Evidenced'; statusClass = 'ok'; evidenced++;
      } else if (completedTracked.length > 0) {
        status = '◑ Partial'; statusClass = 'partial'; partial++;
      } else {
        status = '○ Pending'; statusClass = 'pend'; pending++;
      }

      const stepRows = steps.map(s => {
        const isTracked  = TRACKED_STEPS.has(s.id);
        const isComplete = isTracked ? stepComplete(s.id) : null;
        const icon  = isTracked ? (isComplete ? '✓' : '○') : '—';
        const cls   = isTracked ? (isComplete ? 'sr-step--done' : 'sr-step--pend') : 'sr-step--manual';
        const note  = isTracked ? (isComplete ? 'digital record saved' : 'not yet completed') : 'physical artefact';
        return `<div class="sr-step ${cls}">
          <span class="sr-step-icon">${icon}</span>
          <span class="sr-step-num">Step ${s.number}</span>
          <span class="sr-step-name">${_esc(s.title)}</span>
          <span class="sr-step-note">${note}</span>
        </div>`;
      }).join('');

      return `
<div class="sr-ctrl-block">
  <div class="sr-ctrl-hdr">
    <span class="sr-ctrl-ref">${_esc(ctrl.groupstandard_ref)}</span>
    <span class="sr-ctrl-name">${_esc(ctrl.control_name)}</span>
    <span class="sr-status sr-status--${statusClass}">${status}</span>
  </div>
  <div class="sr-ctrl-body">
    <table class="data-table sr-meta-table">
      <tr>
        <td class="dt-label">Control Objective</td>
        <td>${_esc(ctrl.control_objective)}</td>
      </tr>
      <tr>
        <td class="dt-label">Control Evidence</td>
        <td>${_esc(ctrl.control_evidence)}</td>
      </tr>
      <tr>
        <td class="dt-label sr-csa-label">CSA Checklist</td>
        <td class="sr-csa-text">${_esc(ctrl.csa_checklist_item)}</td>
      </tr>
    </table>
    <div class="sr-steps-label">Workflow Evidence Steps</div>
    <div class="sr-steps-list">${stepRows || '<span class="sr-no-steps">No workflow steps tagged to this control.</span>'}</div>
  </div>
</div>`;
    });

    const totalTracked = srControls.filter(c =>
      (c.workflow_steps || []).some(id => TRACKED_STEPS.has(id))
    ).length;

    const summaryClass = partial + pending === 0 ? 'trace-summary--ok' : 'trace-summary--warn';
    const summaryText = partial + pending === 0
      ? `✓ All ${evidenced} trackable controls are fully evidenced by digital workflow records.`
      : `${evidenced} of ${totalTracked} trackable controls evidenced · ${partial} partial · ${pending} pending. Controls without tracked steps require manual artefact submission.`;

    return `
<p class="section-meta">
  Risk Title: Flawed Deployment and Governance of Artificial Intelligence Tools &nbsp;|&nbsp;
  ${srControls.length} controls &nbsp;|&nbsp; evidenced from tbl_AI_SR_Controls.json workflow_steps
</p>
<div class="trace-summary ${summaryClass}">${summaryText}</div>
${rows.join('')}`;
  }

  // ---- Helpers ------------------------------------------------
  // ---- Part B: Utmost AI Tool & Use Case Approval Form --------
  // Renders the company AICB approval form, populated from the record where the
  // workflow already holds the answer, and with blank printable fields for the
  // identity / routing / sign-off items a person fills in before printing.
  function _approvalFormSection(s3, s8, s9, s10, meta, today) {
    const s2 = _record?.['step-2'] || {};
    const s4 = _record?.['step-4'] || null;
    const s1 = _record?.['step-1'] || null;
    const s11 = _record?.['step-8'] || null; // AI Change Board decision attestation
    const b  = s3?.axis_b || {};
    const useCaseName = meta.use_case_name || '—';
    const useCaseId   = meta.use_case_id || s3?.use_case_id || '';

    // Blank fields are editable in the on-screen preview so the assessor can type
    // the identity / routing / sign-off answers directly before printing.
    const blank  = (h) => `<div class="af-blank" contenteditable="true" style="min-height:${h || 22}px"></div>`;
    const line   = () => `<span class="af-line" contenteditable="true"></span>`;
    const box    = (html) => html && String(html).trim() ? `<div class="af-val">${html}</div>` : blank(40);
    const row    = (label, valueHtml) => `<tr><td class="af-label">${label}</td><td>${valueHtml}</td></tr>`;
    const secBanner = (t) => `<div class="af-sec">${t}</div>`;
    const subBanner = (t) => `<div class="af-sub">${t}</div>`;
    const ul = (items) => items && items.length ? `<ul class="af-ul">${items.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>` : '';

    const OUT = { HIGH_RISK: 'High Risk', LIMITED_RISK: 'Limited Risk', MINIMAL_RISK: 'Minimal Risk', PROHIBITED: 'Potentially Prohibited', OUT_OF_SCOPE: 'Out of scope', NOT_HIGH_RISK: 'Not high-risk' };
    const outcome = OUT[String(b.ai_act_outcome || '').toUpperCase()] || (b.ai_act_outcome || '—');
    const role = b.organisation_role === 'provider' ? 'Provider / Developer'
      : (b.organisation_role === 'deployer' && b.substantial_modification_applies) ? 'Hybrid (Provider &amp; Deployer)'
      : b.organisation_role === 'deployer' ? 'Deployer' : '—';

    const di = s4?.data_types_identified || {};
    const personal = (di.standard_personal_data || []).filter(x => !/^none/i.test(x));
    const special  = (di.special_category_data || []).filter(x => !/^none/i.test(x));
    const subjects = (di.data_subjects || []).filter(x => !/^none/i.test(x));
    const measures = di.security_measures || [];
    const privacyRisks = di.privacy_risks || [];
    const hasPersonal = personal.length || special.length || subjects.length;

    // Selected risks bucketed into the form's risk categories.
    const selRisks = (s8?.legal_assessment?.risks || []).filter(r => r.selected);
    const ETH = new Set(['RISK-001', 'RISK-002', 'RISK-007']);
    const bucketOf = id => ETH.has(String(id || '').toUpperCase()) ? 'ethical' : 'operational';
    const names = bucket => selRisks.filter(r => bucketOf(r.risk_id) === bucket).map(r => r.risk_name);
    const RISK_ATTACH = 'See attachment &ldquo;2 Risk Identification&rdquo;.';
    const riskCell = items => items.length
      ? `${ul(items)}<p class="af-note">${RISK_ATTACH}</p>`
      : box(RISK_ATTACH);

    // Data used
    const dataUsed = [];
    if (personal.length) dataUsed.push('Personal data: ' + personal.join(', '));
    if (special.length)  dataUsed.push('Special-category data: ' + special.join(', '));
    if (subjects.length) dataUsed.push('Data subjects: ' + subjects.join(', '));
    if (!hasPersonal && s4) dataUsed.push('No personal data processed (per DPIA).');

    // AI interaction & content (derived signals)
    const interact = [];
    if (subjects.length) interact.push('Processes data about: ' + subjects.join(', '));
    if (b.transparency_obligations_apply) interact.push('Generates or manipulates content subject to transparency obligations (Art. 50).');
    if (di.automated_decision_making && !/^no/i.test(di.automated_decision_making)) interact.push('Automated decision-making: ' + di.automated_decision_making);

    // DPIA evidence
    let dpiaEvidence = '';
    if (s4 && s4.completion_date) {
      dpiaEvidence = `DPIA completed ${_esc(s4.completion_date)}. Inherent risk: ${_esc(s4.inherent_risk_rating || '—')}; residual: ${_esc(s4.residual_risk_rating || '—')}. DPO consulted: ${_esc(s4.dpo_consulted || '—')}.${useCaseId ? ` Reference: ${_esc(useCaseId)}.` : ''}`;
    }

    // Training
    const training = (s1 && s1.attested)
      ? `Confirmed — AI literacy / training prerequisite completed${s1.attested_by ? ' (' + _esc(s1.attested_by) + ')' : ''}. Describe training provided: ${blank(18)}`
      : blank(40);

    // Outstanding items → Section 3.1 "Additional Information Required"
    let outstanding = [];
    if (s9 && s10 && s10.hs_activation) {
      const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));
      _reqStatsByRisk(s9, s10).forEach((st, riskId) => st.refs.forEach(r => {
        if (r.status !== 'evidence_provided' && r.status !== 'waived') outstanding.push(`${WizUtils.fmtStdRef(r.ref)} — ${r.name} (${riskNameById.get(riskId) || riskId})`);
      }));
    }
    const outstandingHtml = outstanding.length
      ? `${ul(outstanding)}<p class="af-note">These must close before, or as conditions of, approval.</p>`
      : (s9 && s10 ? '<p class="af-note">None — every selected requirement is evidenced or waived.</p>' : blank(30));

    // Board decision prefill from the digital attestation, if recorded.
    const decided = s11 && s11.attested;
    const approverName = decided ? _esc(s11.attested_by || '') : '';
    const approvalDate = decided ? _esc((s11.attested_at || '').slice(0, 10)) : '';

    return `<style>
/* Neutral translucent palette + inherited text so the form reads correctly in
   both the dark in-app preview and the light printed page. */
.af-form{border:1px solid rgba(150,140,110,0.5);margin-top:4px}
.af-sec{background:#6b5d3e;color:#fff;font-weight:700;font-size:11pt;padding:7px 10px;margin:0}
.af-sec .af-sub2{display:block;font-weight:400;font-size:8.5pt;margin-top:2px;color:#efe9d8}
.af-sub{background:#5a5648;color:#fff;font-weight:700;font-size:9pt;padding:4px 10px}
.af-table{width:100%;border-collapse:collapse}
.af-table td{border:1px solid rgba(150,140,110,0.45);padding:6px 9px;vertical-align:top;font-size:9pt;color:inherit}
.af-label{font-weight:700;width:30%;background:rgba(150,140,110,0.14)}
.af-val{font-size:9pt;color:inherit}
.af-blank{border:1px dashed rgba(150,140,110,0.65);border-radius:3px;background:rgba(150,140,110,0.06);min-height:22px;padding:2px 5px}
.af-line{display:inline-block;min-width:160px;border-bottom:1px solid rgba(150,140,110,0.7);min-height:14px}
.af-blank:focus,.af-line:focus{outline:2px solid rgba(212,184,96,0.7);outline-offset:1px;background:rgba(212,184,96,0.08)}
@media print{.af-blank,.af-line{outline:none}}
.af-ul{margin:0 0 0 16px;padding:0}.af-ul li{margin:1px 0}
.af-note{margin:5px 0 0;font-size:8pt;opacity:.72;font-style:italic}
.af-fill{font-weight:700}
.af-grid3 td{width:33%}
</style>
<p class="section-desc" style="margin-bottom:8px">Populated from this assessment where the workflow holds the answer. Fields shown as empty boxes (identity, entity, authorisers and the Board decision) are completed by hand before printing.</p>

<div class="af-form">
  <div class="af-sec">Section 1 — To be completed by the Requester / Business Owner<span class="af-sub2">Form Completed By (name / job title / date):&nbsp; ${line()} &nbsp; ${line()} &nbsp; ${line()}</span></div>

  <div class="af-sub">Section 1.1 — User Details</div>
  <table class="af-table">
    ${row('Department Name', blank(22))}
    ${row('Full Name(s) of user(s)', blank(22))}
    ${row('Full Names &amp; Emails (multiple users)', blank(30))}
  </table>

  <div class="af-sub">Section 1.2 — AI Tool Details</div>
  <table class="af-table">
    ${row('Title', box(_esc(useCaseName)))}
    ${row('Full Description / intended purpose', box(_esc(s2.business_case || '')))}
    ${row('Business Justification', s2.business_justification ? box(_esc(s2.business_justification)) : blank(40))}
    ${row('Entity Scope (Group-wide / LUX / UPE / IOM / UW …)', blank(22))}
    ${row('AI Interaction &amp; Content', interact.length ? box(ul(interact)) : blank(40))}
  </table>

  <div class="af-sub">Section 1.3 — Data Privacy &amp; Security</div>
  <table class="af-table">
    ${row('Data Used', dataUsed.length ? box(ul(dataUsed)) : blank(40))}
    ${row('DPIA Evidence', box((dpiaEvidence || 'DPIA status to be confirmed.') + ' See appendix &ldquo;Data Privacy Impact Assessment (DPIA)&rdquo;.'))}
    ${row('Technology Risk Assessment (TRA) Evidence', box('Residual-risk verification completed in the workflow. See attachment &ldquo;2 Risk Identification&rdquo;.'))}
    ${row('Data Protection Measures', measures.length ? box(ul(measures)) : blank(40))}
  </table>

  <div class="af-sub">Section 1.4 — Additional Information</div>
  <table class="af-table">
    ${row('Documentation', s2.business_case_url ? box('Reference: ' + _esc(s2.business_case_url)) : blank(30))}
  </table>

  <div class="af-sub">Section 1.5 — Management Authorisation &amp; Acceptance</div>
  <table class="af-table">
    ${row('Manager providing initial approval (name)', blank(22))}
  </table>

  <div class="af-sub">Section 1.6 — Declaration</div>
  <table class="af-table">
    ${row('Requester name &amp; date of declaration', `${line()} &nbsp;&nbsp; ${line()}`)}
  </table>

  <div class="af-sub">Training</div>
  <table class="af-table">
    ${row('Training / awareness required before use', box(training))}
  </table>

  <div class="af-sec" style="margin-top:0">Section 2 — To be completed by InfoSec Governance<span class="af-sub2">Form Completed By (name / role / date):&nbsp; ${line()} &nbsp; ${line()} &nbsp; ${line()}</span></div>

  <div class="af-sub">Section 2.1 — Compliance</div>
  <table class="af-table">
    ${row('Compliance with the AI Standard', box('Assessed against the EU AI Act and the ISO/IEC&nbsp;42001-aligned internal standard through this governance workflow (Steps&nbsp;1–7). Full conformity evidence is in Part&nbsp;A.'))}
    ${row('Utmost Role', box(role))}
  </table>

  <div class="af-sub">Section 2.2 — Risk Assessment</div>
  <table class="af-table">
    ${row('EU AI Act Risk Category', box(`${_esc(outcome)}${s3?.rationale ? ' — ' + _esc(s3.rationale) : ''} ${RISK_ATTACH}`))}
    ${row('Operational Risks (Cyber / IT / DevOps)', riskCell(names('operational')))}
    ${row('Data Protection Risks', privacyRisks.length ? box(`${ul(privacyRisks)}<p class="af-note">${RISK_ATTACH}</p>`) : box(RISK_ATTACH))}
    ${row('Ethical Risks (bias, fairness, explainability, reliance)', riskCell(names('ethical')))}
    ${row('Legal Risks', box(`EU AI Act classification: ${_esc(outcome)}; transparency obligations: ${b.transparency_obligations_apply ? 'Yes (Art. 50)' : 'No'}. IP / copyright / contractual risks — review and complete: ${line()} ${RISK_ATTACH}`))}
  </table>

  <div class="af-sec" style="margin-top:0">Section 3 — To be completed by the Change Board (AICB)<span class="af-sub2">Form Completed By (name / role / date):&nbsp; ${line()} &nbsp; ${line()} &nbsp; ${line()}</span></div>

  <div class="af-sub">Section 3.1 — Approval Status</div>
  <table class="af-table">
    ${row('Additional Information Required / Outstanding Items', outstandingHtml)}
    ${row('Decision', `<div class="af-val">☐ Approved &nbsp;&nbsp; ☐ Approved subject to conditions &nbsp;&nbsp; ☐ Not approved &nbsp;&nbsp; ☐ Pending / review in progress</div>`)}
    ${row('Reason (if not approved) / conditions', blank(30))}
    ${row('Approver name', approverName ? box('<span class="af-fill">' + approverName + '</span>') : blank(22))}
    ${row('Decision date', approvalDate ? box('<span class="af-fill">' + approvalDate + '</span>') : blank(22))}
  </table>
</div>`;
  }

  function _section(num, title, desc, content) {
    return `<div class="section ${num === 1 ? '' : 'page-break'}">
      <div class="section-hdr">
        <span class="section-num">${num}</span>
        <span class="section-title">${title}</span>
      </div>
      ${desc ? `<p class="section-desc">${desc}</p>` : ''}
      <div class="section-body">${content}</div>
    </div>`;
  }

  // Part banner introducing a top-level part of the report (A = regulator
  // conformity dossier, B = internal governance & sign-off).
  function _partBanner(letter, title, desc) {
    return `<div class="part-banner page-break">
      <div class="part-tag">Part ${letter}</div>
      <div class="part-title">${title}</div>
      <div class="part-desc">${desc}</div>
    </div>`;
  }

  function _partDivider(text) {
    return `<div class="part-divider">${text}</div>`;
  }

  // AI Change Board decision — the governance sign-off (Part B). This is the act
  // that follows and depends on the assessor's conformity conclusion in Part A.
  function _boardDecisionSection() {
    return `<p>The AI Change Board records here its decision on the conformity assessment set out in Part A. Approval authorises deployment and triggers issuance of the formal EU Declaration of Conformity (Article&nbsp;47) for this system; the Board may also reject the request or approve it subject to the outstanding items listed above.</p>${_signatureBlock()}`;
  }

  function _notComplete(msg) {
    return `<div class="not-complete">⚠ ${_esc(msg)}</div>`;
  }

  function _catKey(cat) {
    const c = (cat || '').toLowerCase();
    if (c.includes('prohibit'))   return 'prohibited';
    if (c.includes('high'))       return 'high';
    if (c.includes('limited'))    return 'limited';
    if (c.includes('minimal'))    return 'minimal';
    return 'unknown';
  }

  function _ctrlStatusPill(status) {
    if (status === 'evidence_provided') return '<span class="status-pill status-pill--accept">✓ Met</span>';
    if (status === 'not_met')           return '<span class="status-pill status-pill--fail">✗ Not met</span>';
    if (status === 'waived')            return '<span class="status-pill status-pill--na">— Waived</span>';
    if (status === 'in_progress')       return '<span class="status-pill status-pill--pend">◑ In progress</span>';
    if (status === 'not_started')       return '<span class="status-pill status-pill--excl">○ Not started</span>';
    return '<span class="status-pill status-pill--excl">— Not recorded</span>';
  }

  function _testStatusKey(status) {
    if (status === 'evidence_provided' || status === 'completed')      return 'accept';
    if (status === 'waived'            || status === 'not_applicable') return 'na';
    if (status === 'not_met')                                          return 'fail';
    if (status === 'in_progress')                                      return 'pend';
    return 'pend';
  }

  function _testStatusLabel(status) {
    if (status === 'evidence_provided') return '✓ Met';
    if (status === 'completed')         return '✓ Completed';
    if (status === 'waived')            return '— Waived';
    if (status === 'not_applicable')    return '— N/A';
    if (status === 'not_met')           return '✗ Not met';
    if (status === 'in_progress')       return '◑ In progress';
    return '○ Not started';
  }

  function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ============================================================
  // ---- Report CSS (embedded in the generated HTML) -----------
  // ============================================================
  function _reportCSS() {
    return `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:10.5pt;color:#111;background:#fff;line-height:1.5}

/* Page layout */
@page{size:A4 portrait;margin:18mm 18mm 18mm 18mm}
@media print{
  .page-break{page-break-before:always;break-before:page}
  body{font-size:9.5pt}
  .no-print{display:none}
}

/* Cover */
.cover{padding:40px 0}
.cover-header{border-bottom:3px solid #0d9488;padding-bottom:18px;margin-bottom:32px}
.cover-org{font-size:11pt;color:#0d9488;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.cover-doc-type{font-size:22pt;font-weight:700;color:#111;letter-spacing:.02em}
.cover-meta-table{width:100%;border-collapse:collapse;margin-bottom:28px}
.cover-meta-table td{padding:5px 8px;font-size:10pt;border-bottom:1px solid #f0f0f0;vertical-align:top}
.cmt-label{color:#555;width:200px;font-weight:500}
.cmt-value{color:#111}

/* Cover stats */
.cover-stats{display:flex;gap:0;margin-bottom:28px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
.cs-box{flex:1;padding:18px 16px;border-right:1px solid #e5e7eb;text-align:center}
.cs-box:last-child{border-right:none}
.cs-num{font-size:24pt;font-weight:700;color:#0d9488;line-height:1}
.cs-lbl{font-size:9pt;color:#555;margin-top:4px;line-height:1.4}
.cs-sub{font-size:8pt;color:#888}

/* Cover status */
.cover-status-block{border:1px solid #e5e7eb;border-radius:6px;padding:14px 18px;margin-bottom:24px}
.csb-title{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:10px}
.csb-row{display:flex;align-items:center;gap:10px;padding:4px 0;font-size:10pt}
.csb-icon{width:18px;text-align:center;font-weight:700}
.csb-icon--done{color:#16a34a}
.csb-icon--pend{color:#9ca3af}
.csb-lbl{flex:1}
.csb-status{font-size:9pt;font-weight:600}
.csb-status--done{color:#16a34a}
.csb-status--pend{color:#9ca3af}
.cover-framework{background:#f8fafc;border-left:3px solid #0d9488;padding:12px 16px;font-size:9.5pt;color:#374151;line-height:1.6}

/* Sections */
.section{margin-bottom:0;padding-top:8px}
.section-hdr{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0d9488;padding-bottom:8px;margin-bottom:20px}
.section-num{width:28px;height:28px;background:#0d9488;color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11pt;font-weight:700;flex-shrink:0}
.section-title{font-size:14pt;font-weight:700;color:#111}
.section-desc{font-size:9pt;color:#555;margin:-12px 0 16px;line-height:1.55;max-width:82%}
.section-body{padding-bottom:20px}

/* Part banners + dependency divider */
.part-banner{padding:22px 0 16px;border-bottom:3px solid #0d9488;margin:0 0 24px}
.part-tag{font-size:10pt;font-weight:700;letter-spacing:.14em;color:#0d9488;text-transform:uppercase}
.part-title{font-size:18pt;font-weight:800;color:#111;margin:4px 0 8px}
.part-desc{font-size:9.5pt;color:#555;line-height:1.6;max-width:78%}
.part-divider{margin:28px 0;padding:14px 18px;background:#f0fdfa;border:1px dashed #0d9488;border-radius:6px;font-size:9.5pt;color:#0f766e;font-weight:600;text-align:center;line-height:1.5}
.sub-heading{font-size:10.5pt;font-weight:700;color:#1e3a5f;margin:18px 0 8px;padding-bottom:3px;border-bottom:1px solid #e5e7eb}
.section-meta{font-size:9pt;color:#666;margin-bottom:10px}
.empty-note{font-size:9.5pt;color:#888;font-style:italic;padding:8px 0}
.not-complete{background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;padding:10px 14px;font-size:9.5pt;color:#9a3412}
.warn-banner{background:#fff7ed;border:1px solid #fbbf24;border-radius:4px;padding:10px 14px;font-size:9.5pt;color:#92400e;margin:12px 0}

/* Tables */
.data-table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:12px}
.data-table th{background:#f8fafc;padding:6px 10px;text-align:left;font-weight:700;color:#374151;border:1px solid #e5e7eb;font-size:9pt}
.data-table td{padding:5px 10px;border:1px solid #e5e7eb;vertical-align:top}
.data-table .row-dim td{color:#9ca3af}
.dt-label{font-weight:600;color:#555;white-space:nowrap;width:220px}
.reason-cell{font-size:9pt;color:#555}
.data-table--risk{table-layout:fixed}
.data-table--risk th:nth-child(1),.data-table--risk td:nth-child(1){width:20%}
.data-table--risk th:nth-child(2),.data-table--risk td:nth-child(2){width:8%;white-space:nowrap}
.data-table--risk th:nth-child(3),.data-table--risk td:nth-child(3){width:9%}
.data-table--risk th:nth-child(4),.data-table--risk td:nth-child(4){width:63%}
.data-table--sched{table-layout:fixed}
.data-table--sched th:nth-child(1),.data-table--sched td:nth-child(1){width:13%}
.data-table--sched th:nth-child(2),.data-table--sched td:nth-child(2){width:47%}
.data-table--sched th:nth-child(3),.data-table--sched td:nth-child(3){width:18%}
.data-table--sched th:nth-child(4),.data-table--sched td:nth-child(4){width:22%}
.applies-if-list{margin:2px 0 0 14px;padding:0;font-size:8.5pt;color:#444;line-height:1.5}
.applies-if-list li{margin-bottom:2px}
.applies-if-filter{display:block;font-size:8pt;font-weight:600;color:#b45309;background:#fef3c7;border-radius:3px;padding:1px 5px;margin-bottom:4px;width:fit-content}

/* Badges */
.cat-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:9pt;font-weight:700}
.cat-badge--prohibited{background:#fee2e2;color:#991b1b}
.cat-badge--high{background:#fef3c7;color:#92400e}
.cat-badge--limited{background:#dbeafe;color:#1e40af}
.cat-badge--minimal{background:#d1fae5;color:#065f46}
.cat-badge--unknown{background:#f3f4f6;color:#374151}

.status-pill{display:inline-block;padding:2px 7px;border-radius:4px;font-size:8.5pt;font-weight:600;white-space:nowrap}
.status-pill--accept{background:#d1fae5;color:#065f46}
.status-pill--excl{background:#f3f4f6;color:#6b7280}
.status-pill--filter{background:#ede9fe;color:#5b21b6}
.status-pill--pend{background:#fef3c7;color:#92400e}
.status-pill--na{background:#f3f4f6;color:#6b7280}
.status-pill--fail{background:#fee2e2;color:#991b1b}

.ans-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:8.5pt;font-weight:700;white-space:nowrap}
.ans-pill--yes{background:#d1fae5;color:#065f46}
.ans-pill--partial{background:#fef3c7;color:#92400e}
.ans-pill--no{background:#f3f4f6;color:#6b7280}
.ans-pill--na{background:#f3f4f6;color:#9ca3af}

/* Controls */
.ctrl-group{border:1px solid #e5e7eb;border-radius:5px;overflow:hidden;margin-bottom:10px}
.ctrl-group--fs{border-color:#e9d5ff}
.ctrl-group-hdr{background:#f8fafc;padding:7px 12px;font-size:9pt;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb}
.ctrl-row{display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:9pt;border-bottom:1px solid #f0f0f0;flex-wrap:wrap}
.ctrl-row:last-child{border-bottom:none}
.ctrl-row--dim{color:#9ca3af}
.ctrl-row--fs{background:#faf5ff}
.ctrl-status{font-weight:700;flex-shrink:0;font-size:9pt}
.ctrl-status--sel{color:#16a34a}
.ctrl-status--desel{color:#9ca3af}
.ctrl-status--fs{color:#7c3aed}
.ctrl-src{font-size:8pt;font-weight:700;padding:1px 5px;border-radius:3px;flex-shrink:0}
.src-eu{background:#dbeafe;color:#1e40af}
.src-fs{background:#ede9fe;color:#7c3aed}
.ctrl-group--dpia{border-color:#99f6e4}
.ctrl-row--dpia{background:#f0fdfa}
.ctrl-status--dpia{color:#0f766e}
.src-dpia{background:#ccfbf1;color:#0f766e}
.ctrl-id{font-size:9pt;flex-shrink:0;color:#555}
.ctrl-name{flex:1}
.ctrl-ref{font-size:8.5pt;color:#888}

/* Compliance traceability */
.trace-summary{padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:9.5pt;font-weight:600}
.trace-summary--ok{background:#d1fae5;color:#065f46}
.trace-summary--warn{background:#fef3c7;color:#92400e}
.trace-article{margin-bottom:16px}
.trace-art-hdr{display:flex;align-items:baseline;gap:10px;padding:7px 12px;background:#1e3a5f;color:#fff;border-radius:4px 4px 0 0;font-size:9.5pt}
.trace-art-num{font-weight:700;flex-shrink:0}
.trace-art-name{flex:1}
.trace-no-hs{padding:8px 12px;font-size:9pt;color:#888;border:1px solid #e5e7eb;border-top:none}
.trace-hs{border:1px solid #e5e7eb;border-top:none;padding:6px 12px}
.data-table--trace{margin-bottom:0;border-radius:0 0 4px 4px}
.data-table--trace td{vertical-align:top;padding:6px 10px}
.trace-row--gap td{background:#fff7ed}
.trace-row--na td{background:#f8fafc}
.trace-hs-desc{font-size:8pt;color:#6b7280;margin-top:3px;line-height:1.4}
.trace-none{color:#9ca3af;font-size:9pt}
.hs-ref-chip{font-size:7.5pt;font-family:monospace;background:#e0e7ff;color:#3730a3;padding:1px 4px;border-radius:3px;white-space:nowrap;display:inline-block;margin:1px 1px 1px 0}
.trace-hs-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.trace-hs-ref{font-size:8.5pt;color:#555;flex-shrink:0}
.trace-hs-name{flex:1;font-size:9pt}
.trace-cov-badge{font-size:8.5pt;font-weight:700;padding:1px 6px;border-radius:3px;flex-shrink:0}
.trace-cov-badge--ok{background:#d1fae5;color:#065f46}
.trace-cov-badge--fs{background:#ede9fe;color:#7c3aed}
.trace-cov-badge--gap{background:#fee2e2;color:#991b1b}
.trace-cov-badge--na{background:#f1f5f9;color:#475569}
.trace-cov-badge--wf{background:#e0e7ff;color:#3730a3}
.trace-cov-badge--doc{background:#fef3c7;color:#92620e}
.trace-cov-badge--open{background:#ffedd5;color:#9a3412}
.trace-na-reason{font-size:8.5pt;color:#64748b;font-style:italic;padding:3px 4px 5px;border-left:2px solid #cbd5e1;margin-top:4px}
.trace-legend{margin:0 0 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;padding:8px 12px}
.trace-legend>summary{cursor:pointer;font-size:9.5pt;font-weight:700;color:#334155}
.trace-legend-list{list-style:none;margin:10px 0 6px;padding:0;display:flex;flex-direction:column;gap:6px}
.trace-legend-list li{font-size:9pt;line-height:1.5;color:#475569}
.trace-legend-note{font-size:8.5pt;line-height:1.5;color:#64748b;margin:6px 0 0;padding-top:6px;border-top:1px solid #e2e8f0}
.trace-ctrl-list{display:flex;gap:4px;flex-wrap:wrap;padding-top:4px}
.trace-ctrl-chip{font-size:8pt;padding:1px 5px;border-radius:3px;background:#e0e7ff;color:#3730a3;font-family:monospace}
.trace-ctrl-chip--fs{background:#ede9fe;color:#7c3aed}
.trace-test-chip{font-size:8pt;padding:1px 5px;border-radius:3px;background:#f0fdf4;color:#166534}
.trace-risk-tag{display:inline-block;font-size:7.5pt;font-weight:700;padding:0 4px;border-radius:3px;background:#fef3c7;color:#92400e;font-family:monospace;margin-right:2px}
.risk-id-badge{display:inline-block;font-size:8pt;font-weight:700;padding:1px 5px;border-radius:3px;background:#fef3c7;color:#92400e;font-family:monospace;margin-right:4px}


/* Test plans */
.test-progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin-bottom:4px}
.test-progress-fill{height:100%;background:#0d9488;border-radius:4px}
.test-progress-lbl{font-size:9pt;color:#555;margin-bottom:14px}
.test-plan{border:1px solid #e5e7eb;border-radius:5px;overflow:hidden;margin-bottom:12px}
.test-plan-hdr{background:#f8fafc;padding:8px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e5e7eb}
.test-plan-ref{font-size:9pt;font-weight:700;color:#0d9488}
.test-plan-name{font-size:9pt;font-weight:600;flex:1}
.test-plan-risk{font-size:8.5pt;color:#555;padding:4px 12px;border-bottom:1px solid #e5e7eb;background:#fafbff}

/* Declaration */
.declaration-block{background:#f8fafc;border-left:3px solid #0d9488;padding:14px 16px;margin:14px 0;font-size:9.5pt;line-height:1.65}
.declaration-block p{margin-bottom:10px}
.declaration-block p:last-child{margin-bottom:0}
.basis-list{margin:0 0 10px 0;padding-left:18px;list-style:disc}
.basis-list li{margin-bottom:7px}
.sig-table{width:100%;border-collapse:collapse;margin-top:32px}
.sig-cell{padding:8px 16px 0 0;vertical-align:bottom;width:33%}
.sig-line{border-bottom:1px solid #333;height:40px;margin-bottom:4px}
.sig-label{font-size:8.5pt;color:#555;font-weight:600}
.sig-table--approved .sig-cell{border-bottom:1px solid #86efac;padding-bottom:4px}
.sig-filled{height:40px;display:flex;align-items:flex-end;font-size:11pt;font-weight:600;color:#111;margin-bottom:4px}
.sig-approved{height:40px;display:flex;align-items:flex-end;font-size:11pt;font-weight:700;color:#15803d;margin-bottom:4px}
.approval-note{margin-top:10px;font-size:8.5pt;color:#15803d;font-style:italic}

/* SR Controls — Section 7 */
.sr-ctrl-block{border:1px solid #e5e7eb;border-radius:5px;overflow:hidden;margin-bottom:14px}
.sr-ctrl-hdr{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#1e3a5f;color:#fff;flex-wrap:wrap}
.sr-ctrl-ref{font-size:9.5pt;font-weight:700;white-space:nowrap;background:rgba(255,255,255,.15);padding:1px 7px;border-radius:3px;flex-shrink:0}
.sr-ctrl-name{font-size:9.5pt;font-weight:600;flex:1}
.sr-status{font-size:8.5pt;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;flex-shrink:0}
.sr-status--ok{background:#d1fae5;color:#065f46}
.sr-status--partial{background:#fef3c7;color:#92400e}
.sr-status--pend{background:#fee2e2;color:#991b1b}
.sr-status--manual{background:#f3f4f6;color:#6b7280}
.sr-ctrl-body{padding:10px 14px}
.sr-meta-table{margin-bottom:10px}
.sr-csa-label{color:#7c3aed!important;font-weight:700}
.sr-csa-text{color:#5b21b6;font-style:italic}
.sr-art-chip{font-size:8pt;padding:1px 6px;border-radius:3px;background:#dbeafe;color:#1e40af;margin-right:4px;white-space:nowrap}
.sr-art-xref{font-size:8pt;color:#9ca3af;font-style:italic}
.sr-steps-label{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:5px}
.sr-steps-list{display:flex;flex-direction:column;gap:3px}
.sr-step{display:flex;align-items:center;gap:8px;font-size:9pt;padding:3px 0}
.sr-step-icon{font-weight:700;width:14px;text-align:center;flex-shrink:0}
.sr-step--done .sr-step-icon{color:#16a34a}
.sr-step--pend .sr-step-icon{color:#9ca3af}
.sr-step--manual .sr-step-icon{color:#d1d5db}
.sr-step-num{font-size:8.5pt;font-weight:600;color:#555;flex-shrink:0;width:44px}
.sr-step-name{flex:1}
.sr-step-note{font-size:8pt;color:#9ca3af;font-style:italic}
.sr-step--done .sr-step-note{color:#16a34a}
.sr-step--pend .sr-step-note{color:#ef4444}
.sr-no-steps{font-size:9pt;color:#9ca3af;font-style:italic}

/* Utility */
.mono{font-family:Courier New,monospace;font-size:9pt}
.small{font-size:8.5pt}

/* RAG summary page */
.rag-page{padding:32px 40px;background:#fff}
.rag-page-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #0d9488}
.rag-page-title{font-size:16pt;font-weight:700;color:#111}
.rag-pill{display:inline-block;padding:4px 12px;border-radius:5px;font-size:9pt;font-weight:700}
.rag-pill--lg{font-size:11pt;padding:6px 16px}
.rag-pill--green{background:#dcfce7;color:#166534}
.rag-pill--amber{background:#fef3c7;color:#92400e}
.rag-pill--red{background:#fee2e2;color:#991b1b}
.rag-stat-row{display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.rag-stat{flex:1;min-width:140px;padding:14px 18px;border-radius:8px;border:1px solid #e5e7eb}
.rag-stat--ok{background:#f0fdf4;border-color:#bbf7d0}
.rag-stat--warn{background:#fffbeb;border-color:#fde68a}
.rag-stat--bad{background:#fef2f2;border-color:#fecaca}
.rag-stat-num{font-size:20pt;font-weight:800;color:#0d9488;line-height:1}
.rag-stat-lbl{font-size:9pt;color:#555;margin-top:4px}
.rag-count{display:inline-block;padding:2px 8px;border-radius:4px;font-size:8.5pt;font-weight:700}
.rag-count--ok{background:#dcfce7;color:#166534}
.rag-count--warn{background:#fef3c7;color:#92400e}
.rag-count--na{background:#f3f4f6;color:#9ca3af}
.rag-residual{display:inline-block;padding:2px 8px;border-radius:4px;font-size:8.5pt;font-weight:700}
.rag-residual--low{background:#dcfce7;color:#166534}
.rag-residual--medium{background:#fef3c7;color:#92400e}
.rag-residual--high{background:#fed7aa;color:#9a3412}
.rag-residual--critical{background:#fee2e2;color:#991b1b}
.rag-residual--na{background:#f3f4f6;color:#9ca3af}
.data-table td.center,.data-table th.center{text-align:center}

/* Outstanding items */
.outstanding-clear{padding:14px 18px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:10.5pt;color:#166534;font-weight:600}
.outstanding-warn{padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;font-size:10pt;color:#9a3412;margin-bottom:16px}

/* On-screen dark theme — print falls back to the light rules above */
@media screen{
  body{background:#1a1710;color:#e9e3d4;padding:20px 24px}
  .cover-org,.cs-num{color:#e0b94a}
  .cover-doc-type,.section-title,.csb-lbl{color:#f3efe3}
  .cover-header,.section-hdr{border-bottom-color:#d4b860}
  .section-num{background:linear-gradient(180deg,#ecd489,#d4b860);color:#241d08}
  .sub-heading{color:#a4ccf6;border-bottom-color:rgba(240,232,208,0.14)}
  .part-title{color:#f3efe3}
  .part-tag{color:#e0b94a}
  .part-desc,.section-desc{color:#b1a992}
  .part-banner{border-bottom-color:#d4b860}
  .part-divider{background:rgba(212,184,96,0.08);border-color:#d4b860;color:#ecd489}
  .cmt-label,.cs-lbl,.cs-sub,.csb-title,.section-meta,.reason-cell,.dt-label,.ctrl-ref,.ctrl-id,.empty-note,.ctrl-src{color:#b1a992}
  .cmt-value,.ctrl-name{color:#ece7da}
  .csb-icon--pend,.csb-status--pend,.ctrl-status--desel,.ctrl-row--dim,.row-dim td,.ans-pill--na{color:#7d755f}
  .cover-stats,.cover-status-block,.ctrl-group{border-color:rgba(240,232,208,0.14);background:transparent}
  .cs-box{border-right-color:rgba(240,232,208,0.14)}
  .cover-framework{background:rgba(212,184,96,0.08);border-left-color:#d4b860;color:#cfc7b2}
  .data-table th,.ctrl-group-hdr{background:#211d15;color:#d8d1bd;border-color:rgba(240,232,208,0.14)}
  .data-table td{border-color:rgba(240,232,208,0.12)}
  .ctrl-group-hdr{border-bottom-color:rgba(240,232,208,0.14)}
  .ctrl-row{border-bottom-color:rgba(240,232,208,0.08)}
  .ctrl-row--fs{background:rgba(138,130,235,0.10)}
  .ctrl-row--dpia{background:rgba(93,202,165,0.10)}
  .not-complete,.warn-banner,.outstanding-warn{background:rgba(224,120,80,0.12);border-color:rgba(224,120,80,0.4);color:#f3ab8a}
  .outstanding-clear{background:rgba(52,199,120,0.12);border-color:rgba(52,199,120,0.4);color:#8cebb0}
  .trace-summary--ok{background:rgba(52,199,120,0.14);color:#8cebb0}
  .trace-summary--warn{background:rgba(212,184,96,0.15);color:#ecd489}
  .applies-if-filter{background:rgba(212,184,96,0.18);color:#ecd489}
  /* The RAG summary now matches the dark report on screen (print stays light). */
  .rag-page{background:transparent;color:#e9e3d4}
  .rag-page-title{color:#f0e8d0}
  .rag-stat{background:rgba(240,232,208,0.05);border-color:rgba(240,232,208,0.14)}
  .rag-stat--ok{background:rgba(52,199,120,0.12);border-color:rgba(52,199,120,0.3)}
  .rag-stat--warn{background:rgba(212,184,96,0.12);border-color:rgba(212,184,96,0.3)}
  .rag-stat--bad{background:rgba(226,90,88,0.12);border-color:rgba(226,90,88,0.35)}
  .rag-stat-num{color:#6ee0b8}
  .rag-stat-lbl{color:#b1a992}
  /* Other pale "document" islands keep their light background; force dark text so they stay legible. */
  .declaration-block{color:#1f2937}
  .declaration-block .sub-heading{color:#1e3a5f}
  .test-plan-hdr{color:#1f2937}
  .trace-row--gap td,.trace-row--na td{color:#1f2937}
}
`;
  }

  // ---- Wrapper UI styles (outside the report iframe) ----------
  function _injectStyles() {
    if (document.getElementById('rpt-shell-styles')) return;
    const s = document.createElement('style');
    s.id = 'rpt-shell-styles';
    s.textContent = `
.rpt-shell{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--color-bg)}
.rpt-action-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--color-border);background:var(--color-surface);flex-shrink:0}
.rpt-bar-title{font-size:14px;font-weight:600;color:var(--color-text-primary)}
.rpt-print-btn{display:flex;align-items:center;gap:7px;padding:8px 18px;background:linear-gradient(180deg,var(--gold-bright),var(--gold));color:#241d08;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.rpt-print-btn:hover{background:linear-gradient(180deg,var(--gold),var(--gold-deep))}
.rpt-iframe{flex:1;border:none;background:var(--color-bg);width:100%}
`;
    document.head.appendChild(s);
  }

  // ---- Utility ------------------------------------------------
  // (no _el needed — UI is minimal; DOM helpers only for the action bar already inline)

})();
