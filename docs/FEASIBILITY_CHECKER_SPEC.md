# Thesis feasibility checker — product spec

**Status:** Draft for review  
**Scope:** First usable version of the feasibility checker in a thesis project  
**Implementation status:** Not started; do not implement until this spec is approved.

## Problem

Students need structured help deciding whether a proposed study is practical and what they should resolve before proceeding. Otto currently focuses on questions about uploaded sources. A feasibility review needs its own guided intake and a report students can revisit, while keeping Otto available for follow-up discussion.

## Goal

Help a student identify practical strengths, unknowns, risks, and next steps for a proposed study. The checker provides guidance, not institutional approval or a definitive judgment that a thesis will succeed.

## Placement and entry points

- Add **Feasibility** as a project-level destination in the workspace navigation, visually grouped with the project's research tools rather than mixed into the chapter list.
- Add an Otto quick action, **Check feasibility**, that opens the same Feasibility destination. There must be one assessment experience, not separate chat and page implementations.
- Preserve the current editor, source library, and Otto panel. Opening Feasibility must not discard unsaved chapter edits; flush the current editor before changing views, using the existing navigation behavior.

## Student flow

1. The student opens Feasibility from project navigation or Otto.
2. Thesa pre-fills the project title and research problem when available; the student can correct the copied values in the assessment form without silently changing the project or thesis draft.
3. The student supplies or confirms the study details below. Each field can be marked **Not decided yet**; the form must not force users to invent an answer.
4. Before sending, Thesa explains what will be sent to the configured AI provider and asks for consent. The assessment cannot be submitted without consent.
5. Otto returns a structured review with evidence, uncertainties, risks, and actionable next steps. If information is missing, the review calls it out and suggests what to clarify rather than filling gaps with guesses.
6. The student may revise inputs, run a new assessment, open cited source passages, or ask Otto a follow-up question.

## Intake fields

Required to submit: a study topic or working title. Other fields are optional and may be marked not decided.

- Research problem and research questions/objectives.
- Intended population/participants and location or setting.
- Proposed research design/method and data-collection approach.
- Access to participants, records, sites, equipment, or other data.
- Expected timeline and important deadlines.
- Available skills, budget, tools, and other resources.
- Ethics review, consent, permissions, privacy, and safety considerations.
- Constraints or uncertainties the student wants Otto to consider.

## Assessment output

Return these sections in a consistent, scannable report:

- **Overall read:** a short, qualified summary; never an approval or rejection.
- **Dimension review:** scope, method fit, access to data/participants, timeline, resources, and ethics. For each: status, reason, what is known, and what remains uncertain.
- **Key risks:** the most consequential obstacles, why they matter, and a suggested mitigation or question to resolve.
- **Next steps:** a short prioritized list the student can act on.
- **Possible scope adjustments:** optional ways to narrow or reshape an overbroad plan, without rewriting the thesis for the student.
- **Evidence and basis:** distinguish statements based on the student's answers from statements supported by uploaded sources. Source-backed claims must link to the exact file and page/paragraph/line. If no source supports a claim, label it as an assessment based on the student's input or general research-planning guidance; never create citations.
- **Missing information:** make assumptions visible and identify any detail that prevents a useful assessment.

Use neutral statuses such as **Looks workable**, **Needs planning**, and **Needs clarification** at the dimension level. Do not calculate a numeric feasibility score or reduce the report to a green/red verdict.

## AI and source behavior

