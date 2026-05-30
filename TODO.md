# AI Workflow — ToDo List

## Open

- [ ] **ART-011 (Art.43 Conformity Assessment) — consider replacing standard source** — HS-081 to HS-085 currently use `[18286.16–20]` (prEN 18286 QMS sub-references) to describe conformity assessment requirements. The dedicated official standard is **ISO/IEC 42006** (AI Management System Auditors, currently at DIS stage). Review whether to rebase ART-011 entries onto 42006 clauses once that standard is published, or keep the current 18286-derived content as an interim measure.

- [ ] **Step 7 — DPIA: explore reshaping the DPIA to match the risk assessment layout** — ask Claude whether the DPIA wizard can be restyled or restructured to look and feel like the Step 8 risk assessments, for a more consistent user experience across the workflow.

- [ ] **Step 3 → Step 8 — Use classification answers to pre-filter risks** — Step 3 already captures whether the AI use case is classified as high-risk AND whether the organisation is deploying a high-risk AI system. Ask Claude whether these answers can be used to automatically filter or suppress irrelevant risks in the Step 8 risk assessment, reducing noise for lower-risk use cases.

- [ ] **Step 9 — DPIA-identified controls: should they surface in control identification?** — Ask Claude: when the Step 7 DPIA identifies controls that need to be added (e.g. data minimisation, access restrictions), should those controls also be displayed or pre-populated in Step 9 Control Identification and Disclosure Design? Clarify the intended data flow between DPIA outputs and the Step 9 control register.

- [x] **Review controls linked to OWASP risks** — completed. All 25 OWASP controls now carry `standard_ref` values mapped to the appropriate prEN harmonised standard clauses (prEN 18282 Cybersecurity, prEN 18229-1/2 Trustworthiness, prEN 18283 Bias, prEN 18284 Data Governance, prEN ISO/IEC 24970 Logging, ISO/IEC 42001 AI Management). Three stale `[24368.x]` references on RISK-019 controls also corrected to `[12792.x]`.

---

## Completed

- [x] **Check AI Act ↔ Harmonised Standards mapping** — completed. Three issues found and resolved: (1) HS-004/005 `[18229-1.4–5]` logging standards moved from ART-001 (Art.13) → ART-005 (Art.12); (2) ART-012 (Art.50) standard refs corrected from `[24368.x]` (ISO/IEC TR 24368 — ethics/societal concerns) → `[12792.x]` (prEN ISO/IEC 12792 — Transparency Taxonomy, the correct Art.50 standard); (3) ART-011 (Art.43) noted as using prEN 18286 sub-refs instead of ISO/IEC 42006 — flagged as open item above pending 42006 publication.
