/**
 * Framework Mapping Handler — loads tbl_ JSON files and renders a read-only
 * compliance reference table across both compliance dimensions.
 * Columns: AI Act Article | Standard | Requirement | Verification | Internal Std (SR) | Framework Statement
 *
 * Verification        → how the HS requirement is evidenced (test / document / workflow / N-A)
 * Internal Std (SR)   → the internal AI Acceptable Use Standard clause(s) that map to it
 * Framework Statement → governance self-certification by the workflow (FS-*)
 *
 * Rows are clickable (toggle gold highlight). Article / standard groups are
 * visually separated by heavier top borders.
 */

function createFrameworkMapping(sanitizeForId, fieldStoredValue, webappData = null) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';

    // ── Filter state ───────────────────────────────────────────────────────────
    let activeArticleFilter = null;
    let filterPillRow       = null;
    let filterLabel         = null;

    function applyArticleFilter(articleName) {
        activeArticleFilter = articleName;
        const tbody = wrapper.querySelector('tbody');
        if (tbody) {
            tbody.querySelectorAll('tr').forEach(row => {
                const visible = !articleName || row.dataset.article === articleName;
                row.style.display = visible ? '' : 'none';
            });
        }
        if (filterPillRow && filterLabel) {
            if (articleName) {
                filterLabel.textContent = `Filtered: ${articleName}`;
                filterPillRow.style.display = 'flex';
            } else {
                filterPillRow.style.display = 'none';
            }
        }
    }

    // ── Compliance Pathway diagram placeholder ─────────────────────────────────
    const pathwayHolder = document.createElement('div');
    wrapper.appendChild(pathwayHolder);

    let initialActiveTrack = null;
    try {
        const wr = (typeof state !== 'undefined') && state?.capturedData?.['_wizard_classification_result'];
        if (wr) {
            const parsed = typeof wr === 'string' ? JSON.parse(wr) : wr;
            initialActiveTrack = parsed.classification || null;
        }
    } catch (_) {}

    (window._systemClassificationData
        ? Promise.resolve(window._systemClassificationData)
        : fetch('ai_system_classification.json')
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(d => { window._systemClassificationData = d; return d; })
    ).then(classData => {
        if (typeof buildCompliancePathwayDiagram === 'function') {
            pathwayHolder.appendChild(
                buildCompliancePathwayDiagram(classData, {
                    onArticleClick: name => applyArticleFilter(name),
                    activeTrack: initialActiveTrack,
                })
            );
        }
    }).catch(() => {});

    // ── Page header ────────────────────────────────────────────────────────────
    const pageHeader = document.createElement('div');
    pageHeader.style.cssText = 'padding:20px 24px 16px;border-bottom:1px solid #2a2a2a;margin-bottom:16px;';
    pageHeader.innerHTML = `
        <div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#b8963e;margin-bottom:4px;">Framework Mapping</div>
        <div style="font-size:13px;color:#7a7470;">EU AI Act articles mapped to harmonised standards, requirements, and implementation controls.</div>
    `;
    wrapper.appendChild(pageHeader);

    // ── Filter pill row (hidden until active) ──────────────────────────────────
    filterPillRow = document.createElement('div');
    filterPillRow.style.cssText = 'display:none;align-items:center;gap:8px;padding:6px 24px 10px;';

    const filterPill = document.createElement('span');
    filterPill.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:6px',
        'padding:3px 10px', 'background:#1a2035',
        'border:1px solid #b8963e', 'border-radius:20px',
        'font-size:11px', 'color:#e0c97a',
    ].join(';');

    filterLabel = document.createElement('span');

    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '×';
    dismissBtn.style.cssText = 'border:none;background:none;color:#b8963e;cursor:pointer;font-size:14px;padding:0;line-height:1;font-weight:700;';
    dismissBtn.addEventListener('click', () => applyArticleFilter(null));

    filterPill.append(filterLabel, dismissBtn);

    const showAllBtn = document.createElement('button');
    showAllBtn.textContent = 'Show all';
    showAllBtn.style.cssText = 'font-size:11px;color:#666;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;';
    showAllBtn.addEventListener('click', () => applyArticleFilter(null));

    filterPillRow.append(filterPill, showAllBtn);
    wrapper.appendChild(filterPillRow);

    // ── Table container (loading placeholder until data arrives) ───────────────
    const tableContainer = document.createElement('div');
    tableContainer.style.cssText = 'overflow-x:auto;padding:0 8px 24px;';

    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'padding:40px;text-align:center;color:#555;font-size:12px;';
    loadingEl.textContent = 'Loading framework data…';
    tableContainer.appendChild(loadingEl);
    wrapper.appendChild(tableContainer);

    // ── Async data load ────────────────────────────────────────────────────────
    function cachedFetch(url, cacheKey) {
        if (window[cacheKey]) return Promise.resolve(window[cacheKey]);
        return fetch(url)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`); return r.json(); })
            .then(d => { window[cacheKey] = d; return d; });
    }

    Promise.all([
        // Articles were inlined into WizUtils.ARTICLES (tbl_AI_Articles.json was removed)
        Promise.resolve((window.WizUtils && WizUtils.ARTICLES) || []),
        cachedFetch('tbl_Harmonised_Standards.json','_fwHS'),
        cachedFetch('tbl_Test_Controls.json',       '_fwTC'),
        cachedFetch('tbl_AI_SR_Controls.json',      '_fwSR'),
        cachedFetch('tbl_Risk_Controls.json',       '_fwRC'),
    ]).then(([articles, hs, testControls, srControls, riskControls]) => {
        tableContainer.innerHTML = '';
        tableContainer.appendChild(
            buildFWTable(articles, hs, testControls, srControls, riskControls)
        );
    }).catch(err => {
        tableContainer.innerHTML = '';
        const errEl = document.createElement('div');
        errEl.style.cssText = 'padding:40px;text-align:center;color:#c44;font-size:12px;';
        errEl.textContent = `Failed to load framework data: ${err.message}`;
        tableContainer.appendChild(errEl);
    });

    return wrapper;

    // ── Table builder (runs after data loads) ──────────────────────────────────
    function buildFWTable(articles, hs, testControls, srControls, riskControls) {

        // Index each contributor by the HS standard_ref it covers.
        const indexByRef = (rows, refField, keep) => {
            const m = new Map();
            for (const r of (rows || [])) {
                if (keep && !keep(r)) continue;
                for (const ref of splitRefs(r[refField])) {
                    if (!m.has(ref)) m.set(ref, []);
                    m.get(ref).push(r);
                }
            }
            return m;
        };
        const tcByRef = indexByRef(testControls, 'fk_Harmonised_Standard_IDs');
        const srByRef = indexByRef(srControls,   'fk_Harmonised_Standard_IDs');  // internal AI Acceptable Use Standard
        const fsByRef = indexByRef(riskControls, 'fk_Harmonised_Standard_IDs', rc => rc.control_source === 'Framework_Statement');

        // Build nested structure: article → standard_group → HS entries
        // Preserves ordering from tbl_AI_Articles and tbl_Harmonised_Standards
        const frameworkMap = []; // [{articleName, groups:[{groupName, reqs:[...]}]}]

        for (const art of articles) {
            const artHS = hs.filter(h => h.fk_AI_Article_ID === art.pk_AI_Article_ID);
            if (artHS.length === 0) continue;

            // Standard column groups by the descriptive standard_group label
            // (e.g. "[18229-1: Trustworthiness] - Transparency"). Falls back to the
            // family derived from the ref ([18229-1.1] -> 18229-1) if unset.
            const stdFamily = ref => String(ref || '').replace(/[\[\]]/g, '').replace(/\.\d+$/, '');

            const groupOrder = [];
            const groupMap   = new Map();
            for (const h of artHS) {
                const grp = h.standard_group || stdFamily(h.standard_ref);
                if (!groupMap.has(grp)) {
                    groupMap.set(grp, []);
                    groupOrder.push(grp);
                }
                groupMap.get(grp).push({
                    hsRef:          h.standard_ref,
                    hsName:         h.standard_name,
                    coverageType:   h.coverage_type || 'Test',
                    testControls:   tcByRef.get(h.standard_ref) || [],
                    srControls:     srByRef.get(h.standard_ref) || [],
                    fsControls:     fsByRef.get(h.standard_ref) || [],
                });
            }

            frameworkMap.push({
                articleName: art.article_name,
                groups: groupOrder.map(g => ({ groupName: g, reqs: groupMap.get(g) })),
            });
        }

        // ── Render ────────────────────────────────────────────────────────────
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

        // Header
        const thead     = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const columns   = [
            { label: 'AI Act Article',      width: '12%' },
            { label: 'Standard',            width: '19%' },
            { label: 'Requirement',         width: '22%' },
            { label: 'Verification',        width: '16%' },
            { label: 'Internal Std (SR)',   width: '16%' },
            { label: 'Framework Statement', width: '15%' },
        ];
        columns.forEach(col => {
            const th = document.createElement('th');
            th.style.cssText = `
                padding:10px 14px;text-align:left;width:${col.width};
                background:#1e1e1e;color:#b8963e;
                font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;
                border-bottom:2px solid #3d3d3d;border-right:1px solid #2a2a2a;
                position:sticky;top:0;z-index:1;
            `;
            th.textContent = col.label;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody      = document.createElement('tbody');
        let rowIndex     = 0;
        let selectedRow  = null;

        frameworkMap.forEach(({ articleName, groups }) => {
            let isFirstArticleRow = true;

            groups.forEach(({ groupName, reqs }) => {
                let isFirstGroupRow = true;

                reqs.forEach(({ hsRef, hsName, coverageType, testControls: tcs, srControls: srs, fsControls: fss }) => {
                    const isEven  = rowIndex % 2 === 0;
                    const baseBg  = isEven ? '#1a1a1a' : '#161616';

                    const row = document.createElement('tr');
                    row.style.cssText    = `background:${baseBg};cursor:pointer;transition:background 0.15s;`;
                    row.dataset.baseBg   = baseBg;
                    row.dataset.article  = articleName;

                    row.addEventListener('mouseenter', () => {
                        if (selectedRow !== row) row.style.background = '#1e2530';
                    });
                    row.addEventListener('mouseleave', () => {
                        if (selectedRow !== row) row.style.background = row.dataset.baseBg;
                    });
                    row.addEventListener('click', () => {
                        if (selectedRow && selectedRow !== row) {
                            selectedRow.style.background  = selectedRow.dataset.baseBg;
                            selectedRow.style.boxShadow   = '';
                        }
                        if (selectedRow === row) {
                            row.style.background = row.dataset.baseBg;
                            row.style.boxShadow  = '';
                            selectedRow = null;
                        } else {
                            row.style.background = '#1a2530';
                            row.style.boxShadow  = 'inset 3px 0 0 #b8963e';
                            selectedRow = row;
                        }
                    });

                    const topBorder = isFirstArticleRow
                        ? '2px solid #3d3d3d'
                        : isFirstGroupRow
                            ? '1px solid #303030'
                            : '1px solid #252525';

                    const cellBase = `padding:10px 14px;vertical-align:top;line-height:1.5;
                        border-top:${topBorder};border-bottom:1px solid #1f1f1f;border-right:1px solid #252525;`;

                    // Article cell
                    const artCell = document.createElement('td');
                    artCell.style.cssText = cellBase + (isFirstArticleRow
                        ? 'font-weight:600;color:#e0d9ce;border-right:1px solid #2a2a2a;'
                        : 'color:#303030;border-right:1px solid #2a2a2a;');
                    artCell.textContent = isFirstArticleRow ? articleName : '';
                    row.appendChild(artCell);

                    // Standard group cell
                    const grpCell = document.createElement('td');
                    grpCell.style.cssText = cellBase + (isFirstGroupRow
                        ? 'color:#7eb3c8;border-right:1px solid #2a2a2a;'
                        : 'color:#2a3040;border-right:1px solid #2a2a2a;');
                    // groupName is the descriptive standard_group label; render as-is.
                    // Legacy family keys (e.g. "18229-1") still get the PRN prefix.
                    grpCell.textContent = isFirstGroupRow
                        ? (/^\[/.test(groupName) ? groupName
                           : (window.WizUtils ? WizUtils.fmtStdRef('[' + groupName + ']') : groupName))
                        : '';
                    row.appendChild(grpCell);

                    // Requirement cell
                    const reqCell = document.createElement('td');
                    reqCell.style.cssText = cellBase + 'border-right:1px solid #2a2a2a;';
                    reqCell.appendChild(fwBadge(WizUtils.fmtStdRef(hsRef), hsName, '#7eb3ff', '#0d1525', '#1a2a4a'));
                    row.appendChild(reqCell);

                    // Verification cell — depends on how the requirement is evidenced.
                    const tstCell = document.createElement('td');
                    tstCell.style.cssText = cellBase + 'border-right:1px solid #2a2a2a;';
                    if (coverageType === 'Workflow') {
                        tstCell.appendChild(fwBadge('Workflow', 'Evidenced by the governance workflow', '#a9b4ff', '#14152e', '#2c2e5a'));
                    } else if (coverageType === 'Document') {
                        tstCell.appendChild(fwBadge('Document', 'Evidenced by an external document', '#e0b060', '#241a06', '#4a3810'));
                    } else if (coverageType === 'Not_Applicable') {
                        tstCell.appendChild(fwBadge('N/A', 'Not applicable to this system type', '#8a94a6', '#1a1e26', '#333a47'));
                    } else if (tcs.length === 0) {
                        // Test-type with no test control yet — a genuine coverage gap.
                        tstCell.appendChild(fwBadge('Gap', 'No test control yet', '#f0857a', '#2a1210', '#4a201c'));
                    } else {
                        tcs.forEach(tc => {
                            tstCell.appendChild(fwBadge(tc.control_ref, tc.jkName, '#34d399', '#0f2520', '#1a3830'));
                        });
                    }
                    row.appendChild(tstCell);

                    // Internal Standard (SR) cell — the AI Acceptable Use Standard clause(s).
                    const srCell = document.createElement('td');
                    srCell.style.cssText = cellBase + 'border-right:1px solid #2a2a2a;';
                    if (srs.length) {
                        srs.forEach(sr => srCell.appendChild(fwBadge(sr.groupstandard_ref, sr.control_name, '#5ec8c0', '#0c2321', '#1a3a37')));
                    } else { srCell.style.color = '#303030'; srCell.textContent = '—'; }
                    row.appendChild(srCell);

                    // Framework Statement cell — governance self-certification by the workflow.
                    const fsCell = document.createElement('td');
                    fsCell.style.cssText = cellBase;
                    if (fss.length) {
                        fss.forEach(fs => fsCell.appendChild(fwBadge(fs.pk_Risk_Control_ID, fs.jkName, '#b79cff', '#181433', '#312a56')));
                    } else { fsCell.style.color = '#303030'; fsCell.textContent = '—'; }
                    row.appendChild(fsCell);

                    tbody.appendChild(row);

                    isFirstArticleRow = false;
                    isFirstGroupRow   = false;
                    rowIndex++;
                });
            });
        });

        table.appendChild(tbody);
        return table;
    }
}

// ── Shared badge helper ────────────────────────────────────────────────────────
function fwBadge(id, name, numColor, numBg, numBorder) {
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:8px;';

    if (id) {
        const badge = document.createElement('span');
        badge.style.cssText = `
            display:inline-block;font-size:10px;font-weight:700;
            color:${numColor};background:${numBg};border:1px solid ${numBorder};
            border-radius:4px;padding:1px 6px;margin-bottom:3px;white-space:nowrap;
        `;
        badge.textContent = id;
        div.appendChild(badge);
    }

    if (name) {
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:11px;color:#c4bdb5;line-height:1.4;';
        nameEl.textContent = name;
        div.appendChild(nameEl);
    }

    return div;
}

// ── Split comma-separated HS ref string ───────────────────────────────────────
function splitRefs(str) {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
}
