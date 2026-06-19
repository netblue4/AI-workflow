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
        key:       controlId,
        name:      tbl?.jkName      || controlName || controlId,
        objective: tbl?.jkObjective || '',
        source,
        risk_id:   riskId || '',
        risk_name: riskNameById.get(riskId) || ''
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
    _controls.forEach(c => {
      _state[c.key] = { notes: '', status: 'not_started' };
    });
    const saved = _record?.['step-9']?.controls || [];
    saved.forEach(s => {
      if (_state[s.key] !== undefined) {
        _state[s.key] = { notes: s.notes || '', status: s.status || 'not_started' };
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
      byRisk.forEach((ctrls, riskId) => {
        const rName = riskNameById.get(riskId);
        const grp    = _el('div', 's9-risk-group');
        const grpHdr = _el('div', 's9-risk-group-hdr');
        grpHdr.textContent = rName ? `${riskId} — ${rName}` : riskId;
        grp.appendChild(grpHdr);
        ctrls.forEach(c => {
          const ctrl = _controls.find(x => x.key === c.control_id);
          if (ctrl) grp.appendChild(_buildControlCard(ctrl, 'eu'));
        });
        card.appendChild(grp);
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
    const srcBadge = _el('span', `s9-src-badge s9-src-badge--${sourceType}`);
    srcBadge.textContent = sourceType === 'eu' ? 'EU AI Act' : sourceType === 'dpia' ? 'DPIA' : 'Compliance';
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

    const rec9 = {
      step_id:         'step-9',
      step_title:      'Operational controls activation',
      activation_date: today,
      assessed_by:     meta.assessed_by || '',
      use_case_id:     meta.use_case_id || '',
      total_controls:  total,
      evidenced_count: evidenced,
      controls
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

.s9-risk-group{margin-bottom:20px}
.s9-risk-group-hdr{font-size:11px;font-weight:700;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.05em;padding:6px 0 8px;border-bottom:1px solid var(--color-border);margin-bottom:10px}

.s9-ctrl-card{border:1px solid var(--color-border);border-radius:8px;padding:14px 16px;margin-bottom:10px;background:var(--color-bg)}
.s9-ctrl-hdr{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.s9-ctrl-name{font-size:13px;font-weight:600;color:var(--color-text-primary);flex:1}

.s9-src-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;flex-shrink:0;margin-top:2px}
.s9-src-badge--eu{background:#dbeafe;color:#1e40af}
.s9-src-badge--compliance{background:#ede9fe;color:#6d28d9}
.s9-src-badge--dpia{background:#ccfbf1;color:#0f766e}

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
