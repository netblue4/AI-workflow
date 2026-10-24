/* Step 7 — Risk Analysis & Evaluation (ISO 31000)
   For each applicable risk: a read-only list of its selected harmonised-standard
   requirements, an inherent-risk rating (likelihood × impact, before controls),
   and a treatment strategy. Control implementation (evidence) and residual risk
   are recorded in the later "Recording and Reporting" step.
   Saves to record['step-7'] { inherent_risks, treatments }.
*/
(function () {
  'use strict';
  const _el = WizUtils.el;
  const _sectionLabel = WizUtils.sectionLabel;

  let _container = null, _record = null, _tblData = null;
  const _inherent  = {}; // riskId → { likelihood, impact }
  const _treatment = {}; // riskId → { strategy, justification }

  const _config = {
    risk_matrix: {
      low:      { low: 'low',    medium: 'low',    high: 'medium',   critical: 'medium'   },
      medium:   { low: 'low',    medium: 'medium', high: 'high',     critical: 'high'     },
      high:     { low: 'medium', medium: 'high',   high: 'high',     critical: 'critical' },
      critical: { low: 'medium', medium: 'high',   high: 'critical', critical: 'critical' },
    },
    colors: {
      low:      { bg: 'rgba(52,199,120,0.16)', text: '#8cebb0' },
      medium:   { bg: 'rgba(212,184,96,0.16)', text: '#ecd489' },
      high:     { bg: 'rgba(224,120,80,0.40)', text: '#f3ab8a' },
      critical: { bg: 'rgba(226,90,88,0.30)',  text: '#fba4a3' },
    },
  };
  const LEVELS = ['', 'low', 'medium', 'high', 'critical'];
  const STRATEGIES = ['mitigate', 'accept', 'avoid', 'transfer'];

  // ---- Public API ---------------------------------------------
  window.mountStep7Wizard = function (container, step, detail, colorKey, phaseTitle) {
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

  window.buildStep7Reference = async function () {
    _injectStyles();
    const d = _el('div', 'abt-body');
    d.textContent = 'Risk Analysis & Evaluation — rate the inherent risk (before controls) and choose a treatment strategy for each applicable risk.';
    return d;
  };

  // ---- Data ---------------------------------------------------
  async function _loadData(pw) {
    const [risks, , hs] = await WizUtils.fetchAll(['tbl_Risks.json', 'tbl_Risk_Controls.json', 'tbl_Harmonised_Standards.json']);
    _tblData = { risks: risks || [], hs: hs || [] };
    _record = WizUtils.loadRecord();
    Object.keys(_inherent).forEach(k => delete _inherent[k]);
    Object.keys(_treatment).forEach(k => delete _treatment[k]);
    const s7 = _record?.['step-7'] || {};
    _renderPanes(pw, s7.inherent_risks || {}, s7.treatments || {});
  }

  // Selected HS requirements per risk come from Step 5 (Step 6 retired).
  function _selectedHs() {
    const s6 = _record?.['step-6'];
    if (s6 && s6.selected_hs && Object.keys(s6.selected_hs).length) return s6.selected_hs;
    return _record?.['step-5']?.legal_assessment?.selected_hs || {};
  }
  const _legalRiskIds = () => Object.keys(_selectedHs());
  const _risk = id => (_tblData.risks || []).find(r => r.pk_Risk_ID === id) || {};
  const _hsByRef = () => new Map((_tblData.hs || []).map(h => [h.standard_ref, h]));

  function _renderPanes(pw, savedInh, savedTrt) {
    pw.innerHTML = '';
    const card = _el('div', 'step-detail-card');
    card.appendChild(_el('p', 'wiz-panel-lead', {
      textContent: 'For each applicable risk, review its requirements, rate the inherent risk (before controls are applied), and choose a treatment strategy. Control implementation and residual risk are recorded later in “Recording and Reporting”.'
    }));
    const ids = _legalRiskIds();
    if (!ids.length) {
      const w = _el('div', 's9-warn');
      w.innerHTML = '<strong>No risks selected in Step 5.</strong> Complete Risk Identification first, then return here.';
      card.appendChild(w); pw.appendChild(card); return;
    }
    const body = _el('div', '');
    ids.forEach(id => {
      _inherent[id]  = Object.assign({ likelihood: '', impact: '' }, savedInh[id] || {});
      _treatment[id] = Object.assign({ strategy: 'mitigate', justification: '' }, savedTrt[id] || {});
      body.appendChild(_buildRiskPanel(id));
    });
    card.appendChild(WizUtils.buildStepGroup({
      title: 'Risks & analysis',
      description: 'Each applicable risk, with its requirements, inherent rating and treatment strategy.',
      status: String(ids.length), statusKind: 'progress', body
    }).el);
    card.appendChild(WizUtils.buildSaveBlock({ label: 'Approve & Save', onSave: _handleSave }).el);
    pw.appendChild(card);
  }

  function _levelOf(inh) { return (inh.likelihood && inh.impact) ? (_config.risk_matrix[inh.likelihood]?.[inh.impact] || '') : ''; }
  function _applyLevel(pill, l, i) {
    const lv = (l && i) ? (_config.risk_matrix[l]?.[i] || '') : '';
    const c = _config.colors[lv] || { bg: '#262219', text: '#8b8574' };
    pill.textContent = lv ? lv.charAt(0).toUpperCase() + lv.slice(1) : '—';
    pill.style.background = c.bg; pill.style.color = c.text;
  }

  function _buildRiskPanel(riskId) {
    const r = _risk(riskId);
    const body = _el('div', '');
    if (r.risk_description) {
      body.appendChild(_el('p', '', { style: 'margin:0 0 10px;font-size:12.5px;line-height:1.6;color:var(--color-text-secondary)', textContent: r.risk_description }));
    }
    // Read-only requirement list
    const refs = (_selectedHs()[riskId] || []).filter(x => x && x !== '—');
    body.appendChild(_sectionLabel(`Harmonised-standard requirements (${refs.length})`));
    if (refs.length) {
      const map = _hsByRef();
      refs.forEach(ref => {
        const h = map.get(ref) || {};
        const item = _el('div', 's9r-req');
        item.appendChild(_el('span', 's9r-ref', { textContent: WizUtils.fmtStdRef(ref) }));
        item.appendChild(_el('span', 's9r-name', { textContent: h.standard_name || ref }));
        body.appendChild(item);
      });
    } else {
      body.appendChild(_el('p', '', { style: 'font-size:12px;color:var(--color-text-tertiary)', textContent: 'No requirements selected for this risk.' }));
    }
    // Inherent risk assessment
    body.appendChild(_sectionLabel('Inherent risk assessment'));
    body.appendChild(_buildInherentPanel(riskId));
    // Treatment strategy
    body.appendChild(_sectionLabel('Treatment strategy'));
    body.appendChild(_buildTreatmentPanel(riskId));

    const artId = r.fk_AI_Article_ID || '';
    const lvl = _levelOf(_inherent[riskId]);
    const panel = WizUtils.buildStepPanel({
      num: riskId, title: r.risk_name || riskId,
      ref: artId ? WizUtils.artLabel(artId) : '',
      status: lvl ? lvl.charAt(0).toUpperCase() + lvl.slice(1) : 'Not rated',
      statusKind: lvl === 'low' ? 'done' : lvl ? 'progress' : 'todo',
      body
    });
    panel.el.dataset.riskId = riskId;
    return panel.el;
  }

  function _buildInherentPanel(riskId) {
    const inh = _inherent[riskId];
    const row = _el('div', 's9r-row');
    const pill = _el('span', 's9r-levelpill'); _applyLevel(pill, inh.likelihood, inh.impact);
    const mk = (lbl, key) => {
      const w = _el('div', 's9r-field');
      w.appendChild(_el('label', 's9r-flabel', { textContent: lbl }));
      const sel = document.createElement('select'); sel.className = 's9r-select';
      LEVELS.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v ? v.charAt(0).toUpperCase() + v.slice(1) : '— Select —'; if (v === inh[key]) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', () => { inh[key] = sel.value; _applyLevel(pill, inh.likelihood, inh.impact); _updatePanelStatus(riskId); });
      w.appendChild(sel); return w;
    };
    row.appendChild(mk('Likelihood', 'likelihood'));
    row.appendChild(mk('Impact', 'impact'));
    const lw = _el('div', 's9r-field');
    lw.appendChild(_el('label', 's9r-flabel', { textContent: 'Inherent level' }));
    lw.appendChild(pill); row.appendChild(lw);
    return row;
  }

  function _buildTreatmentPanel(riskId) {
    const t = _treatment[riskId];
    const wrap = _el('div', '');
    const row = _el('div', 's9r-row');
    const w = _el('div', 's9r-field');
    w.appendChild(_el('label', 's9r-flabel', { textContent: 'Strategy' }));
    const sel = document.createElement('select'); sel.className = 's9r-select';
    STRATEGIES.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v.charAt(0).toUpperCase() + v.slice(1); if (v === t.strategy) o.selected = true; sel.appendChild(o); });
    w.appendChild(sel); row.appendChild(w); wrap.appendChild(row);
    const jwrap = _el('div', 's9r-just');
    jwrap.appendChild(_el('label', 's9r-flabel', { textContent: 'Justification (required when the strategy is not “Mitigate”)' }));
    const ta = document.createElement('textarea'); ta.className = 's9r-ta'; ta.rows = 2;
    ta.placeholder = 'Why accept / avoid / transfer this risk rather than mitigate it…';
    ta.value = t.justification || '';
    ta.addEventListener('input', () => { t.justification = ta.value; });
    jwrap.appendChild(ta); wrap.appendChild(jwrap);
    const sync = () => { jwrap.style.display = (t.strategy === 'mitigate') ? 'none' : ''; };
    sel.addEventListener('change', () => { t.strategy = sel.value; sync(); });
    sync();
    return wrap;
  }

  function _updatePanelStatus(riskId) {
    const panel = _container.querySelector(`.wiz-panel[data-risk-id="${riskId}"]`);
    if (!panel) return;
    const lvl = _levelOf(_inherent[riskId]);
    const st = panel.querySelector('.wiz-panel-status');
    if (st) { st.textContent = lvl ? lvl.charAt(0).toUpperCase() + lvl.slice(1) : 'Not rated'; st.className = 'wiz-panel-status wiz-panel-status--' + (lvl === 'low' ? 'done' : lvl ? 'progress' : 'todo'); }
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    const inherent_risks = {}, treatments = {};
    _legalRiskIds().forEach(id => {
      const inh = _inherent[id] || {};
      inherent_risks[id] = { likelihood: inh.likelihood || '', impact: inh.impact || '', level: _levelOf(inh) };
      const t = _treatment[id] || {};
      treatments[id] = { strategy: t.strategy || 'mitigate', justification: (t.justification || '').trim() };
    });
    if (!_record) _record = {};
    if (!_record._meta) _record._meta = { schema_version: '1.0', created: new Date().toISOString() };
    _record._meta.last_modified = new Date().toISOString();
    const prev = _record['step-7'] || {};
    _record['step-7'] = Object.assign({}, prev, {
      step_id: 'step-7', step_title: 'Risk Analysis & Evaluation',
      assessment_date: new Date().toISOString().slice(0, 10),
      inherent_risks, treatments
    });
    WizUtils.saveRecord(_record);
    if (typeof _ucShowStatus === 'function') _ucShowStatus('Risk analysis saved ✓');
    return { title: 'Inherent risk Result', el: _buildResultSummary(inherent_risks, treatments) };
  }

  function _buildResultSummary(inh, trt) {
    const wrap = _el('div', '');
    const tbl = document.createElement('table'); tbl.className = 's9r-result-tbl';
    tbl.innerHTML = '<thead><tr><th>Risk</th><th>Inherent level</th><th>Treatment</th></tr></thead>';
    const tb = document.createElement('tbody');
    _legalRiskIds().forEach(id => {
      const i = inh[id] || {}, t = trt[id] || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${_esc(id)} — ${_esc(_risk(id).risk_name || id)}</td><td>${_esc(i.level || '—')}</td><td>${_esc(t.strategy || '—')}</td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); wrap.appendChild(tbl); return wrap;
  }
  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function _injectStyles() {
    WizUtils.injectStyles('s9r-styles', `
.s9r-req{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px}
.s9r-ref{font-family:var(--font-mono);font-size:11px;font-weight:600;color:#ecd489;background:rgba(212,184,96,0.16);border-radius:4px;padding:2px 8px;white-space:nowrap;flex-shrink:0}
.s9r-name{color:var(--color-text-primary)}
.s9r-row{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;margin:4px 0 2px}
.s9r-field{display:flex;flex-direction:column;gap:4px}
.s9r-flabel{font-size:11px;font-weight:600;color:var(--color-text-secondary)}
.s9r-select{padding:7px 10px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);color:var(--color-text-primary);font-size:13px;font-family:inherit;cursor:pointer}
.s9r-levelpill{display:inline-block;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;min-width:70px;text-align:center}
.s9r-just{margin-top:10px;display:flex;flex-direction:column;gap:4px}
.s9r-ta{width:100%;box-sizing:border-box;border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-bg-subtle,#211d15);resize:vertical}
.s9r-result-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.s9r-result-tbl th,.s9r-result-tbl td{border:1px solid rgba(150,140,110,0.3);padding:6px 10px;text-align:left}
.s9r-result-tbl th{background:rgba(150,140,110,0.14);font-weight:700}
.s9-warn{padding:14px 16px;border:1px solid rgba(224,120,80,0.4);background:rgba(224,120,80,0.12);border-radius:8px;color:#f3ab8a;font-size:13px}
`);
  }

})();
