# AGENTS.md

Welcome, Agent. This repository contains **EpochToDo**, a context-switching optimized task manager built with Electron, React, and TypeScript.

## 🛠 Commands

| Task | Command |
|------|---------|
| **Development** | `npm run dev` |
| **Build** | `npm run build` |
| **Lint** | `npm run lint` |
| **Test** | No test runner configured. Use `npm run lint` for static analysis. |

### Single Test Execution
Currently, no test suite is implemented. If tests are added (e.g., via Vitest), the recommended pattern for single tests is `npx vitest -t "test name"`.

---

## 🎨 Code Style Guidelines

### 1. General Principles
- **TypeScript First**: Use strict typing. Avoid `any`. Use interfaces for data models and props.
- **Atomic Commits**: Small, focused commits following Conventional Commits (e.g., `feat:`, `fix:`, `refactor:`).
- **Proactive Verification**: Always run `npm run lint` before completing tasks.

### 2. Imports & Exports
- **ESM Only**: The project uses `"type": "module"`. Use `import`/`export`.
- **Order**:
    1. React and standard library.
    2. External dependencies (`lucide-react`, `zustand`, etc.).
    3. Internal shared types (`@/shared/types`).
    4. Internal components/hooks/services.
- **Exports**: Prefer named exports for utilities and services; default exports are acceptable for components.

### 3. React & Frontend (src/renderer)
- **Components**: Functional components only. Use PascalCase for filenames and component names.
- **Styling**: Use **Tailwind CSS**. Prefer `clsx` and `tailwind-merge` for conditional classes.
- **State Management**: Use **Zustand** (see `src/store/useStore.ts`).
- **Icons**: Use **Lucide React**.

### 4. Electron & Main Process (electron/)
- **Architecture**: Strict separation between Main and Renderer.
- **IPC**: All communication must go through `electron/preload.ts`.
    - Main: `ipcMain.handle` or `ipcMain.on`.
    - Renderer: Access via `window.api`.
- **Database**: **SQLite** via `better-sqlite3` and `kysely`.
    - Schema: `electron/db/schema.ts`.
    - Services: `electron/db/service.ts`.

### 5. Naming Conventions
- **Variables/Functions**: `camelCase`.
- **Components**: `PascalCase`.
- **Types/Interfaces**: `PascalCase`.
- **Files**:
    - Components: `PascalCase.tsx`.
    - Hooks: `useCamelCase.ts`.
    - Services: `PascalCase.ts`.

### 6. Error Handling
- **Main Process**: Use `try-catch` in IPC handlers. Log errors with `console.error`.
- **Renderer**: Handle async errors gracefully in UI (e.g., showing a toast or modal).

---

## 🏗 Project Structure

- `electron/`: Main process code, database services, and timer logic.
- `src/renderer/`: React frontend (Vite entry point).
- `src/shared/`: Shared TypeScript types and constants.
- `src/store/`: Zustand stores.
- `public/`: Static assets (icons, etc.).

---

## 🛑 Constraints & Must-Dos
- **No `as any`**: Fix type errors properly or define new types in `src/shared/types.ts`.
- **Database Schema**: Always update `electron/db/schema.ts` if modifying the database.
- **IPC Safety**: Never expose raw Electron APIs to the renderer; use the `preload` bridge.
- **Zustand Usage**: Update the store when background tasks (like timers) start or stop to keep the UI in sync.

---

## 🔔 Agent Notification Protocol (OpenCode Hook)
This project implements an external hook server at `http://127.0.0.1:62222/hook`.
- **Requirement**: Agents SHOULD notify this hook upon completing a major task or a multi-step workflow.
- **Utility**: Use `scripts/notify_agent.sh` to trigger the notification.
- **Example**: `bash scripts/notify_agent.sh "Feature Implemented" "Added external hook support to main process."`

---

*This file is maintained for agentic workflows. Update it as project patterns evolve.*
