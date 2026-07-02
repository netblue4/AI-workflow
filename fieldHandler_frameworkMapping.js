/**
 * Framework Mapping Handler — loads tbl_ JSON files and renders a read-only
 * compliance reference table.
 * Columns: AI Act Article | Standard | Requirement | Define | Build | Test
 *
 * Define  → Framework_Statement controls (FS-*)
 * Build   → Harmonised_Standard risk controls
 * Test    → tbl_Test_Controls entries
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
        cachedFetch('tbl_Risk_Controls.json',       '_fwRC'),
        cachedFetch('tbl_Test_Controls.json',       '_fwTC'),
    ]).then(([articles, hs, riskControls, testControls]) => {
        tableContainer.innerHTML = '';
        tableContainer.appendChild(
            buildFWTable(articles, hs, riskControls, testControls)
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
    function buildFWTable(articles, hs, riskControls, testControls) {

        // Index risk controls by each HS standard_ref they cover
        const rcByRef  = new Map(); // standard_ref → RiskControl[]
        const tcByRef  = new Map(); // standard_ref → TestControl[]

        for (const rc of riskControls) {
            const refs = splitRefs(rc.fk_Harmonised_Standard_IDs);
            for (const ref of refs) {
                if (!rcByRef.has(ref)) rcByRef.set(ref, []);
                rcByRef.get(ref).push(rc);
            }
        }

        for (const tc of testControls) {
            const refs = splitRefs(tc.fk_Harmonised_Standard_IDs);
            for (const ref of refs) {
                if (!tcByRef.has(ref)) tcByRef.set(ref, []);
                tcByRef.get(ref).push(tc);
            }
        }

        // Build nested structure: article → standard_group → HS entries
        // Preserves ordering from tbl_AI_Articles and tbl_Harmonised_Standards
        const frameworkMap = []; // [{articleName, groups:[{groupName, reqs:[...]}]}]

        for (const art of articles) {
            const artHS = hs.filter(h => h.fk_AI_Article_ID === art.pk_AI_Article_ID);
            if (artHS.length === 0) continue;

            const groupOrder = [];
            const groupMap   = new Map();
            for (const h of artHS) {
                if (!groupMap.has(h.standard_group)) {
                    groupMap.set(h.standard_group, []);
                    groupOrder.push(h.standard_group);
                }
                const rcs = rcByRef.get(h.standard_ref) || [];
                groupMap.get(h.standard_group).push({
                    hsRef:          h.standard_ref,
                    hsName:         h.standard_name,
                    defineControls: rcs.filter(r => r.control_source === 'Framework_Statement'),
                    buildControls:  rcs.filter(r => r.control_source !== 'Framework_Statement'),
                    testControls:   tcByRef.get(h.standard_ref) || [],
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
            { label: 'AI Act Article', width: '15%' },
            { label: 'Standard',       width: '18%' },
            { label: 'Requirement',    width: '17%' },
            { label: 'Define',         width: '16%' },
            { label: 'Build',          width: '17%' },
            { label: 'Test',           width: '17%' },
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

                reqs.forEach(({ hsRef, hsName, defineControls, buildControls, testControls: tcs }) => {
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
                    grpCell.textContent = isFirstGroupRow ? groupName : '';
                    row.appendChild(grpCell);

                    // Requirement cell
                    const reqCell = document.createElement('td');
                    reqCell.style.cssText = cellBase + 'border-right:1px solid #2a2a2a;';
                    reqCell.appendChild(fwBadge(WizUtils.fmtStdRef(hsRef), hsName, '#7eb3ff', '#0d1525', '#1a2a4a'));
                    row.appendChild(reqCell);

                    // Define cell — Framework_Statement controls
                    const defCell = document.createElement('td');
                    defCell.style.cssText = cellBase + 'border-right:1px solid #2a2a2a;';
                    if (defineControls.length === 0) {
                        defCell.style.color = '#303030';
                        defCell.textContent = '—';
                    } else {
                        defineControls.forEach(rc => {
                            defCell.appendChild(fwBadge(rc.pk_Risk_Control_ID, rc.jkName, '#b8963e', '#1a1500', '#3d2e00'));
                        });
                    }
                    row.appendChild(defCell);

                    // Build cell — Harmonised_Standard risk controls
                    const bldCell = document.createElement('td');
                    bldCell.style.cssText = cellBase + 'border-right:1px solid #2a2a2a;';
                    if (buildControls.length === 0) {
                        bldCell.style.color = '#303030';
                        bldCell.textContent = '—';
                    } else {
                        buildControls.forEach(rc => {
                            bldCell.appendChild(fwBadge(rc.pk_Risk_Control_ID, rc.jkName, '#a78bfa', '#1e1a35', '#2e2850'));
                        });
                    }
                    row.appendChild(bldCell);

                    // Test cell
                    const tstCell = document.createElement('td');
                    tstCell.style.cssText = cellBase;
                    if (tcs.length === 0) {
                        tstCell.style.color = '#303030';
                        tstCell.textContent = '—';
                    } else {
                        tcs.forEach(tc => {
                            tstCell.appendChild(fwBadge(tc.control_ref, tc.jkName, '#34d399', '#0f2520', '#1a3830'));
                        });
                    }
                    row.appendChild(tstCell);

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
