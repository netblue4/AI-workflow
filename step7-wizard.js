/* Step 7 — Risk Analysis & Evaluation (ISO 31000)
   For each applicable risk: an inherent-risk rating (likelihood × impact, before
   controls), a treatment strategy, and — on demand — its selected harmonised-
   standard requirements. Control implementation (evidence) and residual risk
   are recorded in the later "Recording and Reporting" step.
   Layout: a calm, single-column list where one risk is open at a time.
   Saves to record['step-7'] { inherent_risks, treatments }.
*/
(function () {
  'use strict';
  const _el = WizUtils.el;

  let _container = null, _record = null, _tblData = null;
  let _openId = null;
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
      high:     { bg: 'rgba(224,120,80,0.30)', text: '#f3ab8a' },
      critical: { bg: 'rgba(226,90,88,0.30)',  text: '#fba4a3' },
    },
  };
  const LEVELS = ['low', 'medium', 'high', 'critical'];
  const STRATEGIES = ['mitigate', 'accept', 'avoid', 'transfer'];
  const _cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  const CHEVRON = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 5L7 9.5L11.5 5"/></svg>';
  const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Rated"><path d="M5 12l5 5 9-10"/></svg>';

  // ---- Public API ---------------------------------------------
  window.mountStep7Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container = container;
    _injectStyles();
    const shell = WizUtils.calmShell(_el('div', 'wiz-shell'));
    shell.appendChild(WizUtils.buildCalmHeader(step, phaseTitle, {
      lead: 'Rate each risk before any controls are applied, then choose how you will treat it.',
      about: ['Control implementation and residual risk are recorded later, in “Recording and Reporting”.']
    }));
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
  const _isRated = id => !!_levelOf(_inherent[id] || {});

  function _renderPanes(pw, savedInh, savedTrt) {
    pw.innerHTML = '';
    const wrap = _el('div', 's7-body');
    const ids = _legalRiskIds();
    if (!ids.length) {
      const w = _el('div', 's9-warn');
      w.innerHTML = '<strong>No risks selected in Step 4.</strong> Complete Risk Identification first, then return here.';
      wrap.appendChild(w); pw.appendChild(wrap); return;
    }
    ids.forEach(id => {
      _inherent[id]  = Object.assign({ likelihood: '', impact: '' }, savedInh[id] || {});
      _treatment[id] = Object.assign({ strategy: 'mitigate', justification: '' }, savedTrt[id] || {});
    });
    // Open the first risk still to rate; nothing open when all are rated.
    _openId = ids.find(id => !_isRated(id)) || null;

    wrap.appendChild(_buildProgress());
    const list = _el('div', 's7-list');
    ids.forEach(id => list.appendChild(_buildRiskItem(id)));
    wrap.appendChild(list);
    wrap.appendChild(WizUtils.buildSaveBlock({ label: 'Approve & Save', onSave: _handleSave }).el);
    pw.appendChild(wrap);
  }

  function _levelOf(inh) { return (inh.likelihood && inh.impact) ? (_config.risk_matrix[inh.likelihood]?.[inh.impact] || '') : ''; }
  function _applyLevel(pill, lv) {
    const c = _config.colors[lv];
    pill.textContent = lv ? _cap(lv) : 'Not rated';
    pill.style.background = c ? c.bg : 'transparent';
    pill.style.color = c ? c.text : 'var(--color-text-secondary)';
  }

  // ---- Progress line ------------------------------------------
  function _buildProgress() {
    const p = _el('div', 's7-progress');
    p.appendChild(_el('span', 's7-progress-text'));
    const bar = _el('div', 's7-bar');
    bar.appendChild(_el('div', 's7-bar-fill'));
    p.appendChild(bar);
    _syncProgress(p);
    return p;
  }
  function _syncProgress(p) {
    p = p || _container.querySelector('.s7-progress');
    if (!p) return;
    const ids = _legalRiskIds();
    const done = ids.filter(_isRated).length;
    p.querySelector('.s7-progress-text').textContent = `${done} of ${ids.length} risks rated`;
    p.querySelector('.s7-bar-fill').style.width = ids.length ? `${Math.round(done / ids.length * 100)}%` : '0';
  }

  // ---- One risk: a one-line row that opens into the rating form
  function _buildRiskItem(riskId) {
    const r = _risk(riskId);
    const item = _el('section', 's7-risk');
    item.dataset.riskId = riskId;

    const head = _el('button', 's7-risk-head', { type: 'button' });
    head.setAttribute('aria-expanded', 'false');
    head.appendChild(_el('span', 's7-risk-mark'));
    head.appendChild(_el('span', 's7-risk-name', { textContent: r.risk_name || riskId }));
    head.appendChild(_el('span', 's7-risk-sum'));
    head.addEventListener('click', () => _setOpen(_openId === riskId ? null : riskId));
    item.appendChild(head);

    const body = _el('div', 's7-risk-body');
    const artId = r.fk_AI_Article_ID || '';
    const sub = [riskId, artId ? WizUtils.artLabel(artId) : ''].filter(Boolean).join(' · ');
    body.appendChild(_el('p', 's7-risk-ref', { textContent: sub }));
    if (r.risk_description) body.appendChild(_el('p', 's7-risk-desc', { textContent: r.risk_description }));

    const inh = _inherent[riskId], t = _treatment[riskId];
    const pill = _el('span', 's7-level');
    const onRate = () => { _applyLevel(pill, _levelOf(inh)); _syncItem(riskId); _syncProgress(); };
    body.appendChild(_segmented('Likelihood', LEVELS, () => inh.likelihood, v => { inh.likelihood = v; onRate(); }));
    body.appendChild(_segmented('Impact', LEVELS, () => inh.impact, v => { inh.impact = v; onRate(); }));

    const lvlRow = _el('div', 's7-level-row');
    lvlRow.appendChild(_el('span', '', { textContent: 'Inherent risk' }));
    lvlRow.appendChild(pill);
    _applyLevel(pill, _levelOf(inh));
    body.appendChild(lvlRow);

    const just = _el('div', 's7-just');
    const syncJust = () => { just.hidden = t.strategy === 'mitigate'; };
    body.appendChild(_segmented('Treatment', STRATEGIES, () => t.strategy, v => { t.strategy = v; syncJust(); _syncItem(riskId); }));
    const taId = `s7-just-${riskId}`;
    just.appendChild(_el('label', 's7-label', { textContent: 'Why not mitigate? (required)', htmlFor: taId }));
    const ta = _el('textarea', 's9r-ta', { id: taId, rows: 2, placeholder: 'Why accept / avoid / transfer this risk rather than mitigate it…', value: t.justification || '' });
    ta.addEventListener('input', () => { t.justification = ta.value; });
    just.appendChild(ta);
    syncJust();
    body.appendChild(just);

    // Footer: requirements on demand, and a button to move to the next risk
    const foot = _el('div', 's7-risk-foot');
    const refs = (_selectedHs()[riskId] || []).filter(x => x && x !== '—');
    const reqList = _el('div', 's7-reqs');
    reqList.hidden = true;
    if (refs.length) {
      const map = _hsByRef();
      refs.forEach(ref => {
        const h = map.get(ref) || {};
        const row = _el('div', 's9r-req');
        row.appendChild(_el('span', 's9r-ref', { textContent: WizUtils.fmtStdRef(ref) }));
        row.appendChild(_el('span', 's9r-name', { textContent: h.standard_name || ref }));
        reqList.appendChild(row);
      });
      const reqBtn = _el('button', 's7-link', { type: 'button' });
      reqBtn.innerHTML = `Show linked requirements (${refs.length}) ${CHEVRON}`;
      reqBtn.setAttribute('aria-expanded', 'false');
      reqBtn.addEventListener('click', () => {
        reqList.hidden = !reqList.hidden;
        reqBtn.setAttribute('aria-expanded', String(!reqList.hidden));
        reqBtn.classList.toggle('is-open', !reqList.hidden);
      });
      foot.appendChild(reqBtn);
    } else {
      foot.appendChild(_el('span', 's7-muted', { textContent: 'No linked requirements' }));
    }
    const next = _el('button', 'wiz-btn-primary s7-next', { type: 'button', textContent: 'Next risk' });
    next.addEventListener('click', () => {
      const ids = _legalRiskIds();
      const after = ids.slice(ids.indexOf(riskId) + 1).find(id => !_isRated(id))
                 || ids.find(id => id !== riskId && !_isRated(id)) || null;
      _setOpen(after);
      const target = after ? _container.querySelector(`.s7-risk[data-risk-id="${after}"]`) : _container.querySelector('.wiz-save-block');
      try { target && target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
    });
    foot.appendChild(next);
    body.appendChild(foot);
    body.appendChild(reqList);

    item.appendChild(body);
    _syncItem(riskId, item);
    return item;
  }

  // A row of toggle buttons — one tap instead of opening a dropdown.
  function _segmented(label, values, get, set) {
    const wrap = _el('div', 's7-field');
    wrap.appendChild(_el('span', 's7-label', { textContent: label }));
    const grp = _el('div', 's7-seg');
    grp.setAttribute('role', 'group');
    grp.setAttribute('aria-label', label);
    const btns = values.map(v => {
      const b = _el('button', 's7-seg-btn', { type: 'button', textContent: _cap(v) });
      b.addEventListener('click', () => { set(v); sync(); });
      grp.appendChild(b);
      return [v, b];
    });
    const sync = () => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(get() === v)));
    sync();
    wrap.appendChild(grp);
    return wrap;
  }

  function _setOpen(riskId) {
    _openId = riskId;
    _legalRiskIds().forEach(id => _syncItem(id));
  }

  function _syncItem(riskId, item) {
    item = item || _container.querySelector(`.s7-risk[data-risk-id="${riskId}"]`);
    if (!item) return;
    const open = _openId === riskId;
    const rated = _isRated(riskId);
    item.classList.toggle('is-open', open);
    item.classList.toggle('is-rated', rated);
    item.querySelector('.s7-risk-head').setAttribute('aria-expanded', String(open));
    item.querySelector('.s7-risk-mark').innerHTML = rated ? CHECK : '';

    const sum = item.querySelector('.s7-risk-sum');
    sum.innerHTML = '';
    if (rated) {
      const pill = _el('span', 's7-level');
      _applyLevel(pill, _levelOf(_inherent[riskId]));
      sum.appendChild(pill);
      sum.appendChild(_el('span', 's7-muted', { textContent: _cap(_treatment[riskId].strategy) }));
    } else if (!open) {
      sum.appendChild(_el('span', 's7-muted', { textContent: 'Not rated' }));
    }
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
    WizUtils.injectStyles('s7-styles', `
.s7-link{display:inline-flex;align-items:center;gap:5px;min-height:32px;padding:0;border:0;background:none;color:var(--gold,#d4b860);font-size:13px;font-family:inherit;cursor:pointer}
.s7-link:hover{color:var(--gold-bright,#ecd489)}
.s7-link svg{transition:transform .15s}
.s7-link.is-open svg{transform:rotate(180deg)}
.s7-progress{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}
.s7-progress-text{font-size:13px;color:var(--color-text-secondary)}
.s7-bar{height:4px;border-radius:2px;background:rgba(240,232,208,0.10)}
.s7-bar-fill{height:4px;border-radius:2px;background:var(--gold,#d4b860);transition:width .25s}
.s7-list{display:flex;flex-direction:column;gap:8px;margin-bottom:24px}
.s7-risk{border:1px solid var(--color-border);border-radius:10px;transition:border-color .15s,background .15s}
.s7-risk.is-open{border-color:rgba(212,184,96,0.45);background:var(--color-surface)}
.s7-risk-head{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:0 16px;border:0;background:none;color:var(--color-text-secondary);font-size:15px;font-family:inherit;text-align:left;cursor:pointer;border-radius:10px}
.s7-risk-head:hover{color:var(--color-text-primary)}
.s7-risk.is-rated .s7-risk-head,.s7-risk.is-open .s7-risk-head{color:var(--color-text-primary)}
.s7-risk.is-open .s7-risk-head{font-size:16.5px;font-weight:600;padding-top:6px}
.s7-risk-mark{flex:none;width:16px;height:16px;box-sizing:border-box;border-radius:50%;border:1.5px solid rgba(240,232,208,0.28);display:flex;align-items:center;justify-content:center}
.s7-risk.is-open .s7-risk-mark{border:2px solid var(--gold,#d4b860)}
.s7-risk.is-rated .s7-risk-mark{border:0;color:#8cebb0}
.s7-risk-name{flex:1;min-width:0}
.s7-risk-sum{display:flex;align-items:center;gap:12px;flex:none}
.s7-muted{font-size:13px;font-weight:400;color:var(--color-text-secondary)}
.s7-level{padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
.s7-risk-body{display:none;flex-direction:column;gap:20px;padding:0 20px 22px 44px}
.s7-risk.is-open .s7-risk-body{display:flex}
.s7-risk-ref{margin:-14px 0 0;font-size:13px;color:var(--color-text-secondary)}
.s7-risk-desc{margin:0;font-size:14px;line-height:1.6;color:var(--color-text-secondary);max-width:62ch}
.s7-field{display:flex;flex-direction:column;gap:8px}
.s7-label{font-size:13px;color:var(--color-text-secondary)}
.s7-seg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.s7-seg-btn{min-height:42px;border-radius:8px;border:1px solid rgba(240,232,208,0.14);background:transparent;color:var(--color-text-secondary);font-size:14px;font-family:inherit;cursor:pointer;transition:border-color .12s,background .12s,color .12s}
.s7-seg-btn:hover{border-color:rgba(212,184,96,0.5);color:var(--color-text-primary)}
.s7-seg-btn[aria-pressed="true"]{border-color:var(--gold,#d4b860);background:rgba(212,184,96,0.14);color:var(--color-text-primary);font-weight:500}
.s7-level-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:8px;background:var(--color-bg);font-size:14px;color:var(--color-text-secondary)}
.s7-level-row .s7-level{font-size:13px;padding:3px 11px}
.s7-just{display:flex;flex-direction:column;gap:6px}
.s7-just[hidden]{display:none}
.s7-risk-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.s7-next{min-height:40px}
.s7-reqs{padding:10px 14px;border-radius:8px;background:var(--color-bg)}
.s7-reqs[hidden]{display:none}
.s7-seg-btn:focus-visible,.s7-risk-head:focus-visible,.s7-link:focus-visible{outline:2px solid var(--gold,#d4b860);outline-offset:2px}
@media (max-width:640px){.s7-risk-body{padding:0 14px 18px}.s7-seg{grid-template-columns:repeat(2,minmax(0,1fr))}}
.s9r-req{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px}
.s9r-ref{font-family:var(--font-mono);font-size:11px;font-weight:600;color:#ecd489;background:rgba(212,184,96,0.16);border-radius:4px;padding:2px 8px;white-space:nowrap;flex-shrink:0}
.s9r-name{color:var(--color-text-primary)}
.s9r-ta{width:100%;box-sizing:border-box;border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;font-size:13px;font-family:inherit;color:var(--color-text-primary);background:var(--color-bg-subtle,#211d15);resize:vertical}
.s9r-result-tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.s9r-result-tbl th,.s9r-result-tbl td{border:1px solid rgba(150,140,110,0.3);padding:6px 10px;text-align:left}
.s9r-result-tbl th{background:rgba(150,140,110,0.14);font-weight:700}
.s9-warn{padding:14px 16px;border:1px solid rgba(224,120,80,0.4);background:rgba(224,120,80,0.12);border-radius:8px;color:#f3ab8a;font-size:13px}
`);
  }

})();
