/* Step 9 — Operational Controls Activation
   Reads selected controls from record['step-6'] (risk_controls, compliance_additions, dpia_controls).
   For each control: shows name, objective, evidence/notes textarea, and status dropdown.
   Approver sets status; developer fills evidence notes (Jira URL or description).
   Saves to record['step-9'].
*/
(function () {
  'use strict';

  // ---- Module state -------------------------------------------
  let _step = null, _colorKey = null, _phaseTitle = null;
  let _container = null, _tblData = null, _record = null;
  let _controls = []; // flat list of {key, name, objective, source, risk_id, risk_name}

  const _state = {}; // control_key → { notes, status }

  const STATUS_OPTIONS = [
    { value: 'not_started',       label: 'Not started' },
    { value: 'in_progress',       label: 'In progress' },
    { value: 'evidence_provided', label: 'Evidence provided' },
    { value: 'waived',            label: 'Waived' }
  ];

  const STATUS_COLORS = {
    not_started:       { bg: '#f1f5f9', text: '#475569' },
    in_progress:       { bg: '#fef3c7', text: '#92400e' },
    evidence_provided: { bg: '#dcfce7', text: '#166534' },
    waived:            { bg: '#ede9fe', text: '#6d28d9' }
  };

  const _residualState = {}; // risk_id → { likelihood, impact, justification }

  const RISK_MATRIX = {
    low:      { low: 'low',    medium: 'low',    high: 'medium',   critical: 'medium'   },
    medium:   { low: 'low',    medium: 'medium', high: 'high',     critical: 'high'     },
    high:     { low: 'medium', medium: 'high',   high: 'high',     critical: 'critical' },
    critical: { low: 'medium', medium: 'high',   high: 'critical', critical: 'critical' }
  };

  const RESIDUAL_COLORS = {
    low:      { bg: '#dcfce7', text: '#166534' },
    medium:   { bg: '#fef3c7', text: '#92400e' },
    high:     { bg: '#fed7aa', text: '#9a3412' },
    critical: { bg: '#fee2e2', text: '#991b1b' }
  };

  // ---- Public API ---------------------------------------------
  window.mountStep9Wizard = function (container, step, detail, colorKey, phaseTitle) {
    _container  = container;
    _step       = step;
    _colorKey   = colorKey;
    _phaseTitle = phaseTitle;
    _tblData    = null;
    _record     = null;
    _controls   = [];

    _injectStyles();
    _loadData();
  };

  // ---- Data loading -------------------------------------------
  async function _loadData() {
    _container.innerHTML = '<p style="padding:32px;color:var(--color-text-secondary)">Loading…</p>';

    try {
      const [rRes, rcRes] = await Promise.all([
        fetch('tbl_Risks.json'),
        fetch('tbl_Risk_Controls.json')
      ]);
      if (!rRes.ok || !rcRes.ok) throw new Error('fetch failed');
      const [risks, riskControls] = await Promise.all([rRes.json(), rcRes.json()]);
      _tblData = { risks, riskControls };
    } catch (_) {
      _container.innerHTML = '<p style="padding:32px;color:#dc2626">Could not load control data files.</p>';
      return;
    }

    try {
      const s = sessionStorage.getItem('ai_workflow_system_record');
      if (s) _record = JSON.parse(s);
    } catch (_) {}

    _buildControlList();
    _restoreState();
    _render();
  }

  // ---- Build flat control list from Step 6 record -------------
  function _buildControlList() {
    const s6 = _record?.['step-6'];
    if (!s6) return;

    const rcById       = new Map((_tblData.riskControls || []).map(c => [c.pk_Risk_Control_ID, c]));
    const riskNameById = new Map((_tblData.risks        || []).map(r => [r.pk_Risk_ID, r.risk_name]));

    const seen = new Set();

    const push = (controlId, controlName, source, riskId) => {
      if (seen.has(controlId)) return;
      seen.add(controlId);
      const tbl = rcById.get(controlId);
      _controls.push({
        key:                   controlId,
        name:                  tbl?.jkName      || controlName || controlId,
        objective:             tbl?.jkObjective || '',
        source,
        risk_id:               riskId || '',
        risk_name:             riskNameById.get(riskId) || '',
        implementationEvidence: tbl?.jkImplementationEvidence || ''
      });
    };

    (s6.risk_controls || []).filter(c => c.selected).forEach(c =>
      push(c.control_id, c.control_name, c.control_source || 'EU AI Act', c.risk_id)
    );

    (s6.compliance_additions || []).forEach(c =>
      push(c.control_id, c.control_name, 'Compliance', null)
    );

    (s6.dpia_controls || []).forEach(c => {
      const key = 'DPIA__' + c.control_name;
      if (seen.has(key)) return;
      seen.add(key);
      _controls.push({
        key,
        name:      c.control_name,
        objective: '',
        source:    'DPIA',
        risk_id:   '',
        risk_name: ''
      });
    });
  }

  // ---- Restore saved state ------------------------------------
  function _restoreState() {
    const isFS = c => (c.source || '').includes('Framework');
    _controls.forEach(c => {
      _state[c.key] = { notes: isFS(c) ? (c.implementationEvidence || '') : '', status: 'not_started' };
    });
    const saved = _record?.['step-9']?.controls || [];
    saved.forEach(s => {
      if (_state[s.key] !== undefined) {
        _state[s.key] = { notes: s.notes || '', status: s.status || 'not_started' };
      }
    });

    // Initialise residual state for every risk group
    Object.keys(_residualState).forEach(k => delete _residualState[k]);
    const allRiskIds = new Set(_controls.filter(c => c.risk_id).map(c => c.risk_id));
    allRiskIds.forEach(riskId => { _residualState[riskId] = { likelihood: '', impact: '', justification: '' }; });
    const savedResidual = _record?.['step-9']?.residual_risks || {};
    Object.entries(savedResidual).forEach(([riskId, rr]) => {
      if (_residualState[riskId]) {
        _residualState[riskId] = { likelihood: rr.likelihood || '', impact: rr.impact || '', justification: rr.justification || '' };
      }
    });
  }

  // ---- Render -------------------------------------------------
  function _render() {
    _container.innerHTML = '';
    _injectStyles();

    const card = _el('div', 'step-detail-card');

    const ey = _el('p', `step-detail-eyebrow color-${_colorKey}`);
    ey.textContent = _phaseTitle;
    card.appendChild(ey);

    const title = _el('h2', 'step-detail-title');
    title.textContent = `Step ${_step.number} — ${_step.title}`;
    card.appendChild(title);

    const meta = _el('div', 'step-detail-meta');
    (_step.owners || []).forEach(o => {
      const t = _el('span', 'owner-tag'); t.textContent = o; meta.appendChild(t);
    });
    card.appendChild(meta);

    if (_step.summary) {
      const summ = _el('p', 'step-detail-summary');
      summ.textContent = _step.summary;
      card.appendChild(summ);
    }

    const s6 = _record?.['step-6'];
    if (!s6) {
      const warn = _el('div', 's9-warn');
      warn.innerHTML = '<strong>Step 6 (Control Identification) not yet completed.</strong> Complete and save the control selection before returning to this step.';
      card.appendChild(warn);
      _container.appendChild(card);
      return;
    }

    if (_controls.length === 0) {
      const warn = _el('div', 's9-warn');
      warn.innerHTML = '<strong>No controls found in Step 6.</strong> Return to Step 6 and select at least one control.';
      card.appendChild(warn);
      _container.appendChild(card);
      return;
    }

    card.appendChild(_buildProgressBar());

    const s6rec        = _record['step-6'];
    const riskNameById = new Map((_tblData.risks || []).map(r => [r.pk_Risk_ID, r.risk_name]));

    const riskCtrls = (s6rec.risk_controls || []).filter(c => c.selected);
    const compAdds  = s6rec.compliance_additions || [];
    const dpiaAdds  = s6rec.dpia_controls || [];

    // Risk Team Controls — grouped by risk
    if (riskCtrls.length > 0) {
      card.appendChild(_sectionLabel('Risk Team Controls'));
      const byRisk = new Map();
      riskCtrls.forEach(c => {
        const k = c.risk_id || 'unknown';
        if (!byRisk.has(k)) byRisk.set(k, []);
        byRisk.get(k).push(c);
      });
      let riskAccIdx = 0;
      byRisk.forEach((ctrls, riskId) => {
        const rName = riskNameById.get(riskId);

        const sec = _el('div', 's9-risk-acc');

        // Header button
        const hdr = _el('div', 's9-risk-acc-hdr');

        const left = _el('div', 's9-risk-acc-left');

        const idBadge = _el('span', 's9-risk-acc-id');
        idBadge.textContent = riskId;
        left.appendChild(idBadge);

        const nameSpan = _el('span', 's9-risk-acc-name');
        nameSpan.textContent = rName || riskId;
        left.appendChild(nameSpan);

        const countBadge = _el('span', 's9-risk-acc-count');
        countBadge.textContent = `${ctrls.length} control${ctrls.length !== 1 ? 's' : ''}`;
        left.appendChild(countBadge);

        hdr.appendChild(left);

        const chevron = _el('span', 's9-risk-acc-chevron');
        chevron.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
        hdr.appendChild(chevron);

        sec.appendChild(hdr);

        // Body — all collapsed by default
        const body = _el('div', 's9-risk-acc-body');
        body.classList.add('s9-collapsed');
        chevron.style.transform = 'rotate(-90deg)';

        ctrls.forEach(c => {
          const ctrl = _controls.find(x => x.key === c.control_id);
          if (ctrl) body.appendChild(_buildControlCard(ctrl, 'eu'));
        });
        body.appendChild(_buildResidualRiskPanel(riskId));

        sec.appendChild(body);

        hdr.addEventListener('click', () => {
          const isCollapsed = body.classList.toggle('s9-collapsed');
          chevron.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
        });

        card.appendChild(sec);
        riskAccIdx++;
      });
    }

    // Compliance Additions
    if (compAdds.length > 0) {
      card.appendChild(_sectionLabel(`Compliance Additions (${compAdds.length})`));
      compAdds.forEach(c => {
        const ctrl = _controls.find(x => x.key === c.control_id);
        if (ctrl) card.appendChild(_buildControlCard(ctrl, 'compliance'));
      });
    }

    // DPIA Controls
    if (dpiaAdds.length > 0) {
      card.appendChild(_sectionLabel(`DPIA Controls (${dpiaAdds.length})`));
      dpiaAdds.forEach(c => {
        const key  = 'DPIA__' + c.control_name;
        const ctrl = _controls.find(x => x.key === key);
        if (ctrl) card.appendChild(_buildControlCard(ctrl, 'dpia'));
      });
    }

    card.appendChild(_buildActionRow());
    card.appendChild(_el('div', 's9-results'));

    _container.appendChild(card);
  }

  // ---- Progress bar -------------------------------------------
  function _buildProgressBar() {
    const { evidenced, total } = _progressCounts();
    const pct = total ? Math.round((evidenced / total) * 100) : 0;

    const wrap  = _el('div', 's9-progress-wrap');
    wrap.id = 's9-progress-wrap';

    const meta  = _el('div', 's9-progress-meta');
    const lbl   = _el('span', 's9-progress-lbl');
    lbl.textContent = 'Controls activation progress';
    const count = _el('span', 's9-progress-count');
    count.id = 's9-progress-count';
    count.textContent = `${evidenced} / ${total} controls evidenced`;
    meta.appendChild(lbl); meta.appendChild(count);

    const track = _el('div', 's9-progress-track');
    const fill  = _el('div', 's9-progress-fill');
    fill.id = 's9-progress-fill';
    fill.style.width = pct + '%';
    track.appendChild(fill);

    wrap.appendChild(meta); wrap.appendChild(track);
    return wrap;
  }

  function _progressCounts() {
    const evidenced = _controls.filter(c =>
      _state[c.key]?.status === 'evidence_provided' || _state[c.key]?.status === 'waived'
    ).length;
    return { evidenced, total: _controls.length };
  }

  function _updateProgress() {
    const { evidenced, total } = _progressCounts();
    const pct = total ? Math.round((evidenced / total) * 100) : 0;
    const countEl = _container.querySelector('#s9-progress-count');
    const fillEl  = _container.querySelector('#s9-progress-fill');
    if (countEl) countEl.textContent = `${evidenced} / ${total} controls evidenced`;
    if (fillEl)  fillEl.style.width  = pct + '%';
    const badge = _container.querySelector('#s9-count-badge');
    if (badge) _updateCountBadgeEl(badge);
  }

  // ---- Control card -------------------------------------------
  function _buildControlCard(ctrl, sourceType) {
    const card = _el('div', 's9-ctrl-card');
    card.dataset.key = ctrl.key;

    const st = _state[ctrl.key] || { notes: '', status: 'not_started' };

    // Header: source badge + control name
    const hdr = _el('div', 's9-ctrl-hdr');
    const _ctrlIsFS = (ctrl.source || '').includes('Framework');
    const srcBadge = _el('span', `s9-src-badge s9-src-badge--${_ctrlIsFS ? 'framework' : sourceType}`);
    srcBadge.textContent = _ctrlIsFS ? 'Self-certified' : sourceType === 'eu' ? 'EU AI Act' : sourceType === 'dpia' ? 'DPIA' : 'Compliance';
    hdr.appendChild(srcBadge);
    const name = _el('span', 's9-ctrl-name');
    name.textContent = ctrl.name;
    hdr.appendChild(name);
    card.appendChild(hdr);

    // Objective
    if (ctrl.objective) {
      const objWrap = _el('div', 's9-obj-wrap');
      const objLbl  = _el('span', 's9-field-label');
      objLbl.textContent = 'Objective';
      const objText = _el('p', 's9-ctrl-obj');
      objText.textContent = ctrl.objective;
      objWrap.appendChild(objLbl);
      objWrap.appendChild(objText);
      card.appendChild(objWrap);
    }

    // Evidence / Notes
    const notesWrap = _el('div', 's9-notes-wrap');
    const notesLbl  = _el('label', 's9-field-label');
    notesLbl.textContent = 'Evidence / Notes';
    const textarea = document.createElement('textarea');
    textarea.className   = 's9-ctrl-notes';
    textarea.placeholder = 'Paste Jira ticket URL, PR link, or describe the evidence…';
    textarea.value       = st.notes;
    textarea.rows        = 3;
    textarea.addEventListener('input', () => {
      _state[ctrl.key].notes = textarea.value;
      if (textarea.value.trim() && _state[ctrl.key].status === 'not_started') {
        _state[ctrl.key].status = 'in_progress';
        _syncCard(card, 'in_progress');
        _updateProgress();
      }
    });
    notesWrap.appendChild(notesLbl);
    notesWrap.appendChild(textarea);
    card.appendChild(notesWrap);

    // Status row
    const statusWrap = _el('div', 's9-status-wrap');
    const statusLbl  = _el('label', 's9-field-label');
    statusLbl.textContent = 'Status';

    const select = document.createElement('select');
    select.className   = 's9-status-select';
    STATUS_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value; o.textContent = opt.label;
      if (opt.value === st.status) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => {
      _state[ctrl.key].status = select.value;
      _syncCard(card, select.value);
      _updateProgress();
      if (ctrl.risk_id) _syncResidualPanel(ctrl.risk_id);
    });

    const pill = _el('span', 's9-status-pill');
    _applyPillStyle(pill, st.status);

    statusWrap.appendChild(statusLbl);
    statusWrap.appendChild(select);
    statusWrap.appendChild(pill);
    card.appendChild(statusWrap);

    return card;
  }

  function _syncCard(cardEl, status) {
    const pill = cardEl.querySelector('.s9-status-pill');
    if (pill) _applyPillStyle(pill, status);
    const sel = cardEl.querySelector('.s9-status-select');
    if (sel) sel.value = status;
  }

  function _applyPillStyle(el, status) {
    const opt = STATUS_OPTIONS.find(o => o.value === status);
    const col = STATUS_COLORS[status] || STATUS_COLORS.not_started;
    el.textContent      = opt?.label || status;
    el.style.background = col.bg;
    el.style.color      = col.text;
  }

  // ---- Residual risk panel ------------------------------------
  function _isRiskGroupComplete(riskId) {
    return _controls
      .filter(c => c.risk_id === riskId)
      .every(c => _state[c.key]?.status === 'evidence_provided' || _state[c.key]?.status === 'waived');
  }

  function _syncResidualPanel(riskId) {
    const panel = _container.querySelector(`[data-residual-risk="${riskId}"]`);
    if (!panel) return;
    const complete = _isRiskGroupComplete(riskId);
    panel.classList.toggle('s9-residual--locked', !complete);
    panel.querySelectorAll('select, textarea').forEach(el => { el.disabled = !complete; });
    const note = panel.querySelector('.s9-residual-lock-note');
    if (note) note.style.display = complete ? 'none' : '';
  }

  function _applyResidualLevel(el, likelihood, impact) {
    if (!likelihood || !impact) {
      el.textContent = '—'; el.style.background = '#f1f5f9'; el.style.color = '#94a3b8'; return;
    }
    const level = RISK_MATRIX[likelihood]?.[impact] || '';
    const col   = RESIDUAL_COLORS[level] || { bg: '#f1f5f9', text: '#94a3b8' };
    el.textContent      = level ? level.charAt(0).toUpperCase() + level.slice(1) : '—';
    el.style.background = col.bg;
    el.style.color      = col.text;
  }

  function _buildResidualRiskPanel(riskId) {
    const complete = _isRiskGroupComplete(riskId);
    const saved    = _residualState[riskId] || { likelihood: '', impact: '', justification: '' };

    const panel = _el('div', `s9-residual${complete ? '' : ' s9-residual--locked'}`);
    panel.dataset.residualRisk = riskId;

    // Header
    const hdr  = _el('div', 's9-residual-hdr');
    const ttl  = _el('span', 's9-residual-title'); ttl.textContent = 'Residual Risk Assessment';
    const note = _el('span', 's9-residual-lock-note');
    note.textContent = 'Unlocks when all controls are evidenced or waived';
    note.style.display = complete ? 'none' : '';
    hdr.appendChild(ttl); hdr.appendChild(note);
    panel.appendChild(hdr);

    // Likelihood / Impact / Level row
    const row = _el('div', 's9-residual-row');
    const LEVELS = ['', 'low', 'medium', 'high', 'critical'];

    const levelPill = _el('span', 's9-residual-level-pill');
    _applyResidualLevel(levelPill, saved.likelihood, saved.impact);

    const mkSel = (lbl, currentVal, onChange) => {
      const wrap = _el('div', 's9-residual-field');
      const l    = _el('label', 's9-field-label'); l.textContent = lbl;
      const sel  = document.createElement('select');
      sel.className = 's9-residual-select';
      sel.disabled  = !complete;
      LEVELS.forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v ? v.charAt(0).toUpperCase() + v.slice(1) : '— Select —';
        if (v === currentVal) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => onChange(sel.value));
      wrap.appendChild(l); wrap.appendChild(sel);
      return wrap;
    };

    const lWrap = mkSel('Likelihood', saved.likelihood, v => {
      _residualState[riskId].likelihood = v;
      _applyResidualLevel(levelPill, _residualState[riskId].likelihood, _residualState[riskId].impact);
    });
    const iWrap = mkSel('Impact', saved.impact, v => {
      _residualState[riskId].impact = v;
      _applyResidualLevel(levelPill, _residualState[riskId].likelihood, _residualState[riskId].impact);
    });

    const lvlWrap = _el('div', 's9-residual-field');
    const lvlLbl  = _el('label', 's9-field-label'); lvlLbl.textContent = 'Risk Level';
    lvlWrap.appendChild(lvlLbl); lvlWrap.appendChild(levelPill);

    row.appendChild(lWrap); row.appendChild(iWrap); row.appendChild(lvlWrap);
    panel.appendChild(row);

    // Justification
    const jWrap = _el('div', 's9-residual-just');
    const jLbl  = _el('label', 's9-field-label'); jLbl.textContent = 'Justification';
    const jArea = document.createElement('textarea');
    jArea.className   = 's9-ctrl-notes';
    jArea.placeholder = 'Explain why residual risk is acceptable given the controls in place…';
    jArea.rows        = 2;
    jArea.value       = saved.justification;
    jArea.disabled    = !complete;
    jArea.addEventListener('input', () => { _residualState[riskId].justification = jArea.value; });
    jWrap.appendChild(jLbl); jWrap.appendChild(jArea);
    panel.appendChild(jWrap);

    return panel;
  }

  // ---- Action row ---------------------------------------------
  function _buildActionRow() {
    const row   = _el('div', 'wiz-action-row');
    const left  = _el('div');
    const badge = _el('span', 's9-count-badge');
    badge.id = 's9-count-badge';
    _updateCountBadgeEl(badge);
    left.appendChild(badge);
    row.appendChild(left);

    const right = _el('div');
    const btn   = document.createElement('button');
    btn.className   = 'wiz-btn-primary';
    btn.textContent = 'Save Activation Record';
    btn.addEventListener('click', _handleSave);
    right.appendChild(btn);
    row.appendChild(right);
    return row;
  }

  function _updateCountBadgeEl(el) {
    const { evidenced, total } = _progressCounts();
    el.textContent = `${evidenced} / ${total} controls evidenced`;
    el.className   = evidenced === total
      ? 's9-count-badge s9-count-badge--ok'
      : 's9-count-badge s9-count-badge--warn';
  }

  // ---- Save ---------------------------------------------------
  function _handleSave() {
    const today = new Date().toISOString().slice(0, 10);
    const meta  = _record?._meta || {};

    const controls = _controls.map(c => ({
      key:       c.key,
      name:      c.name,
      objective: c.objective,
      source:    c.source,
      risk_id:   c.risk_id,
      risk_name: c.risk_name,
      notes:     _state[c.key]?.notes  || '',
      status:    _state[c.key]?.status || 'not_started'
    }));

    const { evidenced, total } = _progressCounts();

    // Build residual risk record (only include entries with both likelihood and impact set)
    const residual_risks = {};
    Object.entries(_residualState).forEach(([riskId, rr]) => {
      if (rr.likelihood && rr.impact) {
        residual_risks[riskId] = {
          likelihood:    rr.likelihood,
          impact:        rr.impact,
          level:         RISK_MATRIX[rr.likelihood]?.[rr.impact] || '',
          justification: rr.justification || ''
        };
      }
    });

    const rec9 = {
      step_id:         'step-9',
      step_title:      'Residual risk',
      activation_date: today,
      assessed_by:     meta.assessed_by || '',
      use_case_id:     meta.use_case_id || '',
      total_controls:  total,
      evidenced_count: evidenced,
      controls,
      residual_risks
    };

    if (!_record) _record = { _meta: { schema_version: '1.0', created: new Date().toISOString() } };
    _record._meta.last_modified = new Date().toISOString();
    _record['step-9'] = rec9;
    try { sessionStorage.setItem('ai_workflow_system_record', JSON.stringify(_record)); } catch (_) {}

    _renderResults(rec9);
  }

  function _renderResults(rec) {
    const area = _container.querySelector('.s9-results');
    if (!area) return;
    area.innerHTML = '';
    const card = _el('div', 's9-result-card');
    const h    = _el('h3', 's9-result-title');
    h.textContent = 'Activation Record Saved';
    card.appendChild(h);
    const stats = _el('div', 's9-result-stats');
    [
      [rec.total_controls,                       'Total controls'],
      [rec.evidenced_count,                      'Evidenced / waived'],
      [rec.total_controls - rec.evidenced_count, 'Pending']
    ].forEach(([num, lbl]) => {
      const s = _el('div', 's9-stat');
      const n = _el('span', 's9-stat-num'); n.textContent = String(num); s.appendChild(n);
      const l = _el('span', 's9-stat-lbl'); l.textContent = lbl;           s.appendChild(l);
      stats.appendChild(s);
    });
    card.appendChild(stats);
    const note = _el('p', 's9-result-note');
    note.innerHTML = `Activation record saved. <strong>${rec.evidenced_count} of ${rec.total_controls}</strong> controls evidenced or waived.`;
    card.appendChild(note);
    area.appendChild(card);
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Styles -------------------------------------------------
  let _stylesInjected = false;
  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    if (document.getElementById('s9-styles')) return;
    const s = document.createElement('style');
    s.id = 's9-styles';
    s.textContent = `
.s9-warn{padding:14px 18px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;font-size:13px;color:#92400e;margin:16px 0}

.s9-progress-wrap{margin:20px 0 24px;padding:14px 18px;background:var(--color-bg-secondary,#f8fafc);border:1px solid var(--color-border);border-radius:8px}
.s9-progress-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.s9-progress-lbl{font-size:12px;font-weight:600;color:var(--color-text-secondary)}
.s9-progress-count{font-size:12px;font-weight:700;color:var(--color-text-primary)}
.s9-progress-track{height:8px;background:var(--color-border);border-radius:4px;overflow:hidden}
.s9-progress-fill{height:100%;background:#0d9488;border-radius:4px;transition:width .3s ease}

.s9-risk-acc{border:1px solid var(--color-border);border-radius:8px;overflow:hidden;margin-bottom:10px}
.s9-risk-acc-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--color-bg-subtle,#f8fafc);cursor:pointer;user-select:none;gap:8px}
.s9-risk-acc-hdr:hover{background:var(--color-bg-hover,#f1f5f9)}
.s9-risk-acc-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap}
.s9-risk-acc-id{font-size:10px;font-weight:700;background:#dbeafe;color:#1e40af;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0}
.s9-risk-acc-name{font-size:13px;font-weight:600;color:var(--color-text-primary)}
.s9-risk-acc-count{font-size:11px;font-weight:500;color:var(--color-text-secondary);white-space:nowrap}
.s9-risk-acc-chevron{display:flex;color:var(--color-text-tertiary);flex-shrink:0;transition:transform .2s}
.s9-risk-acc-body{padding:14px;display:flex;flex-direction:column;gap:0}
.s9-collapsed{display:none!important}

.s9-ctrl-card{border:1px solid var(--color-border);border-radius:8px;padding:14px 16px;margin-bottom:10px;background:var(--color-bg)}
.s9-ctrl-hdr{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.s9-ctrl-name{font-size:13px;font-weight:600;color:var(--color-text-primary);flex:1}

.s9-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;margin-top:2px}
.s9-src-badge--eu{background:#dbeafe;color:#1e40af}
.s9-src-badge--compliance{background:#ede9fe;color:#6d28d9}
.s9-src-badge--dpia{background:#ccfbf1;color:#0f766e}
.s9-src-badge--framework{background:#fef3c7;color:#92400e}

.s9-obj-wrap{margin-bottom:10px}
.s9-field-label{display:block;font-size:11px;font-weight:600;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.s9-ctrl-obj{font-size:12px;color:var(--color-text-secondary);margin:0;line-height:1.5}

.s9-notes-wrap{margin-bottom:10px}
.s9-ctrl-notes{width:100%;padding:8px 10px;border:1px solid var(--color-border-mid,#d1d5db);border-radius:6px;font-size:12px;font-family:inherit;color:var(--color-text-primary);background:var(--color-bg);resize:vertical;box-sizing:border-box;line-height:1.5}
.s9-ctrl-notes:focus{outline:none;border-color:#0d9488;box-shadow:0 0 0 2px rgba(13,148,136,.15)}

.s9-status-wrap{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.s9-status-select{padding:5px 8px;border:1px solid var(--color-border-mid,#d1d5db);border-radius:6px;font-size:12px;color:var(--color-text-primary);background:var(--color-bg);cursor:pointer}
.s9-status-pill{font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;white-space:nowrap}

.s9-count-badge{font-size:12px;font-weight:600;padding:4px 10px;border-radius:6px}
.s9-count-badge--ok{background:#dcfce7;color:#166534}
.s9-count-badge--warn{background:#fef3c7;color:#92400e}

.s9-result-card{margin-top:20px;padding:16px 20px;background:var(--color-bg-secondary,#f8fafc);border:1px solid var(--color-border);border-radius:8px}
.s9-result-title{font-size:14px;font-weight:700;color:var(--color-text-primary);margin:0 0 12px}
.s9-result-stats{display:flex;gap:20px;margin-bottom:10px;flex-wrap:wrap}
.s9-stat{display:flex;flex-direction:column;align-items:center;min-width:80px}
.s9-stat-num{font-size:22px;font-weight:800;color:#0d9488}
.s9-stat-lbl{font-size:11px;color:var(--color-text-secondary);text-align:center}
.s9-result-note{font-size:13px;color:var(--color-text-secondary);margin:0}

.s9-residual{margin:12px 0 0;padding:12px 14px;border:1px solid #99f6e4;border-radius:8px;background:#f0fdfa}
.s9-residual--locked{background:#f8fafc;border-color:#e2e8f0;opacity:.75;pointer-events:none}
.s9-residual--locked .s9-residual-title{color:var(--color-text-tertiary)}
.s9-residual-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.s9-residual-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#0f766e}
.s9-residual-lock-note{font-size:10px;color:var(--color-text-tertiary);font-style:italic}
.s9-residual-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}
.s9-residual-field{display:flex;flex-direction:column;gap:4px}
.s9-residual-select{padding:5px 8px;border:1px solid var(--color-border-mid,#d1d5db);border-radius:5px;font-size:12px;font-family:inherit;background:var(--color-bg,#fff);color:var(--color-text-primary);cursor:pointer;min-width:120px}
.s9-residual-select:disabled{background:var(--color-bg-subtle,#f8fafc);cursor:default}
.s9-residual-level-pill{display:inline-block;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;text-align:center;min-width:70px}
.s9-residual-just{margin-top:0}
    `;
    document.head.appendChild(s);
  }

  // ---- Utilities ----------------------------------------------
  function _el(tag, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  function _sectionLabel(text) {
    const p = document.createElement('p');
    p.className = 'section-label'; p.textContent = text; return p;
  }

})();
