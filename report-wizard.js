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
      const [rRes, rcRes, hsRes, artRes, tpRes, srRes, wfRes] = await Promise.all([
        fetch('tbl_Risks.json'),
        fetch('tbl_Risk_Controls.json'),
        fetch('tbl_Harmonised_Standards.json'),
        fetch('tbl_AI_Articles.json'),
        fetch('tbl_Test_Plans.json'),
        fetch('tbl_AI_SR_Controls.json'),
        fetch('workflow.json')
      ]);
      if (!rRes.ok || !rcRes.ok || !hsRes.ok || !artRes.ok || !tpRes.ok || !srRes.ok || !wfRes.ok) throw new Error('fetch failed');
      const [risks, riskControls, hs, articles, testPlans, srControls, workflow] = await Promise.all([
        rRes.json(), rcRes.json(), hsRes.json(), artRes.json(), tpRes.json(), srRes.json(), wfRes.json()
      ]);
      _tbl = { risks, riskControls, hs, articles, testPlans, srControls, workflow };
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

    // Iframe preview
    const iframe = document.createElement('iframe');
    iframe.className = 'rpt-iframe';
    iframe.setAttribute('title', 'Conformity Assessment Report Preview');
    shell.appendChild(iframe);

    _container.appendChild(shell);

    const html = _buildReportHTML();
    iframe.srcdoc = html;
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
    const s8  = _record?.['step-8']  || null;
    const s9  = _record?.['step-9']  || null;
    const s10 = _record?.['step-10'] || null;
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
${_section(1, 'System Classification', _classificationSection(s3))}
${_section(2, 'Risk Assessment', _riskAssessmentSection(s8))}
${_section(3, 'Control Schedule', _controlScheduleSection(s9))}
${_section(4, 'EU AI Act Compliance Traceability', _complianceTraceabilitySection(s3, s9))}
${_section(5, 'Verification Evidence', _verificationSection(s10))}
${_section(6, 'Conformity Assessment Declaration', _conformityDeclarationSection(s3, s9, s10, today, useCase, assessedBy))}
${_section(7, 'Internal Standard Compliance — AI Acceptable Use Standard', _srControlsSection())}
</body>
</html>`;
  }

  // ---- Cover page --------------------------------------------
  function _coverPage(s3, s8, s9, s10, meta, today, useCase, assessedBy) {
    const tier     = s3?.axis_a?.tier_label || '—';
    const category = s3?.axis_b?.ai_act_outcome || '—';
    const role     = s3?.axis_b?.organisation_role || '—';
    const artCount = s3?.axis_b?.applicable_articles?.length ?? 0;

    const legalSel   = s8?.legal_assessment?.selected_count ?? '—';
    const legalTotal = s8?.legal_assessment?.total_risks    ?? '—';

    const riskCtrls = (s9?.risk_controls || []).filter(c => c.selected).length;
    const compAdds  = (s9?.compliance_additions || []).length;

    const totalTests = s10?.total_tests ?? '—';
    const doneTests  = s10?.completed_tests ?? 0;
    const naTests    = s10?.not_applicable_tests ?? 0;
    const pendTests  = s10?.pending_tests ?? '—';

    const steps = [
      ['System Classification', !!s3],
      ['Risk Assessment',        !!s8?.legal_assessment?.completed],
      ['Control Identification', !!s9],
      ['Verification Testing',   !!s10]
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
        <div class="cs-num">${riskCtrls + compAdds}</div>
        <div class="cs-lbl">Controls selected<br><span class="cs-sub">${riskCtrls} risk team · ${compAdds} compliance additions</span></div>
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
  function _riskAssessmentSection(s8) {
    if (!s8) return _notComplete('Step 8 — Risk Assessment has not yet been completed.');

    let html = '';

    // Legal
    const la = s8.legal_assessment;
    html += `<h3 class="sub-heading">Legal / Regulatory Risk Assessment (EU AI Act)</h3>`;
    if (!la?.completed) {
      html += _notComplete('Legal assessment not yet saved.');
    } else {
      html += `<p class="section-meta">Completed: ${la.assessment_date} &nbsp;|&nbsp; ${la.selected_count} of ${la.total_risks} risks accepted</p>
