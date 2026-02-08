# Update Features & Sync Repos

## TL;DR

> **Quick Summary**: Document the webhook reminder feature (port 62222) in `Features.md`, locate and document the new VS Code extension, and sync all changes to both private and public git repositories.
> 
> **Deliverables**:
> - Updated `Features.md` with Webhook and VS Code Extension details.
> - Git commit with all changes.
> - Code pushed to all configured remotes.
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: Sequential

---

## Context

### Original Request
1. Update `Features.md` with Webhook details.
2. Sync changes to private and public libraries.
3. Add/Document the VS Code plugin (already in folder).

### Research Findings
- **Webhook**: Listens on `http://127.0.0.1:62222/hook`.
- **Payload**: JSON `{ "title": "...", "message": "..." }` or training data `{ "task_id": ..., "eta": ... }`.
- **VS Code Extension**: User stated it's in the folder. Need to locate it.

---

## Work Objectives

### Core Objective
Document new features and ensure code is synced to all repositories.

### Concrete Deliverables
- `Features.md` (updated or created)
- Git commit hash

### Definition of Done
- [ ] `Features.md` contains "Webhook Integration" section.
- [ ] `git push` completes successfully for all remotes.

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Agent-Executed QA Scenarios

**Documentation Verification**
```
Scenario: Verify Features.md content
  Tool: Bash (grep)
  Steps:
    1. cat Features.md
    2. Assert: Output contains "Webhook Integration"
    3. Assert: Output contains "62222"
    4. Assert: Output contains "VS Code Extension"
  Expected Result: File contains new sections
```

**Git Verification**
```
Scenario: Verify Git Push
  Tool: Bash
  Steps:
    1. git log -1 --pretty=%B
    2. Assert: Output contains "feat: update features"
    3. git remote -v
    4. Assert: Output lists multiple remotes (if applicable)
  Expected Result: Commit exists and remotes are listed
```

---

## TODOs

- [ ] 1. Locate and Document Features

  **What to do**:
  1. Check if `Features.md` exists. If not, create it.
  2. Append "Webhook Integration" section details (Port 62222, `/hook`, JSON format).
  3. Find the VS Code extension folder (look for `package.json` with `engines.vscode` or directory named `vscode-extension` etc.).
  4. Append "VS Code Extension" section to `Features.md`, describing its location and purpose (sending debug events to webhook).

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: [`docx`, `git-master`]

  **Acceptance Criteria**:
  - [ ] `Features.md` exists
  - [ ] `Features.md` contains "Webhook Integration"
  - [ ] `Features.md` contains "VS Code Extension"

- [ ] 2. Sync to Repositories

  **What to do**:
  1. Run `git add .` to stage `Features.md` and the new extension folder.
  2. Run `git commit -m "feat: update features and add vscode extension"`.
  3. Run `git remote` to list all remotes.
  4. Loop through each remote and run `git push <remote> main` (or current branch).

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`git-master`]

  **Acceptance Criteria**:
  - [ ] `git status` is clean
  - [ ] `git push` executed for all remotes

---

## Success Criteria

### Final Checklist
- [ ] Features.md updated
- [ ] VS Code extension documented
- [ ] Changes pushed to all remotes
