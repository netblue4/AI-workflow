/* Risk Treatment (ISO 31000) — step-14
   For each applicable risk, capture the treatment plan (who is responsible, the
   timeline, and the resources needed), print the plan for a cost–benefit review,
   then record the business go / no-go decision to fund the build. A "no-go"
   marks the whole assessment as stopped.
   Saves to record['step-14'] { plans, decision, decided_by }.
*/
(function () {
  'use strict';
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _container = null, _record = null, _tblData = null;
  const _plans = {};          // riskId → { responsible, timeline, resources }
  let _decision = '';         // '' | 'go' | 'no_go'
  let _decidedBy = '';
  let _saveBlock = null;

  const _RES_COLORS = {
    low: { bg: 'rgba(52,199,120,0.16)', text: '#8cebb0' },
    medium: { bg: 'rgba(212,184,96,0.16)', text: '#ecd489' },
    high: { bg: 'rgba(224,120,80,0.40)', text: '#f3ab8a' },
    critical: { bg: 'rgba(226,90,88,0.30)', text: '#fba4a3' },
  };

  window.mountTreatmentWizard = function (container, step, detail, colorKey, phaseTitle) {
    _container = container;
    _injectStyles();
    const shell = _el('div', 'wiz-shell');
    shell.appendChild(WizUtils.buildStepHeader(step, colorKey, phaseTitle, { hideDetails: true }));
    const pw = _el('div', 'wiz-pane-wrap');
    shell.appendChild(pw);
    container.innerHTML = '';
    container.appendChild(shell);
    _loadData(pw);
  };

  window.buildTreatmentReference = async function () {
    _injectStyles();
    const d = _el('div', 'abt-body');
    d.textContent = 'Risk Treatment — capture who treats each risk, by when and with what resources, then record the business go / no-go decision to fund the build.';
    return d;
  };

  async function _loadData(pw) {
    const [risks] = await WizUtils.fetchAll(['tbl_Risks.json']);
    _tblData = { risks: risks || [] };
    _record = WizUtils.loadRecord();
    Object.keys(_plans).forEach(k => delete _plans[k]);
    const s14 = _record?.['step-14'] || {};
    Object.assign(_plans, s14.plans || {});
    _decision = s14.decision || '';
    _decidedBy = s14.decided_by || (_record?._meta?.assessed_by || '');
    _renderPanes(pw);
  }

  function _selectedHs() {
    const s6 = _record?.['step-6'];
    if (s6 && s6.selected_hs && Object.keys(s6.selected_hs).length) return s6.selected_hs;
    return _record?.['step-5']?.legal_assessment?.selected_hs || {};
  }
  const _riskIds = () => Object.keys(_selectedHs());
  const _risk = id => (_tblData.risks || []).find(r => r.pk_Risk_ID === id) || {};
  const _inherentOf = id => _record?.['step-7']?.inherent_risks?.[id] || {};
  const _strategyOf = id => _record?.['step-7']?.treatments?.[id]?.strategy || 'mitigate';

  function _renderPanes(pw) {
    pw.innerHTML = '';
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('p', 'wiz-panel-lead', {
      textContent: 'For each risk, record who is responsible for treating it, by when, and the resources required. Print the treatment plan to run your cost–benefit analysis, then record the business decision to fund the build below.'
    }));
    const ids = _riskIds();
    if (!ids.length) {
      const w = _el('div', 's9-warn');
      w.innerHTML = '<strong>No risks selected in Step 5.</strong> Complete Risk Identification first, then return here.';
      card.appendChild(w); pw.appendChild(card); return;
    }
    ids.forEach(id => { _plans[id] = Object.assign({ responsible: '', timeline: '', resources: '' }, _plans[id] || {}); });

    // Treatment plan group + print button
    const body = _el('div', '');
    const printRow = _el('div', '', { style: 'display:flex;justify-content:flex-end;margin-bottom:10px' });
    const printBtn = _el('button', 'wiz-btn-secondary', { type: 'button', textContent: '🖨 Print risk treatment plan' });
    printBtn.addEventListener('click', _printPlan);
    printRow.appendChild(printBtn);
    body.appendChild(printRow);
    ids.forEach(id => body.appendChild(_buildRiskPanel(id)));
    card.appendChild(WizUtils.buildStepGroup({
      title: 'Risk treatment plan',
      description: 'Responsibilities, timelines and resources to treat each risk — the cost side of the business cost–benefit analysis.',
      status: String(ids.length), statusKind: 'progress', body
    }).el);

    // Decision
    card.appendChild(_buildDecisionPanel());

    _saveBlock = WizUtils.buildSaveBlock({ label: 'Approve & Save', onSave: _handleSave });
    card.appendChild(_saveBlock.el);
    pw.appendChild(card);
  }

  function _levelPill(level) {
    const c = _RES_COLORS[level] || { bg: '#262219', text: '#8b8574' };
    const pill = _el('span', 's14-lvl');
    pill.textContent = level ? level.charAt(0).toUpperCase() + level.slice(1) : '—';
    pill.style.background = c.bg; pill.style.color = c.text;
    return pill;
  }

  function _buildRiskPanel(id) {
    const r = _risk(id);
    const plan = _plans[id];
    const inh = _inherentOf(id);
    const body = _el('div', '');

    const ctx = _el('div', 's14-ctx');
    ctx.appendChild(_el('span', 's14-ctx-lbl', { textContent: 'Inherent risk' }));
    ctx.appendChild(_levelPill(inh.level || ''));
    ctx.appendChild(_el('span', 's14-ctx-lbl', { textContent: 'Strategy' }));
    ctx.appendChild(_el('span', 's14-strat', { textContent: _strategyOf(id).charAt(0).toUpperCase() + _strategyOf(id).slice(1) }));
    body.appendChild(ctx);

    const mk = (lbl, key, ph) => {
      const w = _el('div', 's14-field');
      w.appendChild(_el('label', 's14-flabel', { textContent: lbl }));
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 's14-input'; inp.placeholder = ph; inp.value = plan[key] || '';
      inp.addEventListener('input', () => { plan[key] = inp.value; });
      w.appendChild(inp); return w;
    };
    const grid = _el('div', 's14-grid');
    grid.appendChild(mk('Responsible', 'responsible', 'Owner / team accountable for treating this risk'));
    grid.appendChild(mk('Timeline', 'timeline', 'e.g. by Q3, or 6 weeks from go'));
    grid.appendChild(mk('Resources', 'resources', 'People, budget, tooling required'));
    body.appendChild(grid);

    const artId = r.fk_AI_Article_ID || '';
    const filled = plan.responsible || plan.timeline || plan.resources;
    return WizUtils.buildStepPanel({
      num: id, title: r.risk_name || id,
      ref: artId ? WizUtils.artLabel(artId) : '',
      status: filled ? 'Planned' : 'To plan', statusKind: filled ? 'done' : 'todo',
      body
    }).el;
  }

  function _buildDecisionPanel() {
    const body = _el('div', '');
    body.appendChild(_el('p', '', {
      style: 'font-size:12.5px;line-height:1.6;color:var(--color-text-secondary);margin:0 0 12px',
      textContent: 'Once the business has weighed the treatment cost against the benefit of the AI system, record the decision to fund the build. This is the business funding gate — it is separate from the AI Change Board’s decision to deploy. A “No-go” stops the assessment.'
    }));
    const sw = _el('div', 's14-switch');
    const mkOpt = (val, label, cls) => {
      const btn = _el('button', 's14-sw-opt ' + cls + (_decision === val ? ' is-on' : ''), { type: 'button', textContent: label });
      btn.addEventListener('click', () => {
        _decision = (_decision === val) ? '' : val;
        sw.querySelectorAll('.s14-sw-opt').forEach(b => b.classList.remove('is-on'));
        if (_decision === val) btn.classList.add('is-on');
        _paintDecisionNote(note);
      });
      return btn;
    };
    sw.append(mkOpt('no_go', '✗ No-go', 's14-sw-nogo'), mkOpt('go', '✓ Go — fund the build', 's14-sw-go'));
    body.appendChild(sw);

    const nameWrap = _el('div', 's14-field', { style: 'max-width:340px;margin-top:12px' });
    nameWrap.appendChild(_el('label', 's14-flabel', { textContent: 'Decision by' }));
    const nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.className = 's14-input'; nameInp.placeholder = 'Name / role'; nameInp.value = _decidedBy;
    nameInp.addEventListener('input', () => { _decidedBy = nameInp.value; });
    nameWrap.appendChild(nameInp);
    body.appendChild(nameWrap);

    const note = _el('div', 's14-decnote'); body.appendChild(note);
    _paintDecisionNote(note);

    return WizUtils.buildStepPanel({
      title: 'Business funding decision (Go / No-go)',
      description: 'The business’s decision to fund the build, based on the treatment plan and cost–benefit analysis.',
      status: _decision === 'go' ? 'Go' : _decision === 'no_go' ? 'No-go' : 'Not decided',
      statusKind: _decision === 'go' ? 'done' : _decision === 'no_go' ? 'muted' : 'todo',
      open: true, body
    }).el;
  }

  function _paintDecisionNote(note) {
    note.className = 's14-decnote';
    if (_decision === 'no_go') {
      note.classList.add('is-nogo');
      note.innerHTML = '⛔ <strong>No-go.</strong> The assessment is marked as stopped — the business has decided not to fund the build. It will show as blocked on the dashboard.';
    } else if (_decision === 'go') {
      note.classList.add('is-go');
      note.innerHTML = '✓ <strong>Go.</strong> The business will fund the build. Proceed to implement the controls in “Recording and Reporting”, then to the AI Change Board for the decision to deploy.';
    } else {
      note.innerHTML = '';
    }
  }

  function _handleSave() {
    const ids = _riskIds();
    const plans = {};
    ids.forEach(id => { plans[id] = { responsible: (_plans[id]?.responsible || '').trim(), timeline: (_plans[id]?.timeline || '').trim(), resources: (_plans[id]?.resources || '').trim() }; });
    if (!_record) _record = {};
    if (!_record._meta) _record._meta = { schema_version: '1.0', created: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    _record['step-14'] = {
      step_id: 'step-14', step_title: 'Risk Treatment',
      assessment_date: new Date().toISOString().slice(0, 10),
      plans, decision: _decision, decided_by: (_decidedBy || '').trim(),
      decided_at: _decision ? new Date().toISOString() : ''
    };
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Risk treatment saved ✓');
    const note = _el('p', 'wiz-save-summary-note');
    note.innerHTML = _decision === 'no_go'
      ? '⛔ <strong>No-go recorded.</strong> The assessment is stopped — see the dashboard.'
      : _decision === 'go'
        ? '✓ <strong>Go recorded.</strong> Treatment plan saved for ' + ids.length + ' risk' + (ids.length !== 1 ? 's' : '') + '.'
        : 'Treatment plan saved for ' + ids.length + ' risk' + (ids.length !== 1 ? 's' : '') + '. No funding decision recorded yet.';
    return { title: 'Risk Treatment Result', el: note };
  }

  // ---- Printable risk treatment plan --------------------------
  function _printPlan() {
    const ids = _riskIds();
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const meta = _record?._meta || {};
    const rows = ids.map(id => {
      const r = _risk(id), p = _plans[id] || {}, inh = _inherentOf(id);
      return `<tr><td>${esc(id)} — ${esc(r.risk_name || '')}</td><td>${esc(inh.level || '—')}</td><td>${esc(_strategyOf(id))}</td><td>${esc(p.responsible || '')}</td><td>${esc(p.timeline || '')}</td><td>${esc(p.resources || '')}</td></tr>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Risk Treatment Plan — ${esc(meta.use_case_name || '')}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#111;margin:24px}h1{font-size:16pt}.m{color:#555;font-size:10pt;margin-bottom:16px}table{width:100%;border-collapse:collapse;font-size:9.5pt}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f0ede4}@media print{body{margin:0}}</style></head>
<body><h1>Risk Treatment Plan</h1>
<div class="m">${esc(meta.use_case_name || 'AI use case')}${meta.use_case_id ? ' · ' + esc(meta.use_case_id) : ''} · Generated ${new Date().toISOString().slice(0, 10)}</div>
<table><thead><tr><th>Risk</th><th>Inherent</th><th>Strategy</th><th>Responsible</th><th>Timeline</th><th>Resources</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6">No risks.</td></tr>'}</tbody></table>
<p class="m" style="margin-top:20px">Use the resources column as the cost side of the cost–benefit analysis. Funding decision: ${_decision === 'go' ? 'GO' : _decision === 'no_go' ? 'NO-GO' : 'not yet decided'}.</p>
<script>window.onload=function(){window.print();}<\/script></body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }

  function _injectStyles() {
    WizUtils.injectStyles('s14-styles', `
.s14-ctx{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0 12px}
.s14-ctx-lbl{font-size:11px;font-weight:600;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.04em}
.s14-lvl{display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700}
.s14-strat{font-size:12px;font-weight:600;color:var(--color-text-primary);background:rgba(212,184,96,0.16);border-radius:5px;padding:2px 9px}
.s14-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.s14-field{display:flex;flex-direction:column;gap:4px}
.s14-flabel{font-size:11px;font-weight:600;color:var(--color-text-secondary)}
.s14-input{padding:8px 10px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);color:var(--color-text-primary);font-size:13px;font-family:inherit;box-sizing:border-box}
.s14-switch{display:inline-flex;border:1px solid var(--color-border);border-radius:10px;overflow:hidden}
.s14-sw-opt{padding:10px 20px;background:var(--color-surface);color:var(--color-text-secondary);border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;transition:all .12s}
.s14-sw-opt + .s14-sw-opt{border-left:1px solid var(--color-border)}
.s14-sw-go.is-on{background:rgba(52,199,120,0.2);color:#8cebb0}
.s14-sw-nogo.is-on{background:rgba(226,90,88,0.22);color:#fba4a3}
.s14-decnote{margin-top:12px;font-size:12.5px;line-height:1.6}
.s14-decnote.is-nogo{color:#fba4a3;background:rgba(226,90,88,0.12);border:1px solid rgba(226,90,88,0.4);border-radius:8px;padding:12px 14px}
.s14-decnote.is-go{color:#8cebb0;background:rgba(52,199,120,0.1);border:1px solid rgba(52,199,120,0.35);border-radius:8px;padding:12px 14px}
.s9-warn{padding:14px 16px;border:1px solid rgba(224,120,80,0.4);background:rgba(224,120,80,0.12);border-radius:8px;color:#f3ab8a;font-size:13px}
`);
  }

})();
