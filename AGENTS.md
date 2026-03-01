# AGENTS.md

Last reviewed: 2026-03-01 (Europe/Paris).

This file defines coding and delivery standards for humans and AI agents working in this repository.

## 1) Scope and goals

- Scope: entire repository (`apps/*`, `packages/*`, root tooling).
- Goal: ship correct, secure, maintainable changes with predictable quality.

## 2) Repo context

- Monorepo: `pnpm` workspaces.
- Language/runtime: TypeScript, Node.js, React + Vite.
- Current core validation commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`

## 3) Non-negotiable rules

- Keep TypeScript strict mode enabled.
- Do not use `any` unless unavoidable; prefer `unknown` and explicit narrowing.
- Do not hardcode secrets or credentials in code, tests, config, logs, or examples.
- Validate all untrusted input at boundaries (HTTP, socket events, third-party callbacks).
- Keep commits and pull requests focused and reviewable.
- Any user-visible or behavior-affecting change must include tests or a justified testing note.

## 4) Coding practices

### 4.1 TypeScript

- Preserve `"strict": true` in tsconfig.
- Prefer precise types on exported APIs (avoid broad unions/`object`/`any`).
- Model domain objects with explicit interfaces/types.
- Keep modules small and single-purpose.
- Prefer total functions: explicit return paths and clear error handling.
- Use exhaustive checks for discriminated unions (`never` guard patterns).

### 4.2 React (apps/web)

- Keep components pure: same props/state => same output.
- Do not use `useEffect` for render-time derivations; compute during render or memoize.
- Use Effects only for synchronization with external systems.
- Keep state minimal; derive computed values when possible.
- Prioritize accessibility in interactive UI (semantic elements, labels, keyboard support).

### 4.3 Node server (apps/server)

- Avoid blocking the event loop or worker pool with CPU-heavy synchronous work.
- Keep request/handler callbacks short and bounded.
- Prefer asynchronous APIs over synchronous filesystem/crypto operations in hot paths.
- Add timeouts/retries/cancellation when calling external services.
- Sanitize and structure logs; never log secrets.

### 4.4 Shared contracts (packages/contracts)

- Treat shared types as public API.
- For breaking contract changes, coordinate versioning and release notes.
- Update all consumers in the same change set when contract shifts are required.

## 5) Security practices

- Secret management:
  - Store runtime secrets in environment variables (`.env.local` for local only).
  - Never commit secret material to git history.
  - Rotate and revoke secrets after incidents or exposure.
- Access control:
  - Follow least privilege for tokens, CI identities, and operational credentials.
- Dependency hygiene:
  - Audit dependencies regularly (`pnpm audit`).
  - Patch vulnerable transitive dependencies with `overrides` when needed.
- Review process:
  - Combine automated checks with manual code review for logic/security flaws.

## 6) Testing and verification

- Minimum before merge:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- For bug fixes:
  - Add/adjust a test that fails before the fix and passes after.
- For new behavior:
  - Cover the happy path and at least one failure edge.
- Keep tests deterministic (no hidden timing/network dependence without control/mocking).

## 7) Dependency and supply-chain hygiene

- Keep `pnpm-lock.yaml` committed and in sync.
- In CI, install with frozen lockfile semantics (`pnpm install --frozen-lockfile`).
- Enable automated dependency/security updates (Dependabot or equivalent).
- Prefer maintained packages with clear security posture and active updates.

## 8) Git and pull request standards

- Use Conventional Commits:
  - `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`, etc.
  - Use `!` or `BREAKING CHANGE:` for breaking changes.
- Keep PRs small and single-purpose.
- PR description should include:
  - What changed
  - Why
  - Risks/rollback plan
  - How it was tested
- Recommended repository protections:
  - Required PR review
  - Required status checks
  - Optional but recommended: signed commits, linear history

## 9) Definition of done checklist

A change is done only when all apply:

- Code is type-safe and understandable.
- Security implications have been considered at trust boundaries.
- Tests were added/updated and pass.
- `typecheck`, `test`, and `build` pass locally.
- Documentation/comments were updated where behavior changed.
- Commit messages and PR description follow repo standards.

## 10) Recommended CI baseline

- Install: `pnpm install --frozen-lockfile`
- Validate: `pnpm typecheck && pnpm test && pnpm build`
- Security: `pnpm audit --audit-level=high`

## 11) Key references (used for this policy)

- TypeScript strict mode: <https://www.typescriptlang.org/tsconfig/strict.html>
- TypeScript `noImplicitAny`: <https://www.typescriptlang.org/tsconfig/noImplicitAny.html>
- React component purity: <https://react.dev/learn/keeping-components-pure>
- React effect guidance: <https://react.dev/learn/you-might-not-need-an-effect>
- Node.js event loop guidance: <https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop>
- Node.js test runner (`node:test`): <https://nodejs.org/api/test.html>
- Node.js environment variables / `.env`: <https://nodejs.org/api/environment_variables.html>
- pnpm install / frozen lockfile: <https://pnpm.io/cli/install>
- pnpm recursive workspace commands: <https://pnpm.io/cli/recursive>
- pnpm audit: <https://pnpm.io/cli/audit>
- NIST SSDF (SP 800-218): <https://csrc.nist.gov/pubs/sp/800/218/final>
- OWASP Secure Code Review Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html>
- OWASP Secrets Management Cheat Sheet: <https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html>
- GitHub protected branches: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- Conventional Commits 1.0.0: <https://www.conventionalcommits.org/en/v1.0.0/>
- Semantic Versioning 2.0.0: <https://semver.org/>
- OpenSSF Scorecard: <https://scorecard.dev/>
- Dependabot security updates: <https://docs.github.com/code-security/dependabot/dependabot-security-updates/configuring-dependabot-security-updates>

