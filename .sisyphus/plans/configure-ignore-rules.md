# Configure Ignore Rules for OpenCode

## TL;DR

> **Quick Summary**: Create a `.cursorignore` (or `.codeignore` as fallback if needed) file to override default `.gitignore` behavior for AI indexing. This allows `mydocs/` to be indexed by OpenCode (referenced with `@`) while remaining ignored by Git.
> 
> **Deliverables**:
> - A `.cursorignore` file in the root directory.
> - Content configuring exceptions for `mydocs/`.
> 
> **Estimated Effort**: Trivial
> **Parallel Execution**: Sequential

---

## Context

### Original Request
User wants to reference files in `mydocs/` using `@` in OpenCode, but `mydocs/` is listed in `.gitignore` to prevent uploading to GitHub.

### Research Findings
- OpenCode (and Cursor) typically use `.gitignore` for indexing by default.
- However, they often support a specific ignore file (usually `.cursorignore`) that takes precedence over `.gitignore` for *AI context indexing*.
- If `.cursorignore` exists, the AI indexer uses IT instead of `.gitignore` (or in addition to, depending on implementation).
- Strategy: Create a `.cursorignore` that explicitly does NOT ignore `mydocs/` (or lists everything else needed).
- **Hypothesis**: Creating a `.cursorignore` file allows us to define a separate set of rules for the AI, independent of Git.

---

## Work Objectives

### Core Objective
Enable AI indexing for `mydocs/` without changing `.gitignore`.

### Concrete Deliverables
- `.cursorignore` file

### Definition of Done
- [ ] `.cursorignore` exists.
- [ ] `mydocs/` is NOT ignored in `.cursorignore`.
- [ ] AI can index `mydocs/` (verified by user, as I cannot test UI features).

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Agent-Executed QA Scenarios

**File Existence Verification**
```
Scenario: Verify .cursorignore creation
  Tool: Bash
  Steps:
    1. ls -F .cursorignore
    2. Assert: File exists
    3. cat .cursorignore
    4. Assert: Content is correct (empty or specific rules)
  Expected Result: File exists
```

---

## TODOs

- [ ] 1. Create .cursorignore

  **What to do**:
  1. Create a file named `.cursorignore` in the root directory.
  2. Populate it with rules.
     - **Option A (Recommended)**: If `.cursorignore` *replacing* `.gitignore` for AI, then we should list what we *actually* want to ignore (e.g., `node_modules/`, `.git/`, `dist/`), but OMIT `mydocs/`.
     - **Option B (Unignore syntax)**: If it supplements, maybe `!mydocs/`.
     - **Best Guess Strategy**: Copy content of `.gitignore` to `.cursorignore` BUT remove `mydocs` from it. This ensures AI ignores `node_modules` etc., but indexes `mydocs`.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`write`]

  **Acceptance Criteria**:
  - [ ] `.cursorignore` created.
  - [ ] Content mirrors `.gitignore` minus `mydocs`.

- [ ] 2. (Optional) Check for .codeignore

  **What to do**:
  1. If OpenCode uses a different file (like `.codeignore`), create that as well just in case (same content).
  2. For now, `.cursorignore` is the standard for Cursor-based/OpenCode environments.

  **Recommended Agent Profile**:
  - **Category**: `quick`

  **Acceptance Criteria**:
  - [ ] (Optional) Duplicate as `.codeignore` if needed.

---

## Success Criteria

### Final Checklist
- [ ] `.cursorignore` created with `mydocs` removed from the list.
- [ ] User confirms `@mydocs` works (manual step).
