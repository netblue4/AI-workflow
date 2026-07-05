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
    hdr.appendChild(el('p', 'abt-eyebrow', { textContent: 'Reference' }));
    hdr.appendChild(el('h1', 'abt-title', { textContent: 'About the framework' }));
    hdr.appendChild(el('p', 'abt-lede', {
      textContent: 'How the EU AI Act, harmonised standards, risks, tests and your internal AI Acceptable Use Standard fit together — evidenced end to end by this workflow.'
    }));
    shell.appendChild(hdr);

    // ---- Section 1: two dimensions, one hub ----
    shell.appendChild(_sectionTitle('Two dimensions, one hub'));
    const intro = el('p', 'abt-body');
    intro.innerHTML = 'Everything pivots on the <strong>harmonised-standard (HS) requirement</strong> — a concrete, checkable clause. Read it <em>up</em> to the EU law, <em>across</em> to your internal standard, and <em>down</em> to the risks it addresses and the evidence that proves it.';
    shell.appendChild(intro);
    shell.appendChild(_hubDiagram());

    // ---- Section 2: the building blocks ----
    shell.appendChild(_sectionTitle('The building blocks'));
    const blocks = el('div', 'abt-cards');
    shell.appendChild(blocks);
    // filled with live counts once tables load
    _blocksHost = blocks;

    // ---- Section 3: how a requirement is evidenced ----
    shell.appendChild(_sectionTitle('How a requirement is evidenced'));
    const ev = el('p', 'abt-body');
    ev.textContent = 'Each HS requirement is satisfied by exactly one of five routes. This is what turns "we wrote a policy" into defensible, auditable conformity.';
    shell.appendChild(ev);
    shell.appendChild(_evidenceLegend());

    // ---- Section 4: worked example ----
    shell.appendChild(_sectionTitle('A worked example'));
    shell.appendChild(_example());

    // ---- Section 5: live reference grid ----
    shell.appendChild(_sectionTitle('Live framework reference'));
    const gridNote = el('p', 'abt-body');
    gridNote.textContent = 'Every requirement, both dimensions, in one grid: its EU AI Act article and verification, plus the internal-standard clause and any governance self-certification that map to it.';
    shell.appendChild(gridNote);
    const gridHost = el('div', 'abt-grid-host');
    if (typeof createFrameworkMapping === 'function') {
      gridHost.appendChild(createFrameworkMapping(null, null, null));
    } else {
      gridHost.appendChild(el('p', 'abt-body', { textContent: 'Framework grid unavailable.' }));
    }
    shell.appendChild(gridHost);

    // ---- Presumption-of-conformity closing note ----
    const close = el('div', 'abt-note');
    close.innerHTML = '<strong>Presumption of conformity.</strong> When these harmonised standards are cited in the Official Journal of the EU, the same evidence chain shown here becomes the basis for a presumption of conformity under Article 40 — no re-assessment required.';
    shell.appendChild(close);

    container.appendChild(shell);
    _loadCounts();
  };

  let _blocksHost = null;

  function _sectionTitle(text) {
    const s = el('div', 'abt-sec-title');
    s.appendChild(el('span', 'abt-sec-bar'));
    s.appendChild(el('h2', '', { textContent: text }));
    return s;
  }

  // Central-hub diagram: HS requirement in the middle, four relationships out.
  function _hubDiagram() {
    const d = el('div', 'abt-hub');
    const mk = (cls, kicker, label) => {
      const b = el('div', 'abt-node ' + cls);
      b.appendChild(el('span', 'abt-node-kicker', { textContent: kicker }));
      b.appendChild(el('span', 'abt-node-label', { textContent: label }));
      return b;
    };
    d.appendChild(mk('abt-node--act',  'EU LAW ↑',        'AI Act Article'));
    d.appendChild(mk('abt-node--sr',   'INTERNAL STD →',  'AI SR control'));
    const hub = el('div', 'abt-node abt-node--hub');
    hub.appendChild(el('span', 'abt-node-kicker', { textContent: 'THE HUB' }));
    hub.appendChild(el('span', 'abt-node-label', { textContent: 'HS requirement' }));
    d.appendChild(hub);
    d.appendChild(mk('abt-node--risk', 'ADDRESSES ↓',     'Risk'));
    d.appendChild(mk('abt-node--ev',   'PROVEN BY ↓',     'Test · Document · Workflow · Self-cert'));
    return d;
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

  function _example() {
    const steps = [
      ['AI Act Article', 'ART-002 · Article 14 — Human Oversight', 'act'],
      ['HS requirements', '[18229-1.6] Automation Confidence Warning · [18229-1.7] Intervention Tools · [18229-1.8] Interpretability', 'hs'],
      ['Risk that threatens them', 'RISK-001 Human Oversight Bypass Failure', 'risk'],
      ['Proven by', 'TCTRL-001 Confidence Gate Test → verifies [18229-1.6]', 'ev'],
    ];
    const wrap = el('div', 'abt-thread');
    steps.forEach(([k, v, cls], i) => {
      const row = el('div', 'abt-thread-row');
      row.appendChild(el('span', 'abt-thread-dot abt-thread-dot--' + cls));
      const txt = el('div', 'abt-thread-txt');
      txt.appendChild(el('span', 'abt-thread-k', { textContent: k }));
      txt.appendChild(el('span', 'abt-thread-v', { textContent: v }));
      row.appendChild(txt);
      wrap.appendChild(row);
      if (i < steps.length - 1) wrap.appendChild(el('div', 'abt-thread-link'));
    });
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
      const cards = [
        ['16', arts.length || 16, 'AI Act Articles', 'The EU law', 'act'],
        [null, hs.length, 'HS requirements', `Test ${byType.Test || 0} · Doc ${byType.Document || 0} · Workflow ${byType.Workflow || 0} · N/A ${byType.Not_Applicable || 0}`, 'hs'],
        [null, risks.length, 'Risks', 'What can go wrong', 'risk'],
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
    /* hub diagram */
    .abt-hub{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:8px 0 8px;align-items:stretch}
    .abt-node{background:var(--color-surface);border:1px solid var(--color-border-mid);border-radius:var(--radius-lg);
      padding:14px 16px;display:flex;flex-direction:column;gap:4px;min-height:66px;justify-content:center}
    .abt-node-kicker{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--color-text-tertiary);font-weight:600}
    .abt-node-label{font-size:14px;font-weight:600}
    .abt-node--hub{grid-column:2;grid-row:1 / span 2;border-color:#5ec8c0;background:linear-gradient(180deg,rgba(94,200,192,.12),rgba(94,200,192,.03));align-items:center;text-align:center}
    .abt-node--hub .abt-node-label{font-size:17px}
    .abt-node--act{grid-column:1;grid-row:1;border-left:3px solid #7eb3ff}
    .abt-node--sr{grid-column:3;grid-row:1;border-left:3px solid #5ec8c0}
    .abt-node--risk{grid-column:1;grid-row:2;border-left:3px solid #f0a07a}
    .abt-node--ev{grid-column:3;grid-row:2;border-left:3px solid #8fd6a8}
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
    /* worked example thread */
    .abt-thread{margin:4px 0;max-width:80ch}
    .abt-thread-row{display:flex;align-items:flex-start;gap:12px}
    .abt-thread-dot{width:12px;height:12px;border-radius:50%;margin-top:5px;flex:none}
    .abt-thread-dot--act{background:#7eb3ff}.abt-thread-dot--hs{background:#5ec8c0}
    .abt-thread-dot--risk{background:#f0a07a}.abt-thread-dot--ev{background:#8fd6a8}
    .abt-thread-txt{display:flex;flex-direction:column;gap:1px;padding-bottom:2px}
    .abt-thread-k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--color-text-tertiary);font-weight:600}
    .abt-thread-v{font-size:14px;color:var(--color-text-primary)}
    .abt-thread-link{width:2px;height:14px;background:var(--color-border-mid);margin:1px 0 1px 5px}
    /* grid host */
    .abt-grid-host{margin-top:6px;border:1px solid var(--color-border);border-radius:var(--radius-lg);overflow:hidden;background:#141414}
    .abt-note{margin-top:28px;background:var(--color-bg-subtle);border:1px solid var(--color-border-mid);
      border-left:3px solid #c9a24a;border-radius:var(--radius-md);padding:16px 18px;font-size:13.5px;line-height:1.6;color:var(--color-text-secondary);max-width:80ch}
    .abt-note strong{color:var(--color-text-primary)}
    @media (max-width:820px){
      .abt-shell{padding:24px 18px 56px}
      .abt-hub{grid-template-columns:1fr}
      .abt-node--hub,.abt-node--act,.abt-node--sr,.abt-node--risk,.abt-node--ev{grid-column:1;grid-row:auto}
      .abt-cards{grid-template-columns:1fr 1fr}
      .abt-chip{min-width:120px}
    }`;
    document.head.appendChild(s);
  }
})();
