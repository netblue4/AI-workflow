# AI Workflow — ToDo List

## Open

- [ ] **Check AI Act ↔ Harmonised Standards mapping** — verify that every ART-ID in `tbl_Harmonised_Standards.json` is correctly linked to its intended EU AI Act Article. The internal ART-ID numbering does not correspond directly to Act Article numbers; mapping must be derived from `standard_group` text and cross-referenced against `tbl_AI_Articles.json`. Flag any misclassified standards (see HS-004/HS-005 as first example already fixed).

- [ ] **Step 7 — DPIA: explore reshaping the DPIA to match the risk assessment layout** — ask Claude whether the DPIA wizard can be restyled or restructured to look and feel like the Step 8 risk assessments, for a more consistent user experience across the workflow.

- [ ] **Step 3 → Step 8 — Use classification answers to pre-filter risks** — Step 3 already captures whether the AI use case is classified as high-risk AND whether the organisation is deploying a high-risk AI system. Ask Claude whether these answers can be used to automatically filter or suppress irrelevant risks in the Step 8 risk assessment, reducing noise for lower-risk use cases.

- [ ] **Step 9 — DPIA-identified controls: should they surface in control identification?** — Ask Claude: when the Step 7 DPIA identifies controls that need to be added (e.g. data minimisation, access restrictions), should those controls also be displayed or pre-populated in Step 9 Control Identification and Disclosure Design? Clarify the intended data flow between DPIA outputs and the Step 9 control register.

- [ ] **Review controls linked to OWASP risks** — audit the controls in `tbl_Risk_Controls.json` that are associated with OWASP-sourced risks (`risk_source: "OWASP"`). Assess whether controls are well-formed, appropriately scoped to the OWASP LLM Top 10 threat, and sufficient in coverage.

---

## Completed

_(none yet)_