<table class="data-table">
  <thead><tr><th>Risk Name</th><th>Answer</th><th>Status</th><th>Filter Reason</th></tr></thead>
  <tbody>
  ${(la.risks || []).map(r => {
    const rel = r.relevance || {};
    const prefiltered = rel.status === 'not_applicable';
    return `<tr class="${r.selected ? '' : 'row-dim'}">
      <td>${_esc(r.risk_name)}</td>
      <td>${_esc(r.wizard_answer || '—')}</td>
      <td><span class="status-pill status-pill--${r.selected ? 'accept' : (prefiltered ? 'filter' : 'excl')}">${r.selected ? '✓ Accepted' : (prefiltered ? '⊘ Pre-filtered' : '✗ Excluded')}</span></td>
      <td class="reason-cell">${prefiltered ? _esc(rel.trigger_reason || 'Article not applicable') : ''}</td>
    </tr>`;
  }).join('')}
  </tbody>
</table>`;
    }

    return html;
  }

  // ---- Section 3: Control Schedule ---------------------------
  function _controlScheduleSection(s9) {
    if (!s9) return _notComplete('Step 9 — Control Identification has not yet been completed.');

    const riskCtrls = s9.risk_controls || [];
    const compAdds  = s9.compliance_additions || [];

    // Group risk controls by risk_id
    const byRisk = new Map();
    riskCtrls.forEach(c => {
      const key = c.risk_id || 'unknown';
      if (!byRisk.has(key)) byRisk.set(key, []);
      byRisk.get(key).push(c);
    });

    // Separate FS controls
    const fsCtrls = compAdds.filter(c => (c.control_source || '').includes('Framework'));
    const regularAdds = compAdds.filter(c => !(c.control_source || '').includes('Framework'));

    let html = `<p class="section-meta">Assessment date: ${s9.assessment_date || '—'} &nbsp;|&nbsp;
      ${riskCtrls.filter(c=>c.selected).length} risk controls · ${compAdds.length} compliance additions</p>`;

    html += `<h3 class="sub-heading">Risk Team Controls</h3>`;
    if (byRisk.size === 0) {
      html += _notComplete('No risk controls recorded.');
    } else {
      byRisk.forEach((ctrls, riskId) => {
        const selected = ctrls.filter(c => c.selected);
        const deselected = ctrls.filter(c => !c.selected);
        html += `<div class="ctrl-group">
          <div class="ctrl-group-hdr">${_esc(riskId)}</div>
          ${selected.map(c => _ctrlRow(c, true)).join('')}
          ${deselected.map(c => _ctrlRow(c, false)).join('')}
        </div>`;
      });
    }

    if (regularAdds.length > 0) {
      html += `<h3 class="sub-heading">Compliance Team Additions</h3>
      <div class="ctrl-group">
        ${regularAdds.map(c => _ctrlRow(c, true)).join('')}
      </div>`;
    }

    if (fsCtrls.length > 0) {
      html += `<h3 class="sub-heading">Framework Self-Certifications</h3>
      <div class="ctrl-group ctrl-group--fs">
        ${fsCtrls.map(c => `
        <div class="ctrl-row ctrl-row--fs">
          <span class="ctrl-status ctrl-status--fs">✓ Self-certified</span>
          <span class="ctrl-id mono">${_esc(c.control_id)}</span>
          <span class="ctrl-name">${_esc(c.control_name)}</span>
          ${c.fk_Harmonised_Standard_IDs ? `<span class="ctrl-ref mono">${_esc(c.fk_Harmonised_Standard_IDs)}</span>` : ''}
        </div>`).join('')}
      </div>`;
    }

    return html;
  }

  function _ctrlRow(c, selected) {
    const src = (c.control_source || '').toLowerCase();
    const srcLabel = src.includes('framework') ? 'Framework' : 'EU AI Act';
    const srcClass = src.includes('framework') ? 'src-fs' : 'src-eu';
    return `<div class="ctrl-row ${selected ? '' : 'ctrl-row--dim'}">
      <span class="ctrl-status ctrl-status--${selected ? 'sel' : 'desel'}">${selected ? '✓' : '✗'}</span>
      <span class="ctrl-src ${srcClass}">${srcLabel}</span>
      <span class="ctrl-id mono">${_esc(c.control_id)}</span>
      <span class="ctrl-name">${_esc(c.control_name || '—')}</span>
      ${c.fk_Harmonised_Standard_IDs ? `<span class="ctrl-ref mono">${_esc(c.fk_Harmonised_Standard_IDs)}</span>` : ''}
    </div>`;
  }

  // ---- Section 4: Compliance Traceability --------------------
  function _complianceTraceabilitySection(s3, s9) {
    if (!s3 || !s9) return _notComplete('Steps 3 and 9 must be completed before compliance traceability can be generated.');

    const applicableNums = new Set(
      (s3.axis_b?.applicable_articles || []).map(a => a.article_number)
    );
    if (applicableNums.size === 0) return '<p class="empty-note">No articles applicable — classification returned no EU AI Act obligations.</p>';

    const selectedCtrlIds = new Set([
      ...(s9.risk_controls || []).filter(c => c.selected).map(c => c.control_id),
      ...(s9.compliance_additions || []).map(c => c.control_id)
    ]);

    // Build article number → ART-xxx lookup
    const artByNum = new Map();
    (_tbl.articles || []).forEach(a => {
      const m = a.article_name.match(/^(Article \d+[a-zA-Z]*)/);
      if (m) artByNum.set(m[1], a);
    });

    // Build standard_ref → controls lookup
    const ctrlsByRef = new Map();
    (_tbl.riskControls || []).forEach(rc => {
      if (!rc.fk_Harmonised_Standard_IDs) return;
      rc.fk_Harmonised_Standard_IDs.split(',').map(s => s.trim()).filter(Boolean).forEach(ref => {
        if (!ctrlsByRef.has(ref)) ctrlsByRef.set(ref, []);
        ctrlsByRef.get(ref).push(rc);
      });
    });

    // Build risk → test plan lookup
    const tpByRisk = new Map((_tbl.testPlans || []).map(tp => [tp.fk_Risk_ID, tp]));

    let html = '';
    let gapCount = 0;
    let coveredCount = 0;

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
        hsReqs.forEach(h => {
          const ctrls = (ctrlsByRef.get(h.standard_ref) || [])
            .filter((c, i, a) => a.findIndex(x => x.pk_Risk_Control_ID === c.pk_Risk_Control_ID) === i);
          const fsCtrls   = ctrls.filter(c => c.control_source === 'Framework_Statement');
          const selCtrls  = ctrls.filter(c => selectedCtrlIds.has(c.pk_Risk_Control_ID) && c.control_source !== 'Framework_Statement');
          const covered   = selCtrls.length > 0 || fsCtrls.length > 0;

          if (covered) coveredCount++; else gapCount++;

          // Find test plan for any selected control under this HS
          let testRef = null;
          for (const c of selCtrls) {
            const tp = tpByRisk.get(c.fk_Risk_ID);
            if (tp) { testRef = tp.test_plan_ref; break; }
          }

          html += `<div class="trace-hs ${covered ? '' : 'trace-hs--gap'}">
            <div class="trace-hs-row">
              <span class="trace-hs-ref mono">${_esc(h.standard_ref)}</span>
              <span class="trace-hs-name">${_esc(h.standard_name || '')}</span>
              <span class="trace-cov-badge trace-cov-badge--${covered ? (fsCtrls.length > 0 && selCtrls.length === 0 ? 'fs' : 'ok') : 'gap'}">
                ${covered ? (fsCtrls.length > 0 && selCtrls.length === 0 ? '✓ Self-certified' : '✓ Covered') : '⚠ Gap'}
              </span>
            </div>`;

          if (selCtrls.length > 0) {
            html += `<div class="trace-ctrl-list">
              ${selCtrls.map(c => `<span class="trace-ctrl-chip">${_esc(c.pk_Risk_Control_ID)}</span>`).join('')}
              ${testRef ? `<span class="trace-test-chip">🧪 ${_esc(testRef)}</span>` : ''}
            </div>`;
          }
          if (fsCtrls.length > 0 && selCtrls.length === 0) {
            html += `<div class="trace-ctrl-list">
              ${fsCtrls.map(c => `<span class="trace-ctrl-chip trace-ctrl-chip--fs">${_esc(c.pk_Risk_Control_ID)}</span>`).join('')}
            </div>`;
          }

          html += `</div>`;
        });
      }
      html += `</div>`;
    });

    const summaryClass = gapCount === 0 ? 'trace-summary--ok' : 'trace-summary--warn';
    const summaryText  = gapCount === 0
      ? `✓ All ${coveredCount} harmonised standard requirements are covered. No gaps identified.`
      : `⚠ ${gapCount} gap${gapCount !== 1 ? 's' : ''} identified across ${coveredCount + gapCount} HS requirements. Gaps must be resolved before conformity sign-off.`;

    return `<div class="trace-summary ${summaryClass}">${summaryText}</div>` + html;
  }

  // ---- Section 5: Verification Evidence ----------------------
  function _verificationSection(s10) {
    if (!s10) return _notComplete('Step 10 — Content Verification Testing has not yet been completed.');

    const plans    = s10.plans || [];
    const uncov    = s10.uncovered_controls || [];
    const total    = s10.total_tests ?? 0;
    const done     = s10.completed_tests ?? 0;
    const na       = s10.not_applicable_tests ?? 0;
    const pending  = s10.pending_tests ?? 0;

    let html = `<p class="section-meta">
      Assessment date: ${s10.assessment_date || '—'} &nbsp;|&nbsp;
      ${done} completed · ${na} not applicable · ${pending} pending (${total} total)
    </p>`;

    const pct = total > 0 ? Math.round((done + na) / total * 100) : 0;
    html += `<div class="test-progress-bar">
      <div class="test-progress-fill" style="width:${pct}%"></div>
    </div>
    <p class="test-progress-lbl">${pct}% of tests resolved</p>`;

    if (plans.length === 0) {
      html += _notComplete('No test plans generated. Ensure Step 9 control selection is complete.');
    } else {
      plans.forEach(p => {
        html += `<div class="test-plan">
          <div class="test-plan-hdr">
            <span class="test-plan-ref mono">${_esc(p.plan_ref)}</span>
            <span class="test-plan-name">${_esc(p.plan_name)}</span>
          </div>
          <p class="test-plan-risk">Risk: ${_esc(p.risk_name)}</p>
          <table class="data-table">
            <thead><tr><th>Test Control</th><th>Name</th><th>Standards</th><th>Status</th></tr></thead>
            <tbody>
            ${(p.test_controls || []).map(tc => `<tr>
              <td class="mono">${_esc(tc.control_ref || tc.test_control_id)}</td>
              <td>${_esc(tc.control_name)}</td>
              <td class="mono small">${_esc(tc.fk_Harmonised_Standard_IDs || '—')}</td>
              <td><span class="status-pill status-pill--${_testStatusKey(tc.status)}">${_testStatusLabel(tc.status)}</span></td>
            </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      });
    }

    if (uncov.length > 0) {
      html += `<h3 class="sub-heading">Controls Without Automated Test Coverage (${uncov.length})</h3>
        <p class="section-meta">Manual evidence review required for the following controls.</p>
        <table class="data-table">
          <thead><tr><th>Control ID</th><th>Name</th><th>Source</th></tr></thead>
          <tbody>
          ${uncov.map(c => `<tr>
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
    const riskCtrlSel = (s9?.risk_controls || []).filter(c => c.selected).length;
    const compAdds    = (s9?.compliance_additions || []).length;
    const doneTests   = s10?.completed_tests ?? '—';
    const naTests     = s10?.not_applicable_tests ?? '—';
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
      <td>Compliance Traceability section — all applicable HS requirements must show ✓ Covered</td>
      <td><span class="status-pill status-pill--${allDone ? 'accept' : 'pend'}">${allDone ? '✓ See Section 4' : '○ Pending'}</span></td>
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
  <tr><td class="dt-label">Controls Selected (Risk Team)</td><td>${riskCtrlSel}</td></tr>
  <tr><td class="dt-label">Controls Added (Compliance Team)</td><td>${compAdds}</td></tr>
  <tr><td class="dt-label">Tests Completed</td><td>${doneTests}</td></tr>
  <tr><td class="dt-label">Tests Not Applicable</td><td>${naTests}</td></tr>
  <tr><td class="dt-label">Tests Pending</td><td>${pendTests}</td></tr>
  <tr><td class="dt-label">Report Generated</td><td>${today}</td></tr>
</table>

${!noPendingTests && s10 ? `<div class="warn-banner">⚠ ${pendTests} test${pendTests !== 1 ? 's' : ''} remain pending. All tests must be resolved (completed or marked not applicable) before this report can be used as the conformity assessment submission.</div>` : ''}

<h3 class="sub-heading">Declaration of Conformity</h3>
<div class="declaration-block">
  <p>The undersigned confirms that the AI system identified above has been assessed against the applicable
  requirements of Regulation (EU) 2024/1689 (EU AI Act) in accordance with the organisation's AI governance
  workflow. This assessment covers system classification, risk identification, control selection, harmonised
  standard traceability, and verification testing as documented in this report.</p>
  <p>To the best of the reviewer's knowledge, the described system complies with the applicable requirements
  identified in this assessment, subject to the outstanding items noted above.</p>
</div>

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

    // Build SR ref → steps map by inverting workflow.json requirements
    const srToSteps = new Map();
    workflow.steps.forEach(step => {
      (step.requirements || []).forEach(ref => {
        if (!srToSteps.has(ref)) srToSteps.set(ref, []);
        srToSteps.get(ref).push({ id: step.id, number: step.number, title: step.title });
      });
    });

    // Steps that have digital session records (wizard UIs)
    const TRACKED = new Set(['step-3', 'step-7', 'step-8', 'step-9', 'step-10']);
    const STEP_COMPLETE = {
      'step-3':  !!_record?.['step-3'],
      'step-7':  !!_record?.['step-7'],
      'step-8':  !!_record?.['step-8']?.legal_assessment?.completed,
      'step-9':  !!_record?.['step-9'],
      'step-10': !!_record?.['step-10']
    };

    // Overall status counts for the summary banner
    let evidenced = 0, partial = 0, pending = 0;

    const rows = srControls.map(ctrl => {
      const steps = srToSteps.get(ctrl.groupstandard_ref) || [];
      const tracked = steps.filter(s => TRACKED.has(s.id));
      const completedTracked = tracked.filter(s => STEP_COMPLETE[s.id]);

      let status, statusClass;
      if (tracked.length === 0) {
        status = '— Manual evidence'; statusClass = 'manual';
      } else if (completedTracked.length === tracked.length) {
        status = '✓ Evidenced'; statusClass = 'ok'; evidenced++;
      } else if (completedTracked.length > 0) {
        status = '◑ Partial'; statusClass = 'partial'; partial++;
      } else {
        status = '○ Pending'; statusClass = 'pend'; pending++;
      }

      const stepRows = steps.map(s => {
        const isTracked  = TRACKED.has(s.id);
        const isComplete = isTracked ? STEP_COMPLETE[s.id] : null;
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

    const totalTracked = srControls.filter(c => {
      const steps = srToSteps.get(c.groupstandard_ref) || [];
      return steps.some(s => TRACKED.has(s.id));
    }).length;

    const summaryClass = partial + pending === 0 ? 'trace-summary--ok' : 'trace-summary--warn';
    const summaryText = partial + pending === 0
      ? `✓ All ${evidenced} trackable controls are fully evidenced by digital workflow records.`
      : `${evidenced} of ${totalTracked} trackable controls evidenced · ${partial} partial · ${pending} pending. Controls without tracked steps require manual artefact submission.`;

    return `
<p class="section-meta">
  Risk Title: Flawed Deployment and Governance of Artificial Intelligence Tools &nbsp;|&nbsp;
  ${srControls.length} controls &nbsp;|&nbsp; evidenced from workflow.json requirements mapping
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

  function _testStatusKey(status) {
    if (status === 'completed')      return 'accept';
    if (status === 'not_applicable') return 'na';
    return 'pend';
  }

  function _testStatusLabel(status) {
    if (status === 'completed')      return '✓ Completed';
    if (status === 'not_applicable') return '— N/A';
    return '○ Pending';
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
.reason-cell{font-size:9pt;color:#555;max-width:280px}

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
.trace-hs--gap{background:#fff7ed}
.trace-hs-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.trace-hs-ref{font-size:8.5pt;color:#555;flex-shrink:0}
.trace-hs-name{flex:1;font-size:9pt}
.trace-cov-badge{font-size:8.5pt;font-weight:700;padding:1px 6px;border-radius:3px;flex-shrink:0}
.trace-cov-badge--ok{background:#d1fae5;color:#065f46}
.trace-cov-badge--fs{background:#ede9fe;color:#7c3aed}
.trace-cov-badge--gap{background:#fee2e2;color:#991b1b}
.trace-ctrl-list{display:flex;gap:4px;flex-wrap:wrap;padding-top:4px}
.trace-ctrl-chip{font-size:8pt;padding:1px 5px;border-radius:3px;background:#e0e7ff;color:#3730a3;font-family:monospace}
.trace-ctrl-chip--fs{background:#ede9fe;color:#7c3aed}
.trace-test-chip{font-size:8pt;padding:1px 5px;border-radius:3px;background:#f0fdf4;color:#166534}

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
.sig-table{width:100%;border-collapse:collapse;margin-top:32px}
.sig-cell{padding:8px 16px 0 0;vertical-align:bottom;width:33%}
.sig-line{border-bottom:1px solid #333;height:40px;margin-bottom:4px}
.sig-label{font-size:8.5pt;color:#555;font-weight:600}

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
`;
  }

  // ---- Wrapper UI styles (outside the report iframe) ----------
  function _injectStyles() {
    if (document.getElementById('rpt-shell-styles')) return;
    const s = document.createElement('style');
    s.id = 'rpt-shell-styles';
    s.textContent = `
.rpt-shell{display:flex;flex-direction:column;height:100%;min-height:0}
.rpt-action-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--color-border,#e5e7eb);background:var(--color-bg,#fff);flex-shrink:0}
.rpt-bar-title{font-size:14px;font-weight:600;color:var(--color-text,#111)}
.rpt-print-btn{display:flex;align-items:center;gap:7px;padding:8px 18px;background:#0d9488;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer}
.rpt-print-btn:hover{background:#0f766e}
.rpt-iframe{flex:1;border:none;background:#fff;width:100%}
`;
    document.head.appendChild(s);
  }

  // ---- Utility ------------------------------------------------
  // (no _el needed — UI is minimal; DOM helpers only for the action bar already inline)

})();