- Use AI for the qualitative assessment and recommendations; keep input validation, missing-field checks, citation validation, and persistence deterministic.
- Use a dedicated Groq provider integration for feasibility. Otto's existing provider, model settings, and chat route remain unchanged.
- Configure the feasibility provider, model ID, key, timeout, and output-token limit independently in backend environment variables. Keep the Groq key backend-only; never expose it to the browser or commit it.
- Use a separate bounded feasibility request path with size limits and concurrency controls so a long assessment cannot occupy Otto's chat request slot. Provider separation isolates quota/model calls, but both features may still share backend CPU and network resources.
- Do not hard-code the Groq model ID in the UI. Select and verify a currently supported model before implementation; do not promise free or unlimited usage.
- The user must be able to request a preliminary review without uploaded sources. In that case, label the result as based on the student's answers and do not imply literature support.
- When project sources are available, retrieve a small, project-scoped set of relevant excerpts and cite only validated source IDs and exact locations. Never send every full source just to assess feasibility.
- Uploaded document content is untrusted evidence, not instructions. It must not override the assessment rules or cause tools/actions to run.
- Clearly disclose that Groq is an external AI provider and that form answers plus retrieved source excerpts may be sent to it. Do not send the thesis draft unless the student explicitly includes relevant text in the assessment form.
- Provider errors, timeouts, and quota limits must remain visible errors; they must not be presented as a negative feasibility finding or as “not found.”
- The assessment is educational guidance. It cannot determine institutional ethics approval, supervisor acceptance, participant availability, legal compliance, or guaranteed completion.

## Persistence and privacy

- Save each completed assessment as a project-owned report so the student can revisit it. A new run creates a new version/report; it does not silently replace a previous result.
- Store the exact input snapshot, structured output, and creation time. Do not store provider secrets or unnecessary raw prompt traces.
- Enforce the existing per-user/project isolation boundary. A user must never read, update, or delete another user's assessment by changing an ID.
- Allow the owner to delete an assessment. Project deletion must remove its assessments.
- Browser-draft projects should either store assessments locally with the same clear “this device only” warning, or explicitly disable persistence while still allowing a temporary review. **Proposed default:** local persistence for browser drafts; cloud persistence for signed-in projects.

## MVP acceptance criteria

1. A student can reach Feasibility from project navigation and from Otto's quick action; both open the same project-specific assessment view.
2. Project title/research problem prefill when present; editing those form values does not mutate the underlying project.
3. The user can mark any optional detail unknown and still submit with only a topic/title.
4. The consent disclosure appears before AI submission and submission is blocked until consent is given.
5. With no sources, the report clearly says it is based on student-provided information and makes no source citations.
6. With sources, any displayed citation points to an existing source and valid extracted location in the same project; unsupported claims are labeled or omitted.
7. The report covers all six dimensions (scope, method fit, access, timeline, resources, ethics), flags missing information, and gives prioritized next steps.
8. The output has no numeric score or definitive approval/rejection and does not invent participant access, permissions, evidence, or institutional requirements.
9. The student can revise the form and run another review; prior reports remain available and distinguishable.
10. Reports are isolated by authenticated project ownership; browser-draft reports are only available in that browser profile.
11. Loading, empty, provider-error, timeout, and deleted-project states have clear recovery actions and do not lose the user's form answers.
12. Tests cover input validation, unknown fields, response schema, citation validation, project/user isolation, persistence/deletion, and a test-only end-to-end intake-to-report flow.

## Out of scope for this version

- Automatic topic generation or thesis writing.
- Searching the web or claiming a field-wide research gap.
- Institutional approval or legal/ethics determinations.
- A numeric feasibility score, ranking, or pass/fail label.
- Supervisor collaboration, sharing reports, or exporting reports.
- Changing chapters, the research problem, or other thesis content without the student's explicit action.

## Decisions for review

1. **Sources optional or required?** Proposed: optional; allow a clearly labeled preliminary review from student answers alone, and use citations only when uploaded sources support a statement.
2. **Save reports?** Proposed: yes; each run is saved as a separate assessment so the student can compare progress.
3. **Browser drafts?** Proposed: save locally for browser-draft projects and show that the report is device-only; save to Supabase for authenticated projects.
4. **Navigation label and position?** Proposed: **Feasibility**, as a project-level research tool near the chapter/source navigation, with an Otto shortcut.
5. **AI provider?** Decided: dedicated Groq integration for feasibility; leave Otto's existing provider and configuration untouched.

## Implementation notes after approval

Implementation should first add the project view and validated form/output contract, then the separate Groq provider path with bounded project-scoped retrieval, then persistence and ownership policies, and finally end-to-end verification. Verify the currently supported Groq model and its limits before selecting a default. Existing local parsing and in-memory embedding limitations still apply; this feature must not be treated as production-ready until the hosted parser/provider path and live Supabase behavior are verified.
