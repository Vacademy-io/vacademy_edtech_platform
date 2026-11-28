# Contributing to Vacademy

Thank you for your interest in contributing to Vacademy! We welcome contributions of all kinds — bug fixes, new features, documentation improvements, and more. This guide will help you get started.

## Table of Contents

- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Code Style Guidelines](#code-style-guidelines)
- [Commit Message Conventions](#commit-message-conventions)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Pull Request Review Process](#pull-request-review-process)

## How to Contribute

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/vacademy_edtech_platform.git
   cd vacademy_edtech_platform
   ```
3. **Create a branch** from `main` for your work:
   ```bash
   git checkout -b feat/your-feature-name
   ```
4. **Enable the shared git hooks** (one time, after cloning) so the design-system commit gate runs:
   ```bash
   node scripts/setup-hooks.mjs
   ```
   (Equivalent to `git config core.hooksPath .husky`. Git stores hook paths per clone, so this can't
   be shared automatically — run it once.)
5. Make your changes, write tests where applicable, and commit using [conventional commits](#commit-message-conventions).
5. **Push** your branch to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
6. **Open a Pull Request** against the `main` branch of the upstream repository.

## Development Setup

Vacademy is a monorepo containing several services. Here is how to get each part running locally.

### Prerequisites

- Java 17+
- Maven 3.8+
- Node.js 18+ and npm
- Docker and Docker Compose
- Python 3.10+ (for the AI service)

### Backend (Spring Boot microservices)

The backend services are orchestrated with Docker Compose:

```bash
docker-compose up -d
```

This starts the database, message broker, and all backend microservices. To run a specific service locally for development, refer to its `README` or run:

```bash
cd <service-directory>
mvn spring-boot:run
```

### Frontend

There are two frontend applications, both built with React + TypeScript + Vite.

**Admin Dashboard:**

```bash
cd frontend-admin-dashboard
npm install
npm run dev
```

**Learner Dashboard:**

```bash
cd frontend-learner-dashboard-app
npm install
npm run dev
```

### AI Service (Python)

```bash
cd ai-service
pip install -r requirements.txt
python main.py
```

## Code Style Guidelines

- **Java (backend):** Follow standard Java conventions. Use meaningful variable and method names. Keep methods short and focused. Format code consistently (IDE defaults for IntelliJ or VS Code with Java extensions are fine).
- **TypeScript/React (frontend):** Use functional components and hooks. Prefer named exports. Use TypeScript types over `any`. Keep components small and composable.

### Frontend UI & Design System (required)

All new or changed UI in **both** frontends must follow the Vacademy Design System. The full standard
lives in [`frontend-admin-dashboard/docs/design-system/`](frontend-admin-dashboard/docs/design-system/README.md).

The essentials:

- **Reuse canonical components** (`MyButton`, `MyInput`, `MyDropdown`, `MyTable`, `MyDialog`, …) from
  `src/components/design-system/*` and `src/components/ui/*`. Don't hand-roll buttons, inputs,
  dropdowns, modals, or tables.
- **Design tokens only** — no raw hex (`#3b82f6`), no arbitrary Tailwind values (`bg-[#fff]`,
  `text-[13px]`, `p-[7px]`), no inline `style` for color/spacing/typography.
- **Icons:** `@phosphor-icons/react` only.
- Every screen handles **loading / empty / error / success** states and is responsive.

**How this is enforced (automatic):**

- A **commit gate** (`.husky/pre-commit`, enabled via `node scripts/setup-hooks.mjs`) blocks commits
  that introduce these violations in staged UI files. Run it manually anytime:
  ```bash
  node scripts/design-lint.mjs <file-or-dir>
  ```
- If you use **Claude Code**, the `ui-design-guardian` agent builds and fixes UI to spec
  automatically. Try: *"use ui-design-guardian to build/fix &lt;component&gt;"*.
- **Python (AI service):** Follow PEP 8. Use type hints where possible.
- **General:** Remove unused imports, avoid commented-out code in PRs, and write descriptive variable names.

## Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/). Each commit message should have the format:

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:**

| Type       | Usage                                      |
|------------|-------------------------------------------|
| `feat`     | A new feature                              |
| `fix`      | A bug fix                                  |
| `docs`     | Documentation changes                      |
| `style`    | Formatting, missing semicolons, etc.       |
| `refactor` | Code change that neither fixes nor adds    |
| `test`     | Adding or updating tests                   |
| `chore`    | Build process, dependency updates, etc.    |

**Examples:**

```
feat(auth): add OAuth2 login for learners
fix(catalog): correct pagination on course listing
docs: update CONTRIBUTING with setup instructions
```

## Reporting Bugs

Found a bug? Please open a GitHub Issue and include:

1. **Summary** — a clear, concise description of the problem.
2. **Steps to reproduce** — numbered steps to trigger the bug.
3. **Expected behavior** — what you expected to happen.
4. **Actual behavior** — what actually happened.
5. **Environment** — OS, browser, Java version, Node version, or any other relevant details.
6. **Screenshots or logs** — if applicable.

Please search existing issues first to avoid duplicates.

## Requesting Features

Have an idea? Open a GitHub Issue with the label `enhancement` and include:

1. **Problem statement** — what problem does this solve?
2. **Proposed solution** — how you envision it working.
3. **Alternatives considered** — any other approaches you thought about.
4. **Additional context** — mockups, examples, or references.

We appreciate well-thought-out proposals, but even rough ideas are welcome.

## Pull Request Review Process

1. Once you open a PR, a maintainer will be assigned to review it, typically within a few business days.
2. Ensure your PR:
   - Has a clear title and description explaining **what** and **why**.
   - Passes all CI checks (build, tests, linting).
   - Is scoped to a single concern — avoid mixing unrelated changes.
   - Includes tests for new functionality or bug fixes where applicable.
3. Reviewers may request changes. Please address feedback promptly or discuss if you disagree.
4. Once approved, a maintainer will merge your PR.

**Tip:** Smaller PRs get reviewed faster. If your change is large, consider breaking it into smaller, incremental PRs.

---

Thank you for helping make Vacademy better! If you have questions, feel free to open a discussion or reach out in the project's communication channels.
