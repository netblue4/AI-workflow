/* About the Framework — a permanent reference page.
   Explains how the EU AI Act, harmonised standards (HS), risks, tests, the
   internal AI Acceptable Use Standard (SR) and framework statements fit
   together, then embeds the live Framework Mapping reference grid.
   Mounts into #detail-panel via selectAbout() in index.html. */
(function () {
  'use strict';

  const el = (tag, cls, props) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (props) Object.assign(e, props);
    return e;
  };

  window.mountAboutFramework = function (container) {
    _injectStyles();
    container.innerHTML = '';
    const shell = el('div', 'abt-shell');

    // ---- Header ----
    const hdr = el('div', 'abt-hdr');
    hdr.appendChild(el('p', 'abt-eyebrow', { textContent: 'Training & reference' }));
    hdr.appendChild(el('h1', 'abt-title', { textContent: 'About the framework' }));
    hdr.appendChild(el('p', 'abt-lede', {
      textContent: 'The methodology behind each step, in one place — how we classify a system, run a DPIA, identify risks, and calculate residual risk. Use it to understand the framework, and to change it.'
    }));
    shell.appendChild(hdr);

    // ---- Training tabs: the methodology behind each step ----
    const TABS = [
      ['about',    'About the framework'],
      ['classify', 'How do we classify the system'],
      ['dpia',     'How do we perform a DPIA'],
      ['risks',    'How do we identify risks'],
      ['residual', 'How do we calculate residual risk'],
      ['report',   "What's in the AI System Conformity Assessment Report"],
    ];
    const paneWrap = el('div', 'abt-tab-panes');
    const panes = {}; const loaded = {};
    TABS.forEach(([id], i) => {
      const p = el('div', 'abt-tab-pane' + (i ? ' abt-tab-pane--hidden' : ''));
      p.dataset.pane = id; panes[id] = p; paneWrap.appendChild(p);
    });
    const strip = WizUtils.buildTabStrip(TABS, switchTo);
    shell.appendChild(strip);
    shell.appendChild(paneWrap);
    container.appendChild(shell);

    // The About pane is built immediately; training panes lazy-load on first view.
    panes.about.appendChild(_buildAboutPane());
    loaded.about = true;
    _loadCounts();

    function switchTo(id) {
      strip.querySelectorAll('.wiz-tab').forEach(t => t.classList.toggle('wiz-tab--active', t.dataset.tab === id));
      Object.entries(panes).forEach(([k, p]) => p.classList.toggle('abt-tab-pane--hidden', k !== id));
      if (!loaded[id]) { loaded[id] = true; _fillTrainingPane(id, panes[id]); }
    }
  };

  // ---- Tab 1: About the framework (the overview) ----
  function _buildAboutPane() {
    const wrap = el('div', '');
    wrap.appendChild(_sectionTitle('How it fits together'));
    wrap.appendChild(_flowDiagram());

    wrap.appendChild(_buildStandardsBasis());

    wrap.appendChild(_sectionTitle('The building blocks'));
    const blocks = el('div', 'abt-cards');
    wrap.appendChild(blocks);
    _blocksHost = blocks; // filled with live counts once tables load

    wrap.appendChild(_sectionTitle('How a requirement is evidenced'));
    wrap.appendChild(el('p', 'abt-body', { textContent: 'Each HS requirement is satisfied by exactly one of five routes. This is what turns "we wrote a policy" into defensible, auditable conformity.' }));
    wrap.appendChild(_evidenceLegend());

    wrap.appendChild(_sectionTitle('Live framework reference'));
    wrap.appendChild(el('p', 'abt-body', { textContent: 'Every requirement in one grid: the EU AI Act article, the risk that threatens it, the harmonised standard and requirement that treat it, the verification that proves it, and the internal-standard clause that maps to it.' }));
    const gridHost = el('div', 'abt-grid-host');
    if (typeof createFrameworkMapping === 'function') {
      gridHost.appendChild(createFrameworkMapping(null, null, null));
    } else {
      gridHost.appendChild(el('p', 'abt-body', { textContent: 'Framework grid unavailable.' }));
    }
    wrap.appendChild(gridHost);

    const close = el('div', 'abt-note');
    close.innerHTML = '<strong>Presumption of conformity.</strong> When these harmonised standards are cited in the Official Journal of the EU, the same evidence chain shown here becomes the basis for a presumption of conformity under Article 40 — no re-assessment required.';
    wrap.appendChild(close);
    return wrap;
  }

  // ---- Standards basis: how the steps map to ISO/IEC 42001 ----
  function _buildStandardsBasis() {
    const wrap = el('div', '');
    wrap.appendChild(_sectionTitle('Standards basis'));
    wrap.appendChild(el('p', 'abt-body', { textContent: 'The workflow implements an ISO/IEC 42001-aligned AI management-system lifecycle. Each step maps to a clause of ISO/IEC 42001; the classification and DPIA criteria come from EU law, not any internal standard.' }));
    const rows = [
      ['1 — Training prerequisite', '7.2 Competence · 7.3 Awareness', '—'],
      ['2 — Business case', '8.1 Operational planning · A.6 lifecycle', '—'],
      ['3 — System classification', '6.1 Planning · A.5 impact assessment', 'EU AI Act'],
      ['4 — Data identification & DPIA', '6.1.4 / 8.4 impact assessment · A.7 data', 'GDPR Art. 35'],
      ['5 — Risk identification', '6.1.2 / 8.2 AI risk assessment', 'ISO 31000 · ISO/IEC 23894'],
      ['6 — Control identification', '6.1.3 / 8.3 AI risk treatment · Annex A', 'ISO/IEC harmonised standards'],
      ['7 — Residual risk', '6.1.3 residual-risk acceptance', '—'],
      ['8 — AI Change Board approval', 'Clause 5 Leadership · 8.1 control', '—'],
      ['10 — User obligations briefing', '7.3 Awareness · A.9 responsible use', '—'],
      ['11 — Central inventory & records', '7.5 Documented information · A.6', '—'],
      ['12 — Periodic & triggered review', '9.1 Monitoring · 9.3 Review · 10 Improvement', '—'],
    ];
    const scroll = el('div', 'abt-std-scroll');
    const table = document.createElement('table');
    table.className = 'abt-std-table';
    table.innerHTML =
      '<thead><tr><th>Workflow step</th><th>Reflects ISO/IEC 42001</th><th>Criteria from</th></tr></thead>' +
      '<tbody>' + rows.map(([a, b, c]) =>
        `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('') + '</tbody>';
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    const note = el('div', 'abt-note');
    note.innerHTML = '<strong>In one line.</strong> An ISO/IEC 42001-aligned lifecycle — impact assessment (GDPR Art. 35 DPIA), risk assessment and treatment (ISO 31000 / ISO/IEC 23894), and monitoring — with classification driven by the EU AI Act.';
    wrap.appendChild(note);
    return wrap;
  }

  // ---- Tabs 2–4: step methodology (reference panes moved out of the steps) ----
  const _TRAINING = {
    classify: { builder: 'buildStep3Reference', title: 'How do we classify the system',
      body: 'Step 3 places every system on two axes: an internal governance tier and the EU AI Act risk tier. The methodology below is exactly what the step applies — the tiers, the gate questions (G1–G5), and the combined-outcome matrix that turns the two axes into a single classification.' },
    dpia: { builder: 'buildStep4Reference', title: 'How do we perform a DPIA',
      body: 'Step 4 runs a GDPR Article 35 Data Protection Impact Assessment whenever personal data is involved. The reference below sets out the legal obligations and the sections the assessment must cover.' },
    risks: { builder: 'buildStep5Reference', title: 'How do we identify risks',
      body: 'Step 5 assesses the system against the risk catalogue, keeping only the risks relevant to its classification and data. The reference below is the full catalogue, grouped by article and standard, with the guidance used to judge relevance.' },
  };

  function _fillTrainingPane(id, pane) {
    if (id === 'residual') { pane.appendChild(_buildResidualPane()); return; }
    if (id === 'report')   { pane.appendChild(_buildReportGuidePane()); return; }
    const cfg = _TRAINING[id];
    pane.appendChild(_sectionTitle(cfg.title));
    pane.appendChild(el('p', 'abt-body', { textContent: cfg.body }));
    const host = el('div', 'abt-ref-host');
    host.appendChild(el('p', 'abt-body', { textContent: 'Loading…' }));
    pane.appendChild(host);
    const fn = window[cfg.builder];
    Promise.resolve(fn ? fn() : null)
      .then(node => { host.innerHTML = ''; host.appendChild(node || el('p', 'abt-body', { textContent: 'Reference unavailable.' })); })
      .catch(() => { host.innerHTML = ''; host.appendChild(el('p', 'abt-body', { textContent: 'Reference unavailable.' })); });
  }

  // ---- Tab 5: residual-risk methodology (new content) ----
  function _buildResidualPane() {
    const wrap = el('div', '');
    wrap.appendChild(_sectionTitle('How do we calculate residual risk'));
    wrap.appendChild(el('p', 'abt-body', { textContent: 'Residual risk is what remains once controls are in place and proven. Step 7 records it per risk — but only after that risk’s controls have been evidenced or explicitly waived. You cannot record residual risk for a risk whose controls are still unproven.' }));

    wrap.appendChild(_sectionTitle('The three stages'));
    wrap.appendChild(_orderedFlow([
      ['Activate the controls', 'For each risk, confirm every operational control is live in the deployed system. The developer’s evidence — a Jira ticket, pull request, or configuration link — is attached to each control.'],
      ['Test the controls', 'For each control verified by a test, record the test result and attach the evidence that proves it passed. Framework self-certifications are pre-filled from Step 6 as the evidence.'],
      ['Record the residual', 'Once a risk’s controls are all evidenced or waived, its residual assessment unlocks. Rate the likelihood and impact that remain, and record a justification.'],
    ]));

    wrap.appendChild(_sectionTitle('Marking a control and capturing evidence'));
    wrap.appendChild(_bullets([
      ['Evidence provided', 'The control is live or tested and its evidence pointer (ticket, document, or test report) is recorded. This counts the control as proven.'],
      ['Waived', 'The control does not apply to this system, with a recorded justification. A waived control counts as resolved but is flagged in the report.'],
      ['Not started / In progress', 'No evidence yet. The risk’s residual assessment stays locked until every control is Evidence provided or Waived.'],
    ]));

    wrap.appendChild(_sectionTitle('Recording residual risk'));
    wrap.appendChild(el('p', 'abt-body', { textContent: 'With the controls proven, residual risk is the exposure that remains despite them. For each risk, record:' }));
    wrap.appendChild(_bullets([
      ['Likelihood', 'How likely the risk is to occur with the controls operating.'],
      ['Impact', 'The severity if it did occur.'],
      ['Residual level', 'Derived from likelihood and impact — the remaining exposure after treatment.'],
      ['Justification', 'Why this level is acceptable, referencing the controls now in place.'],
    ]));
    const note = el('div', 'abt-note');
    note.innerHTML = '<strong>Why the gate matters.</strong> Requiring controls to be evidenced before residual risk is recorded means the residual rating always reflects controls that actually exist and have been proven — not controls that are merely planned.';
    wrap.appendChild(note);
    return wrap;
  }

  function _orderedFlow(items) {
    const ol = el('ol', 'abt-steps');
    items.forEach(([t, d]) => {
      const li = el('li', 'abt-step');
      li.appendChild(el('span', 'abt-step-t', { textContent: t }));
      li.appendChild(el('span', 'abt-step-d', { textContent: d }));
      ol.appendChild(li);
    });
    return ol;
  }

  function _bullets(items) {
    const ul = el('ul', 'abt-deflist');
    items.forEach(([t, d]) => {
      const li = el('li', 'abt-def');
      li.appendChild(el('span', 'abt-def-t', { textContent: t }));
      li.appendChild(el('span', 'abt-def-d', { textContent: d }));
      ul.appendChild(li);
    });
    return ul;
  }

  let _blocksHost = null;

  function _sectionTitle(text) {
    const s = el('div', 'abt-sec-title');
    s.appendChild(el('span', 'abt-sec-bar'));
    s.appendChild(el('h2', '', { textContent: text }));
    return s;
  }

  // Flow infographic: the framework read left to right as a single chain.
  function _flowDiagram() {
    const flow = el('div', 'abt-flow');
    const nodes = [
      ['act',  'AI Act Article',         'sets the objective'],
      ['risk', 'Risk',                   'threatens the objective'],
      ['hs',   'Harmonised Requirement', 'treats the risk'],
      ['ev',   'Evidence',               'proves it is treated'],
    ];
    nodes.forEach(([cls, title, sub], i) => {
      const node = el('div', 'abt-flow-node abt-flow-node--' + cls);
      node.appendChild(el('span', 'abt-flow-title', { textContent: title }));
      node.appendChild(el('span', 'abt-flow-sub', { textContent: sub }));
      flow.appendChild(node);
      if (i < nodes.length - 1) flow.appendChild(el('span', 'abt-flow-arrow', { textContent: '→' }));
    });
    return flow;
  }

  const EVIDENCE = [
    ['test',     'Test',                'A test control proves the requirement operates as expected.'],
    ['doc',      'Document',            'An external artefact evidences it — QMS, technical file, instructions.'],
    ['workflow', 'Workflow',            'The workflow’s own output is the evidence — the report, DPIA, risk steps.'],
    ['fs',       'Framework Statement', 'The governance workflow self-certifies the requirement (FS-*).'],
    ['na',       'Not Applicable',      'Out of scope for this system type, with a recorded justification.'],
  ];
  function _evidenceLegend() {
    const wrap = el('div', 'abt-ev');
    EVIDENCE.forEach(([k, name, desc]) => {
      const row = el('div', 'abt-ev-row');
      row.appendChild(el('span', 'abt-chip abt-chip--' + k, { textContent: name }));
      row.appendChild(el('span', 'abt-ev-desc', { textContent: desc }));
      wrap.appendChild(row);
    });
    return wrap;
  }


  // ---- Report guide: what's in the AI System Conformity Assessment Report ----
  // Plain-language mirror of the Step 8 report's structure. KEEP IN SYNC with the
  // section list/order in report-wizard.js → _buildReportHTML(): if a section is
  // renamed, reordered, added or removed there, update _REPORT_PART_A /
  // _REPORT_PART_B below so this reference tab doesn't drift from the real report.
  const _REPORT_PART_A = [
    ['Cover / Identification', "The front page. It names the AI system being assessed, gives it a reference number and date, says who carried out the assessment, and sums up the headline result, so anyone picking it up immediately knows what they're looking at."],
    ['1. System Classification', "The law treats different AI uses very differently. A few are banned outright, some are tightly regulated, most are low-risk. This section shows which category the system falls into and why, including how risky it is and whether the organisation is building the AI or just using someone else's. That classification drives which rules apply for the rest of the report."],
    ['2. Risk Identification', "You can't manage a danger you haven't named. This lists the specific things that could go wrong with this system, for example biased decisions, confidently wrong answers, or misuse of people's personal data, and who is responsible for each. They're drawn from a ready-made library of known AI risks rather than guessed at on the day."],
    ['3. Compliance & Control Traceability', "The heart of the report, and the part that proves nothing was missed. For each rule the system must follow, it shows the specific safeguard put in place to meet it, and marks whether that safeguard is done, still outstanding, or genuinely not needed. Below it, a register lists the actual safeguards in place, grouped by the risk they address, with their current status. Anything left uncovered shows up here as a gap."],
    ['4. Verification Evidence', "Saying a safeguard exists isn't the same as proving it works. This shows the tests run against each safeguard and whether they passed, so the reader can see the controls were actually checked, not just written down."],
    ['5. Conformity Assessment Conclusion', "This shows the assessor's conclusion: based on everything above, the system meets the rules it has to meet. It includes a short checklist confirming the assessment is complete, and is signed by the assessor. This is the recommendation passed to the decision-makers, it is not yet the final approval."],
    ['— handover —', "A short note marking that the evidence (Part A) is finished and is now going to the internal decision-makers for a verdict."],
  ];
  const _REPORT_PART_B = [
    ['Change Board Sign-off Summary', "The decision-makers need the bottom line, not the whole file. This is a single-page dashboard, a red/amber/green rating, how much of the work is complete, and how much risk is left over, so they can see at a glance whether it's safe to approve."],
    ['6. Outstanding Items', "Approval often comes with strings attached. This is a plain list of anything still unfinished, so the board knows exactly what must be fixed before, or as a condition of, saying yes."],
    ['7. Internal Standard Compliance', "Most organisations hold themselves to a higher bar than the legal minimum. This shows whether the system also meets the company's own internal AI rules, including checks the team has confirmed for themselves."],
    ['8. AI Change Board Decision', "The board's formal verdict: approve, reject, or approve with conditions. Approving it clears the system to go live and triggers the official legal declaration that it complies."],
  ];

  function _reportSubhead(title, aud) {
    const h = el('p', 'abt-rep-sub');
    h.appendChild(document.createTextNode(title + '  '));
    const s = el('span', ''); s.textContent = '· ' + aud;
    h.appendChild(s);
    return h;
  }

  function _reportTable(rows) {
    const scroll = el('div', 'abt-std-scroll');
    const table = document.createElement('table');
    table.className = 'abt-rep-table';
    table.innerHTML = '<thead><tr><th>Section</th><th>What it shows</th></tr></thead>';
    const tbody = document.createElement('tbody');
    rows.forEach(([sec, desc]) => {
      const tr = document.createElement('tr');
      const c1 = document.createElement('td'); c1.textContent = sec;
      const c2 = document.createElement('td'); c2.textContent = desc;
      tr.append(c1, c2); tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    return scroll;
  }

  function _buildReportGuidePane() {
    const wrap = el('div', '');
    wrap.appendChild(_sectionTitle("What's in the AI System Conformity Assessment Report"));
    wrap.appendChild(el('p', 'abt-body', { textContent: "The report is a single assessment split into two parts. Part A is the evidence that the system follows the rules — the part you could hand to a regulator. Part B is the internal record of the go-ahead decision made off the back of that evidence. Part A is completed first; Part B depends on it." }));
    wrap.appendChild(_reportSubhead('Part A — the conformity evidence', 'for the regulator'));
    wrap.appendChild(_reportTable(_REPORT_PART_A));
    wrap.appendChild(_reportSubhead('Part B — the internal decision', 'for the AI Change Board, the internal approvers'));
    wrap.appendChild(_reportTable(_REPORT_PART_B));
    return wrap;
  }

  // Live counts from the data tables.
  function _loadCounts() {
    const splitRefs = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
    Promise.all([
      fetch('tbl_Harmonised_Standards.json').then(r => r.json()).catch(() => []),
      fetch('tbl_Risks.json').then(r => r.json()).catch(() => []),
      fetch('tbl_Test_Controls.json').then(r => r.json()).catch(() => []),
      fetch('tbl_AI_SR_Controls.json').then(r => r.json()).catch(() => []),
      fetch('tbl_Risk_Controls.json').then(r => r.json()).catch(() => []),
    ]).then(([hs, risks, tc, sr, rc]) => {
      const arts = (window.WizUtils && WizUtils.ARTICLES) || [];
      const byType = {};
      hs.forEach(h => { const t = h.coverage_type || 'Test'; byType[t] = (byType[t] || 0) + 1; });
      const fs = rc.filter(c => c.control_source === 'Framework_Statement');
      // Ordered to match the chain: article → risk → requirement → evidence.
      const cards = [
        ['16', arts.length || 16, 'AI Act Articles', 'Set the objectives', 'act'],
        [null, risks.length, 'Risks', 'Threaten the article objectives', 'risk'],
        [null, hs.length, 'HS requirements', `Treat the risks · Test ${byType.Test || 0} · Doc ${byType.Document || 0} · Workflow ${byType.Workflow || 0} · N/A ${byType.Not_Applicable || 0}`, 'hs'],
        [null, tc.length, 'Test controls', 'Prove HS requirements operate', 'test'],
        [null, sr.length, 'Internal Std (SR)', 'AI Acceptable Use Standard clauses', 'sr'],
        [null, fs.length, 'Framework Statements', 'Workflow governance self-certifications', 'fs'],
      ];
      if (!_blocksHost) return;
      _blocksHost.innerHTML = '';
      cards.forEach(([, n, label, sub, cls]) => {
        const c = el('div', 'abt-card abt-card--' + cls);
        c.appendChild(el('span', 'abt-card-num', { textContent: String(n) }));
        c.appendChild(el('span', 'abt-card-label', { textContent: label }));
        c.appendChild(el('span', 'abt-card-sub', { textContent: sub }));
        _blocksHost.appendChild(c);
      });
    });
  }

  function _injectStyles() {
    if (document.getElementById('abt-styles')) return;
    const s = document.createElement('style');
    s.id = 'abt-styles';
    s.textContent = `
    .abt-shell{max-width:1180px;margin:0 auto;padding:32px 36px 72px;color:var(--color-text-primary);font-family:var(--font-body)}
    .abt-hdr{margin-bottom:32px}
    .abt-eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#5ec8c0;font-weight:600;margin:0 0 10px}
    .abt-title{font-size:34px;font-weight:600;letter-spacing:-.01em;margin:0 0 12px}
    .abt-lede{font-size:16px;line-height:1.6;color:var(--color-text-secondary);max-width:70ch;margin:0}
    .abt-sec-title{display:flex;align-items:center;gap:10px;margin:38px 0 14px}
    .abt-sec-bar{width:4px;height:18px;border-radius:2px;background:#c9a24a}
    .abt-sec-title h2{font-size:19px;font-weight:600;margin:0}
    .abt-body{font-size:14.5px;line-height:1.65;color:var(--color-text-secondary);max-width:78ch;margin:0 0 14px}
    .abt-body strong{color:var(--color-text-primary)}
    /* training tabs */
    .abt-shell .wiz-tab-strip{margin:18px 0 0;padding:0;border-bottom:1px solid var(--color-border);flex-wrap:wrap;background:none}
    .abt-tab-panes{margin-top:4px}
    .abt-tab-pane--hidden{display:none}
    /* standards-basis table */
    .abt-std-scroll{overflow-x:auto;margin:8px 0 12px;max-width:96ch}
    .abt-std-table{width:100%;border-collapse:collapse;font-size:13px}
    .abt-std-table th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b8963e;padding:8px 12px;border-bottom:2px solid var(--color-border);white-space:nowrap}
    .abt-std-table td{padding:9px 12px;border-bottom:1px solid var(--color-border);color:var(--color-text-secondary);vertical-align:top;line-height:1.5}
    .abt-std-table td:first-child{color:var(--color-text-primary);font-weight:500;white-space:nowrap}
    .abt-std-table tr:hover td{background:var(--color-surface)}
    /* report-guide table */
    .abt-rep-sub{font-size:14px;font-weight:700;color:var(--color-text-primary);margin:24px 0 2px}
    .abt-rep-sub span{font-weight:500;color:var(--color-text-tertiary);font-size:12px}
    .abt-rep-table{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 4px}
    .abt-rep-table th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b8963e;padding:8px 12px;border-bottom:2px solid var(--color-border)}
    .abt-rep-table td{padding:10px 12px;border-bottom:1px solid var(--color-border);color:var(--color-text-secondary);vertical-align:top;line-height:1.55}
    .abt-rep-table td:first-child{color:var(--color-text-primary);font-weight:600;width:28%;min-width:150px}
    .abt-rep-table tr:hover td{background:var(--color-surface)}
    .abt-ref-host{margin-top:4px}
    /* numbered stages */
    .abt-steps{list-style:none;counter-reset:s;padding:0;margin:8px 0 10px;display:flex;flex-direction:column;gap:10px;max-width:82ch}
    .abt-step{counter-increment:s;position:relative;padding:12px 16px 12px 48px;background:var(--color-surface);border:1px solid var(--color-border);border-left:3px solid #8fd6a8;border-radius:var(--radius-lg)}
    .abt-step::before{content:counter(s);position:absolute;left:14px;top:12px;width:22px;height:22px;border-radius:50%;background:rgba(52,199,120,.18);color:#8cebb0;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
    .abt-step-t{display:block;font-size:14px;font-weight:700;color:var(--color-text-primary);margin-bottom:3px}
    .abt-step-d{display:block;font-size:13px;color:var(--color-text-secondary);line-height:1.55}
    /* definition list */
    .abt-deflist{list-style:none;padding:0;margin:8px 0 10px;display:flex;flex-direction:column;gap:8px;max-width:82ch}
    .abt-def{display:flex;flex-direction:column;gap:2px;padding:10px 14px;background:var(--color-bg-subtle);border:1px solid var(--color-border);border-left:3px solid var(--color-border-mid);border-radius:var(--radius-md)}
    .abt-def-t{font-size:13px;font-weight:700;color:var(--color-text-primary)}
    .abt-def-d{font-size:13px;color:var(--color-text-secondary);line-height:1.5}
    /* flow infographic */
    .abt-flow{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap;margin:10px 0 6px}
    .abt-flow-node{flex:1 1 0;min-width:150px;background:var(--color-surface);border:1px solid var(--color-border-mid);
      border-left:3px solid var(--color-border-mid);border-radius:var(--radius-lg);padding:14px 16px;display:flex;flex-direction:column;gap:5px;justify-content:center}
    .abt-flow-title{font-size:14.5px;font-weight:700;color:var(--color-text-primary);line-height:1.25}
    .abt-flow-sub{font-size:12px;color:var(--color-text-tertiary);line-height:1.35}
    .abt-flow-node--act{border-left-color:#7eb3ff}
    .abt-flow-node--risk{border-left-color:#f0a07a}
    .abt-flow-node--hs{border-left-color:#5ec8c0}
    .abt-flow-node--ev{border-left-color:#8fd6a8}
    .abt-flow-arrow{display:flex;align-items:center;justify-content:center;color:var(--color-text-tertiary);font-size:20px;flex:none}
    /* building blocks */
    .abt-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .abt-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-lg);
      padding:16px 18px;display:flex;flex-direction:column;gap:3px;position:relative;overflow:hidden}
    .abt-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--color-border-mid)}
    .abt-card--act::before{background:#7eb3ff}.abt-card--hs::before{background:#5ec8c0}
    .abt-card--risk::before{background:#f0a07a}.abt-card--test::before{background:#8fd6a8}
    .abt-card--sr::before{background:#5ec8c0}.abt-card--fs::before{background:#b79cff}
    .abt-card-num{font-size:28px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums}
    .abt-card-label{font-size:13.5px;font-weight:600;margin-top:6px}
    .abt-card-sub{font-size:11.5px;color:var(--color-text-tertiary)}
    /* evidence legend */
    .abt-ev{display:flex;flex-direction:column;gap:8px;max-width:80ch}
    .abt-ev-row{display:flex;align-items:baseline;gap:12px}
    .abt-chip{flex:none;min-width:150px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:20px;border:1px solid;text-align:center}
    .abt-chip--test{color:#8fd6a8;background:rgba(52,199,120,.12);border-color:rgba(52,199,120,.3)}
    .abt-chip--doc{color:#e0b060;background:rgba(200,140,40,.12);border-color:rgba(200,140,40,.3)}
    .abt-chip--workflow{color:#a9b4ff;background:rgba(120,130,255,.12);border-color:rgba(120,130,255,.3)}
    .abt-chip--fs{color:#b79cff;background:rgba(150,120,255,.12);border-color:rgba(150,120,255,.3)}
    .abt-chip--na{color:#9aa3b2;background:rgba(140,150,170,.1);border-color:rgba(140,150,170,.28)}
    .abt-ev-desc{font-size:13.5px;color:var(--color-text-secondary)}
    /* grid host */
    .abt-grid-host{margin-top:6px;border:1px solid var(--color-border);border-radius:var(--radius-lg);overflow:hidden;background:#141414}
    .abt-note{margin-top:28px;background:var(--color-bg-subtle);border:1px solid var(--color-border-mid);
      border-left:3px solid #c9a24a;border-radius:var(--radius-md);padding:16px 18px;font-size:13.5px;line-height:1.6;color:var(--color-text-secondary);max-width:80ch}
    .abt-note strong{color:var(--color-text-primary)}
    @media (max-width:820px){
      .abt-shell{padding:24px 18px 56px}
      .abt-flow{flex-direction:column}
      .abt-flow-arrow{transform:rotate(90deg)}
      .abt-cards{grid-template-columns:1fr 1fr}
      .abt-chip{min-width:120px}
    }`;
    document.head.appendChild(s);
  }
})();
