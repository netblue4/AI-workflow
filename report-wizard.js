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

  // ---- Data loading -------------------------------------------
  async function _loadData() {
    try {
      const [rRes, rcRes, hsRes, tcRes, srRes, wfRes, lgRes] = await Promise.all([
        fetch('tbl_Risks.json'),
        fetch('tbl_Risk_Controls.json'),
        fetch('tbl_Harmonised_Standards.json'),
        fetch('tbl_Test_Controls.json'),
        fetch('tbl_AI_SR_Controls.json'),
        fetch('workflow.json'),
        fetch('step5-legal-risk-guidance.json')
      ]);
      if (!rRes.ok || !rcRes.ok || !hsRes.ok || !tcRes.ok || !srRes.ok || !wfRes.ok) throw new Error('fetch failed');
      const [risks, riskControls, hs, testControls, srControls, workflow] = await Promise.all([
        rRes.json(), rcRes.json(), hsRes.json(), tcRes.json(), srRes.json(), wfRes.json()
      ]);
      const legalGuidance = lgRes.ok ? await lgRes.json() : {};
      _tbl = { risks, riskControls, hs, testControls, srControls, workflow, legalGuidance };
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
    const s8  = _record?.['step-5']  || null;
    const s9  = _record?.['step-6']  || null;
    const s10 = _record?.['step-7']  || null;
    const meta = _record?._meta      || {};

    const today = new Date().toISOString().slice(0, 10);
    const useCase = meta.use_case_id || s3?.use_case_id || '—';
    const assessedBy = meta.assessed_by || s3?.classified_by || '—';

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
${_ragSummaryPage(s9, s10)}
${_section(1, 'System Classification', _classificationSection(s3))}
${_section(2, 'EU AI Act Compliance Traceability', _complianceTraceabilitySection(s3, s9, s10))}
${_section(3, 'Risk Identification', _riskAssessmentSection(s8, s10))}
${_section(4, 'Control Schedule', _controlScheduleSection(s9, s10))}
${_section(5, 'Verification Evidence', _verificationSection(s10))}
${_section(6, 'Outstanding Items', _outstandingItemsSection(s9, s10))}
${_section(7, 'Conformity Assessment Declaration', _conformityDeclarationSection(s3, s9, s10, today, useCase, assessedBy))}
${_section(8, 'Internal Standard Compliance — AI Acceptable Use Standard', _srControlsSection())}
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
    if (s === 'evidence_provided') return '✓ Activated';
    if (s === 'waived')            return '— Waived';
    if (s === 'in_progress')       return '◑ In progress';
    return '○ Not started';
  }

  // ---- RAG Summary Page (CAB Sign-off) ----------------------
  function _ragSummaryPage(s9, s10) {
    if (!s9) return '';

    // Build lookup maps
    const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));
    const riskIdByName = new Map((_tbl.risks || []).map(r => [r.risk_name, r.pk_Risk_ID]));

    // Control statuses from s10 (activation controls now in step-7)
    const ctrlStatus = new Map();
    (s10?.controls || []).forEach(c => ctrlStatus.set(c.key, c.status));

    // Legal risks are treated via HS-requirement activation, not controls.
    const legal        = _legalHsTreatments(s9, s10);
    const legalCtrlIds = _legalHsControlIds();
    legal.statusByKey.forEach((v, k) => ctrlStatus.set(k, v));

    // Test plans by risk
    const testByRisk = new Map();
    (s10?.plans || []).forEach(plan => {
      const riskId = riskIdByName.get(plan.risk_name);
      if (riskId) testByRisk.set(riskId, plan.test_controls || []);
    });

    // Group treatment units by risk_id: real (non-legal) selected controls plus
    // the legal HS requirements standing in for the removed HS controls.
    const byRisk = new Map();
    [...(s9.risk_controls || []).filter(c => c.selected && c.control_source !== 'Harmonised_Standard'),
     ...legal.rows].forEach(c => {
      const key = c.risk_id || 'unknown';
      if (!byRisk.has(key)) byRisk.set(key, []);
      byRisk.get(key).push(c);
    });

    const DONE_STATUSES = new Set(['evidence_provided', 'completed', 'waived', 'not_applicable']);

    // Stats for top boxes
    let totalCtrls = 0, doneCtrls = 0;
    let totalTests = 0, doneTests = 0;
    const compAdds  = s9.compliance_additions || [];
    const dpiaAdds  = s9.dpia_controls || [];
    const addlCount = compAdds.length + dpiaAdds.length;

    // Count activation controls from s10 (excluding legacy legal HS controls,
    // which are represented by the HS requirements below).
    (s10?.controls || []).forEach(c => {
      if (legalCtrlIds.has(c.key)) return;
      totalCtrls++;
      if (c.status === 'evidence_provided' || c.status === 'waived') doneCtrls++;
    });
    legal.rows.forEach(c => {
      totalCtrls++;
      const st = ctrlStatus.get(c.control_id);
      if (st === 'evidence_provided' || st === 'waived') doneCtrls++;
    });

    // Count all tests
    (s10?.plans || []).forEach(plan => {
      (plan.test_controls || []).forEach(tc => {
        totalTests++;
        if (DONE_STATUSES.has(tc.status)) doneTests++;
      });
    });

    const ctrlStatClass = totalCtrls === 0 ? 'warn' : (doneCtrls === totalCtrls ? 'ok' : (doneCtrls > 0 ? 'warn' : 'bad'));
    const testStatClass = totalTests === 0 ? 'warn' : (doneTests === totalTests ? 'ok' : (doneTests > 0 ? 'warn' : 'bad'));
    const addlStatClass = addlCount > 0 ? 'warn' : 'ok';

    // Per-risk RAG rows
    let overallGreen = 0, overallAmber = 0, overallRed = 0;
    const riskRows = [];

    byRisk.forEach((ctrls, riskId) => {
      const riskName = riskNameById.get(riskId) || riskId;

      const ctrlTotal = ctrls.length;
      const ctrlDone  = ctrls.filter(c => {
        const st = ctrlStatus.get(c.control_id);
        return st === 'evidence_provided' || st === 'waived';
      }).length;

      const tests     = testByRisk.get(riskId) || [];
      const testTotal = tests.length;
      const testDone  = tests.filter(tc => DONE_STATUSES.has(tc.status)).length;

      const ctrlAllDone  = ctrlTotal > 0 && ctrlDone === ctrlTotal;
      const testAllDone  = testTotal === 0 || testDone === testTotal;
      const anyProgress  = ctrlDone > 0 || testDone > 0;

      let rag;
      if (ctrlAllDone && testAllDone) { rag = 'green'; overallGreen++; }
      else if (anyProgress)            { rag = 'amber'; overallAmber++; }
      else                             { rag = 'red';   overallRed++;   }

      const ctrlCls  = ctrlTotal === 0 ? 'na' : (ctrlDone === ctrlTotal ? 'ok' : (ctrlDone > 0 ? 'warn' : 'na'));
      const testCls  = testTotal === 0 ? 'na' : (testDone === testTotal ? 'ok' : (testDone > 0 ? 'warn' : 'na'));

      const residualLevel = s10?.residual_risks?.[riskId]?.level;
      const residualHtml  = residualLevel
        ? `<span class="rag-residual rag-residual--${_esc(residualLevel)}">${_esc(residualLevel.charAt(0).toUpperCase() + residualLevel.slice(1))}</span>`
        : `<span class="rag-residual rag-residual--na">—</span>`;

      riskRows.push(`<tr>
        <td><span class="risk-id-badge">${_esc(riskId)}</span></td>
        <td>${_esc(riskName)}</td>
        <td class="center"><span class="rag-count rag-count--${ctrlCls}">${ctrlDone}/${ctrlTotal}</span></td>
        <td class="center"><span class="rag-count rag-count--${testCls}">${testDone}/${testTotal}</span></td>
        <td class="center">${residualHtml}</td>
        <td class="center"><span class="rag-pill rag-pill--${rag}">${rag.charAt(0).toUpperCase() + rag.slice(1)}</span></td>
      </tr>`);
    });

    const overall = overallRed > 0 ? 'red' : (overallAmber > 0 ? 'amber' : 'green');
    const overallLabel = overall === 'green' ? 'All Green' : (overall === 'amber' ? 'Amber' : 'Red');

    return `
<div class="rag-page page-break">
  <div class="rag-page-hdr">
    <div class="rag-page-title">CAB Sign-off Summary</div>
    <span class="rag-pill rag-pill--${overall} rag-pill--lg">${overallLabel}</span>
  </div>
  <div class="rag-stat-row">
    <div class="rag-stat rag-stat--${ctrlStatClass}">
      <div class="rag-stat-num">${doneCtrls}/${totalCtrls}</div>
      <div class="rag-stat-lbl">Controls evidenced</div>
    </div>
    <div class="rag-stat rag-stat--${testStatClass}">
      <div class="rag-stat-num">${doneTests}/${totalTests}</div>
      <div class="rag-stat-lbl">Tests resolved</div>
    </div>
    <div class="rag-stat rag-stat--${addlStatClass}">
      <div class="rag-stat-num">${addlCount}</div>
      <div class="rag-stat-lbl">Additional controls</div>
    </div>
  </div>
  <table class="data-table">
    <thead><tr><th>Risk ID</th><th>Risk Name</th><th class="center">Controls</th><th class="center">Tests</th><th class="center">Residual Risk</th><th class="center">Status</th></tr></thead>
    <tbody>${riskRows.join('')}</tbody>
  </table>
  <p class="section-meta">Compliance additions and DPIA controls are not shown in the per-risk table above. See §4 Control Schedule for their operational status.</p>
</div>`;
  }

  // ---- Outstanding Items Section -----------------------------
  function _outstandingItemsSection(s9, s10) {
    let html = '';

    // Outstanding controls
    const outstandingCtrls = [];
    const legal        = _legalHsTreatments(s9, s10);
    const legalCtrlIds = _legalHsControlIds();
    if (!s9) {
      html += `<div class="outstanding-warn">Step 6 (Control Identification) not yet completed.</div>`;
    } else if (!s10 || (!s10.controls?.length && !s10.hs_activation)) {
      html += `<div class="outstanding-warn">Step 7 (Residual Risk) — Control Activation tab not yet completed.</div>`;
    } else {
      const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));

      const selectedKeys = new Set([
        ...(s9.risk_controls || []).filter(c => c.selected).map(c => c.control_id),
        ...(s9.compliance_additions || []).map(c => c.control_id),
        ...(s9.dpia_controls || []).map(c => 'DPIA__' + c.control_name),
        ...((s9.group_standard_controls && s9.group_standard_controls.controls) || []).filter(c => c.selected).map(c => c.control_id)
      ]);

      // Real (non-legal) activation controls
      (s10.controls || []).forEach(c => {
        if (legalCtrlIds.has(c.key)) return;
        if (!selectedKeys.has(c.key)) return;
        if (c.status === 'evidence_provided' || c.status === 'waived') return;
        outstandingCtrls.push(c);
      });

      // Legal HS requirements not yet activated
      legal.rows.forEach(c => {
        const st = legal.statusByKey.get(c.control_id);
        if (st === 'evidence_provided' || st === 'waived') return;
        outstandingCtrls.push({ key: c.control_id, name: c.control_name, risk_id: c.risk_id, status: st });
      });
    }

    // Outstanding tests
    const outstandingTests = [];
    if (!s10) {
      html += `<div class="outstanding-warn">Step 7 (Control Verification Testing) not yet completed.</div>`;
    } else {
      const DONE_STATUSES = new Set(['evidence_provided', 'completed', 'waived', 'not_applicable']);
      (s10.plans || []).forEach(plan => {
        (plan.test_controls || []).forEach((tc, idx) => {
          if (DONE_STATUSES.has(tc.status)) return;
          outstandingTests.push({
            planRef:  plan.plan_ref || `Plan ${idx + 1}`,
            testName: tc.control_name || tc.test_control_id || '—',
            riskName: plan.risk_name || '—',
            status:   tc.status || 'not_started'
          });
        });
      });
    }

    if (s9 && s10 && outstandingCtrls.length === 0 && outstandingTests.length === 0) {
      return `<div class="outstanding-clear">✓ All controls evidenced and all tests resolved. Ready for CAB sign-off.</div>`;
    }

    if (outstandingCtrls.length > 0) {
      const riskNameById = new Map((_tbl.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));
      html += `<h3 class="sub-heading">Outstanding Controls (${outstandingCtrls.length})</h3>
<table class="data-table">
  <thead><tr><th>Control ID</th><th>Name</th><th>Risk</th><th>Current Status</th></tr></thead>
  <tbody>
  ${outstandingCtrls.map(c => `<tr>
    <td class="mono">${_esc(c.key)}</td>
    <td>${_esc(c.name || '—')}</td>
    <td>${_esc(c.risk_name || (riskNameById.get(c.risk_id) || '—'))}</td>
    <td>${_ctrlStatusPill(c.status)}</td>
  </tr>`).join('')}
  </tbody>
</table>`;
    }

    if (outstandingTests.length > 0) {
      html += `<h3 class="sub-heading">Outstanding Tests (${outstandingTests.length})</h3>
<table class="data-table">
  <thead><tr><th>Plan Ref</th><th>Test Name</th><th>Risk</th><th>Current Status</th></tr></thead>
  <tbody>
  ${outstandingTests.map(t => `<tr>
    <td class="mono">${_esc(t.planRef)}</td>
    <td>${_esc(t.testName)}</td>
    <td>${_esc(t.riskName)}</td>
    <td><span class="status-pill status-pill--${_testStatusKey(t.status)}">${_testStatusLabel(t.status)}</span></td>
  </tr>`).join('')}
  </tbody>
</table>`;
    }

    return html || `<div class="outstanding-warn">Insufficient data to determine outstanding items.</div>`;
  }

  // ---- Cover page --------------------------------------------
  function _coverPage(s3, s8, s9, s10, meta, today, useCase, assessedBy) {
    const tier     = s3?.axis_a?.tier_label || '—';
    const category = s3?.axis_b?.ai_act_outcome || '—';
    const role     = s3?.axis_b?.organisation_role || '—';
    const artCount = s3?.axis_b?.applicable_articles?.length ?? 0;

    const legalSel   = s8?.legal_assessment?.selected_count ?? '—';
    const legalTotal = s8?.legal_assessment?.total_risks    ?? '—';

    // Legal risks are treated via HS requirements, not the legacy HS controls.
    const legalHsCount = _legalHsTreatments(s9, s10).rows.length;
    const riskCtrls = (s9?.risk_controls || []).filter(c => c.selected && c.control_source !== 'Harmonised_Standard').length + legalHsCount;
    const compAdds  = (s9?.compliance_additions || []).length;
    const dpiaAdds  = (s9?.dpia_controls || []).length;

    const totalTests = s10?.total_tests ?? '—';
    const doneTests  = s10?.completed_tests ?? 0;
    const naTests    = s10?.not_applicable_tests ?? 0;
    const pendTests  = s10?.pending_tests ?? '—';

    const steps = [
      ['System Classification', !!s3],
      ['Risk Identification',    !!s8?.legal_assessment?.completed],
      ['Control Identification', !!s9],
      ['Control Verification',   !!s10]
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
        <div class="cs-num">${riskCtrls + compAdds + dpiaAdds}</div>
        <div class="cs-lbl">Controls selected<br><span class="cs-sub">${riskCtrls} risk team · ${compAdds} compliance · ${dpiaAdds} DPIA</span></div>
      </div>
      <div class="cs-box">
        <div class="cs-num">${doneTests + naTests}${typeof totalTests === 'number' ? `/${totalTests}` : ''}</div>
        <div class="cs-lbl">Tests resolved<br><span class="cs-sub">${doneTests} completed · ${naTests} N/A · ${pendTests} pending</span></div>
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

  // ---- Section 2: Risk Assessment ----------------------------
  function _riskAssessmentSection(s8, s10) {
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
        const rationale = r.rationale
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

    // ---- Internal Standards Risk Assessment ----
    const gsa = s8.group_standard_assessment;
    html += `<h3 class="sub-heading">Internal Standards Risk Assessment (Acceptable Use of AI Tools Standard)</h3>`;
    if (!gsa?.completed) {
      html += _notComplete('Internal Standards assessment not yet saved.');
    } else {
      html += `<p class="section-meta">Completed: ${gsa.assessment_date} &nbsp;|&nbsp; ${gsa.selected_count} of ${gsa.total_risks} risks applicable</p>`;
      html += `<table class="data-table data-table--risk">
  <thead><tr><th style="width:20%">Risk</th><th style="width:8%">Applicable</th><th style="width:9%">Residual Risk</th><th>Standard</th></tr></thead>
  <tbody>`;
      (gsa.risks || []).forEach(r => {
        const residual = s10?.residual_risks?.[r.risk_id];
        const residualHtml = residual?.level
          ? `<span class="rag-residual rag-residual--${_esc(residual.level)}">${_esc(residual.level.charAt(0).toUpperCase() + residual.level.slice(1))}</span>`
          : '—';
        const ansKey = r.selected ? 'yes' : 'no';
        const ansTxt = r.selected ? 'Yes' : 'No';
        const rowCls = r.selected ? '' : ' class="row-dim"';
        html += `<tr${rowCls}>
      <td><span class="risk-id-badge">${_esc(r.risk_id)}</span> ${_esc(r.risk_name)}</td>
      <td><span class="ans-pill ans-pill--${ansKey}">${ansTxt}</span></td>
      <td class="center">${residualHtml}</td>
      <td class="reason-cell">${_esc(r.groupstandard_ref || '—')}</td>
    </tr>`;
      });
      html += `</tbody></table>`;
    }

    // ---- DPIA Risk Assessment ----
    const s4 = _record?.['step-4'];
    html += `<h3 class="sub-heading">DPIA Risk Assessment</h3>`;
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
  function _controlScheduleSection(s9, s10) {
    if (!s9) return _notComplete('Step 6 — Control Identification has not yet been completed.');

    const riskCtrls = s9.risk_controls || [];
    const compAdds  = s9.compliance_additions || [];
    const dpiaAdds  = s9.dpia_controls || [];

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

    // ---- Risk Team Controls -----------------------------------------
    html += `<h3 class="sub-heading">Risk Team Controls</h3>`;
    if (byRisk.size === 0) {
      html += _notComplete('No risk controls recorded.');
    } else {
      byRisk.forEach((ctrls, riskId) => {
        const selected   = ctrls.filter(c => c.selected);
        const deselected = ctrls.filter(c => !c.selected);
        const riskName   = riskNameById.get(riskId);
        const riskLabel  = riskName ? `${_esc(riskId)} — ${_esc(riskName)}` : _esc(riskId);
        html += `<div class="ctrl-group">
          <div class="ctrl-group-hdr">${riskLabel}</div>
          <table class="data-table data-table--sched">
            <thead><tr><th>Control ID</th><th>Name</th><th>Standards</th><th>Operational Status</th></tr></thead>
            <tbody>
            ${selected.map(c => `<tr>
              <td class="mono">${_esc(c.control_id)}</td>
              <td>${_esc(c.control_name || '—')}</td>
              <td>${_hsCell(c)}</td>
              <td>${_ctrlStatusPill(ctrlStatus.get(c.control_id))}</td>
            </tr>`).join('')}
            ${deselected.map(c => `<tr class="ctrl-row--dim">
              <td class="mono">${_esc(c.control_id)}</td>
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

    // ---- Internal Standards Controls -----------------------------------
    const gsCtrls = ((s9.group_standard_controls && s9.group_standard_controls.controls) || []).filter(c => c.selected);
    if (gsCtrls.length > 0) {
      html += `<h3 class="sub-heading">Internal Standards Controls</h3>`;
      const gsByRisk = new Map();
      gsCtrls.forEach(c => {
        const k = c.risk_id || 'unknown';
        if (!gsByRisk.has(k)) gsByRisk.set(k, []);
        gsByRisk.get(k).push(c);
      });
      gsByRisk.forEach((ctrls, riskId) => {
        const riskName  = riskNameById.get(riskId);
        const riskLabel = riskName ? `${_esc(riskId)} — ${_esc(riskName)}` : _esc(riskId);
        html += `<div class="ctrl-group">
          <div class="ctrl-group-hdr">${riskLabel}</div>
          <table class="data-table data-table--sched">
            <thead><tr><th>Control ID</th><th>Name</th><th>Standards</th><th>Operational Status</th></tr></thead>
            <tbody>
            ${ctrls.map(c => `<tr>
              <td class="mono">${_esc(c.control_id)}</td>
              <td>${_esc(c.control_name || '—')}</td>
              <td>${_hsCell(c)}</td>
              <td>${_ctrlStatusPill(ctrlStatus.get(c.control_id))}</td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      });
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
    let gapCount = 0;
    let coveredCount = 0;
    let byTypeCount = 0;

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
          // Not Applicable: either a per-deployment N/A decision, or a requirement
          // marked structurally out of scope for this system type (coverage_type).
          const isNA       = !activated && (!!hsNA[ref] || ctype === 'Not_Applicable');
          // Workflow- and Document-type requirements are evidenced by their own
          // mechanism (the report's own output, or an external artefact), so they
          // are covered even without a legal-risk activation — not gaps.
          const byType     = !activated && !isNA && (ctype === 'Workflow' || ctype === 'Document');
          const covered    = activated || byType;

          if (covered) coveredCount++; else if (!isNA) gapCount++;
          if (byType) byTypeCount++;

          let badgeKey, badgeTxt;
          if (activated)            { badgeKey = hsRisks.length > 0 ? 'ok' : 'fs'; badgeTxt = hsRisks.length > 0 ? '✓ Activated' : '✓ Self-certified'; }
          else if (isNA)            { badgeKey = 'na';  badgeTxt = '⊘ N/A'; }
          else if (ctype === 'Workflow') { badgeKey = 'wf';  badgeTxt = '⚙ Workflow'; }
          else if (ctype === 'Document') { badgeKey = 'doc'; badgeTxt = '▤ Document'; }
          else                      { badgeKey = 'gap'; badgeTxt = '⚠ Gap'; }
          const naReason = isNA ? (hsNA[ref] ? hsNA[ref].reason : 'Not applicable to this system type') : '';
          const rowCls   = covered ? '' : (isNA ? 'trace-row--na' : 'trace-row--gap');

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
          } else if (ctype === 'Workflow') {
            ctrlCell += `<span class="trace-ctrl-chip">Evidenced by the governance workflow</span>`;
          } else if (ctype === 'Document') {
            ctrlCell += `<span class="trace-ctrl-chip">Evidenced by an external document</span>`;
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

    const naCount      = Object.keys(hsNA).length;
    const totalHS      = coveredCount + gapCount + naCount;
    const summaryClass = gapCount === 0 ? 'trace-summary--ok' : 'trace-summary--warn';
    const byTypeNote = byTypeCount > 0 ? ` (${byTypeCount} evidenced by workflow or document)` : '';
    const summaryText  = gapCount === 0
      ? `✓ ${coveredCount} HS requirement${coveredCount !== 1 ? 's' : ''} covered${byTypeNote}${naCount > 0 ? `, ${naCount} marked Not Applicable` : ''}. No unresolved gaps.`
      : `⚠ ${gapCount} gap${gapCount !== 1 ? 's' : ''} identified across ${totalHS} HS requirements${byTypeNote}. Gaps must be resolved before conformity sign-off.${naCount > 0 ? ` (${naCount} marked Not Applicable)` : ''}`;

    return `<div class="trace-summary ${summaryClass}">${summaryText}</div>` + html;
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
  function _conformityDeclarationSection(s3, s9, s10, today, useCase, assessedBy) {
    const artCount   = s3?.axis_b?.applicable_articles?.length ?? 0;
    // Legal risks are treated via HS requirements, not the legacy HS controls.
    const legalHsCount = _legalHsTreatments(s9, s10).rows.length;
    const riskCtrlSel = (s9?.risk_controls || []).filter(c => c.selected && c.control_source !== 'Harmonised_Standard').length + legalHsCount;
    const compAdds    = (s9?.compliance_additions || []).length;
    const dpiaAdds    = (s9?.dpia_controls || []).length;
    const doneTests   = s10?.evidence_provided_tests ?? s10?.completed_tests ?? '—';
    const naTests     = s10?.waived_tests ?? s10?.not_applicable_tests ?? '—';
    const pendTests   = s10?.pending_tests ?? '—';

    const allDone = !!s3 && !!s9 && !!s10;
    const noPendingTests = typeof pendTests === 'number' && pendTests === 0;

    return `
<h3 class="sub-heading">Article 43 HS Requirements — Completion Checklist</h3>
<table class="data-table">
  <thead><tr><th>HS Ref</th><th>Requirement</th><th>Evidence</th><th>Status</th></tr></thead>
  <tbody>
    <tr>
      <td class="mono">[18286.16]</td>
      <td>Articles 9–17 Completion Verification</td>
      <td>Sections 1–5 of this report evidence completion of all applicable article requirements</td>
      <td><span class="status-pill status-pill--${allDone ? 'accept' : 'pend'}">${allDone ? '✓ Evidenced' : '○ Pending'}</span></td>
    </tr>
    <tr>
      <td class="mono">[18286.17]</td>
      <td>Competent Reviewer Sign-off</td>
      <td>AI Change Board approval decision (below)</td>
      <td><span class="status-pill status-pill--pend">○ Awaiting Board</span></td>
    </tr>
    <tr>
      <td class="mono">[18286.18]</td>
      <td>No Critical Gaps Declaration</td>
      <td>Compliance Traceability section — all applicable HS requirements must show ✓ Activated or ✓ Self-certified</td>
      <td><span class="status-pill status-pill--${allDone ? 'accept' : 'pend'}">${allDone ? '✓ See Section 2' : '○ Pending'}</span></td>
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
  <tr><td class="dt-label">Risk-Team Treatments (HS requirements + controls)</td><td>${riskCtrlSel}</td></tr>
  <tr><td class="dt-label">Controls Added (Compliance Team)</td><td>${compAdds}</td></tr>
  <tr><td class="dt-label">Controls Committed (DPIA)</td><td>${dpiaAdds}</td></tr>
  <tr><td class="dt-label">Total Controls</td><td>${riskCtrlSel + compAdds + dpiaAdds}</td></tr>
  <tr><td class="dt-label">Tests — Evidence Provided</td><td>${doneTests}</td></tr>
  <tr><td class="dt-label">Tests — Waived</td><td>${naTests}</td></tr>
  <tr><td class="dt-label">Tests Pending</td><td>${pendTests}</td></tr>
  <tr><td class="dt-label">Report Generated</td><td>${today}</td></tr>
</table>

${!noPendingTests && s10 ? `<div class="warn-banner">⚠ ${pendTests} test${pendTests !== 1 ? 's' : ''} remain pending. All tests must be resolved (completed or marked not applicable) before this report can be used as the conformity assessment submission.</div>` : ''}

<h3 class="sub-heading">Basis of Conformity</h3>
<div class="declaration-block">
  <p>This assessment establishes conformity through two complementary routes:</p>
  <ul class="basis-list">
    <li><strong>EU AI Act requirements</strong> are evidenced against <strong>harmonised standard (HS)
    requirements</strong>. For each applicable Article, the corresponding HS requirements are activated as the
    risk-treatment measures and traced in Section 2 (Compliance Traceability). This report records each
    requirement, its activation status and its implementing evidence; the technical implementation of each HS
    requirement is carried out by the development team.</li>
    <li><strong>internal standard requirements</strong> are evidenced by the organisation's workflow controls,
    scheduled with their operational status in Sections 3–4.</li>
  </ul>
  <p><strong>Presumption of conformity.</strong> Under <strong>Article 40</strong> of Regulation (EU) 2024/1689,
  an AI system that conforms to harmonised standards — or parts thereof — whose references are published in the
  <em>Official Journal of the European Union</em> is presumed to conform to the corresponding requirements of the
  Regulation. The harmonised standards referenced in this assessment are currently under development. Once their
  references are cited in the Official Journal, the HS-requirement activation records in this report map directly
  to those citations, allowing this AI system to claim presumption of conformity for the covered requirements
  without re-assessment.</p>
</div>

<h3 class="sub-heading">Declaration of Conformity</h3>
<div class="declaration-block">
  <p>The undersigned confirms that the AI system identified above has been assessed against the applicable
  requirements of Regulation (EU) 2024/1689 (EU AI Act) in accordance with the organisation's AI governance
  workflow. This assessment covers system classification, risk identification, control selection, harmonised
  standard traceability, and verification testing as documented in this report.</p>
  <p>To the best of the reviewer's knowledge, the described system complies with the applicable requirements
  identified in this assessment, subject to the outstanding items noted above.</p>
</div>

${_signatureBlock()}`;
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
  function _section(num, title, content) {
    return `<div class="section ${num === 1 ? '' : 'page-break'}">
      <div class="section-hdr">
        <span class="section-num">${num}</span>
        <span class="section-title">${title}</span>
      </div>
      <div class="section-body">${content}</div>
    </div>`;
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
    if (status === 'evidence_provided') return '<span class="status-pill status-pill--accept">✓ Evidence provided</span>';
    if (status === 'waived')            return '<span class="status-pill status-pill--na">— Waived</span>';
    if (status === 'in_progress')       return '<span class="status-pill status-pill--pend">◑ In progress</span>';
    if (status === 'not_started')       return '<span class="status-pill status-pill--excl">○ Not started</span>';
    return '<span class="status-pill status-pill--excl">— Not recorded</span>';
  }

  function _testStatusKey(status) {
    if (status === 'evidence_provided' || status === 'completed')      return 'accept';
    if (status === 'waived'            || status === 'not_applicable') return 'na';
    if (status === 'in_progress')                                      return 'pend';
    return 'pend';
  }

  function _testStatusLabel(status) {
    if (status === 'evidence_provided') return '✓ Evidence provided';
    if (status === 'completed')         return '✓ Completed';
    if (status === 'waived')            return '— Waived';
    if (status === 'not_applicable')    return '— N/A';
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
.section-body{padding-bottom:20px}
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
.trace-na-reason{font-size:8.5pt;color:#64748b;font-style:italic;padding:3px 4px 5px;border-left:2px solid #cbd5e1;margin-top:4px}
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
