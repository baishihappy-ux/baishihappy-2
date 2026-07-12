# GitHub General Release and Disaster Recovery Rules

The Chinese reading version is `github.md`.

## Two Governing Principles

The following principles govern every GitHub sync, commit, and push:

1. **Recover after loss of the local computer**
   GitHub must contain sufficiently complete project source and development material. On another computer, the project must support dependency installation, builds, tests, and continued development. A partial code snapshot that cannot run is not a valid recovery copy.
2. **GitHub stores only the `maoyi` general release**
   The general release must have the same features, layout, interactions, architecture, and test capability as the active business workspace. It removes business brand enterprise names, identifiers, and enterprise-only presentation, and uses `maoyi` consistently.

All remaining rules implement these two principles. Security cleanup must never be used as a reason to omit functional source, and complete recovery must never be used as a reason to upload secrets or customer data.

## General Release Definition

The general release is not a reduced, demonstration, or feature-stripped edition.

It must synchronize the complete product capability of the business workspace, including but not limited to:

- Signal / WhatsApp / Telegram multi-instance support.
- Input translation, bubble translation, cache, refresh, and unread preview.
- Themes, workspace behavior, window control, and app lock.
- Signal display, hide, attachment, process, and multi-instance management logic.
- Authorization, machine binding, security checks, and their development-tool source.
- Build, test, packaging, white-label tooling, and the project-owned Codex skill copy.
- Long-lived bilingual documents and key product design records.

Allowed general-release differences are limited to:

- The brand name is `maoyi`.
- Enterprise logos, icons, theme images, and brand images are replaced by general-release assets.
- Enterprise-only visible wording, application names, and data directory names are replaced with general-release names.

Secret injection and customer delivery outputs are not functional differences between the business and general releases. They are local security data that must never be committed for either edition.

## Recovery Scope

The GitHub general release must include:

- Complete source, including the main process, renderer, issuer, Signal modifications, and platform injection logic.
- Configuration templates and environment examples without real secret values.
- Dependency manifests and lock files.
- Build, test, packaging, white-label sync, and security-check scripts.
- Data model, cache, authorization, suite, and upgrade process documentation.
- Long-lived bilingual documentation.
- Project-owned skills, patches, assets, and tools required to resume development.

The minimum recovery acceptance standard is a fresh remote clone on another computer that can install dependencies, build, run the required tests, and support continued source changes without borrowing files from the old business workspace.

Production secrets are not recovered through the source repository. The following require a separate encrypted backup outside GitHub:

- Production API keys and customer keys.
- Suite private keys, certificates, issuer state, and real authorization material.
- The real allocation ledger for used and unused suite IDs.
- Suite identity mappings required for customer upgrades.

Keep at least two encrypted copies of this material and store them separately from repository access credentials. GitHub contains only generation tools, format definitions, and templates without secret values.

## Bilingual Sync Rule

`github.md` is the Chinese reading version and `github.en.md` is the English execution-reference version. Both must express the same rules.

Long-lived project `.md` documents follow the same policy:

- `xxx.md`: Chinese reading version.
- `xxx.en.md`: English execution-reference version.
- Update both when changing long-lived rules, product designs, architecture notes, Signal retrospectives, or release procedures.
- Add an English counterpart when a temporary investigation log becomes long-lived documentation.
- `.md` files under third-party dependencies, runtime caches, and generated exports are outside this rule.

## Workspace Isolation

GitHub general-release work must be physically isolated from active business development:

- The business source directory is the functional source of truth and must not be white-labeled and pushed directly.
- Generate, inspect, commit, and push the general release only from `github-export-baishihappy-2`.
- Do not replace branding, logos, or data directory names in the business directory.
- Do not overwrite the business directory with generated general-release output.
- Every sync starts from an explicit business Git commit.
- The general-release sync commit message must include `Source-Checkpoint: <business commit hash>`.

The current business checkpoint is:

```text
485c55e test: rebuild Signal runtime before control checks
```

Future syncs must use the new actual business commit hash, not permanently reuse this old value.

## Content That Must Never Enter GitHub

The following must not appear as files, content fragments, log output, or historical revisions:

- API keys, tokens, cookies, passwords, and real environment values.
- `license.dat`, license-code text, and customer authorization material.
- Private keys, certificate private keys, DPAPI data, cache keys, and machine-binding secrets.
- `.package-secrets`, real issuer state, and the real suite-ID ledger.
- Customer suite directories under `taozhuang`, installers, delivery archives, and release outputs.
- Signal / WhatsApp / Telegram login state, account data, and instance directories.
- `TranslationCache`, `SignalInstances`, `Partitions`, WebView user data, and local caches.
- Customer chat records, exported enterprise assets, contacts, images, video, and voice content.
- Customer configuration, machine codes, usernames, and device-binding records.
- Local identity information, private absolute paths, and customer-identifying data.
- Development and customer runtime logs.
- `node_modules`, `dist`, `dist-electron`, `.runtime`, and `.tmp`.

Root bug screenshots, competitor screenshots, and temporary feedback images are excluded by default. Commit a specific image only when the user explicitly designates it as long-lived repository evidence.

## Fixed Pre-Push Workflow

Push remotely only when the user explicitly asks to "push GitHub," "upload the general release," or "force-push the general release." Ordinary archiving, a Git safety check, or a local commit does not trigger a push.

### 1. Confirm Source and Isolation Directory

- Confirm the business workspace commit hash.
- Confirm the current directory is `github-export-baishihappy-2`.
- Confirm the business workspace was not changed, moved, or overwritten.
- Confirm the sync covers all feature, test, and long-lived documentation changes since the source business commit.

### 2. Confirm Remote, Branch, and Visibility

Inspect:

```text
git remote -v
git branch --show-current
```

- The remote and branch must match the intended targets.
- Check repository visibility before every push and report it to the user.
- Because the repository contains complete authorization and security implementation source, a private repository is the default recommendation.
- If the repository is public and the user did not explicitly confirm a public push for this operation, stop and report instead of pushing.

### 3. Confirm Functional Synchronization

- Do not omit business source, tests, scripts, skills, or long-lived documentation.
- Brand replacement must not break paths, window identification, cache isolation, authorization, or packaging.
- Functional differences between the general and business releases must be zero, excluding branding and secret-free configuration templates.

### 4. Confirm Branding

Scan file names and contents for:

- business brand Chinese enterprise names.
- `[BUSINESS_BRAND_NAME]`.
- business brand logos, icons, theme images, and brand images.
- Enterprise-only path names, product names, and documentation wording.

The general-release brand is:

```text
maoyi
```

Replace brand assets with general-release assets. Do not blindly delete them and leave missing images, broken layouts, or failed builds.

### 5. Scan Sensitive Files and Content

- Scan filenames, file content, the staging area, and untracked files against the forbidden-content list.
- Confirm `.gitignore` covers runtime data, secret directories, customer outputs, and installers.
- Scan for probable API keys, private-key headers, license codes, machine codes, and customer paths.
- Stop immediately if a real secret is found. Deleting it from the current working tree does not remove it from Git history.

### 6. Scan Git History

- Inspect the commits that will be pushed, not only the current snapshot.
- Confirm history contains no secrets, customer data, installers, runtime caches, or enterprise-brand residue.
- If sensitive content entered history, clean and re-audit history before any push.

### 7. Build and Actual Tests

Run at least the following in the general-release isolation directory:

```text
npm.cmd ci
npm.cmd run build
npm.cmd run test:security
npm.cmd run test:signal-render-cache
npm.cmd run test:electron-smoke
```

- Run newly added security or critical runtime tests as well.
- Delete temporary screenshots created by `test:electron-smoke` after manual inspection; do not commit them.
- A successful build supports only the statement "build passed."
- Report UI or runtime behavior as verified only after actually opening the application and inspecting that path.
- Do not push after a test failure unless the user is told the exact failing item and explicitly instructs continuation.

### 8. Inspect Git State and Commit Content

Run:

```text
git diff --check
git status --short
git diff --stat
git diff --cached --name-status
git log -1 --oneline
```

- Review every staged path and confirm it belongs to the general release.
- Record the sync scope and `Source-Checkpoint` in the commit message.
- Inspect working-tree status again after committing.

### 9. Push Rule

- Use a normal push by default.
- Do not use `git push --force` as a routine command.
- Rewriting remote history requires the user's explicit approval for that operation and must use `git push --force-with-lease`.
- Do not push if the remote, branch, isolation directory, branding, sensitive-data scan, or tests fail validation.

### 10. Post-Push Disaster-Recovery Audit

After pushing:

- Confirm the remote branch commit hash matches the local general-release commit.
- Fresh-clone the remote into a new temporary directory.
- Without referencing business-workspace files, reinstall dependencies and run the build and required tests.
- Record passed, failed, and unverified items.
- Delete the temporary clone and test outputs without affecting the business workspace or general-release isolation directory.

Only after the remote commit exists and the fresh-clone audit is complete may the operation be described as a completed off-machine recovery backup.

## Git Safety Check, Checkpoint, and Remote Backup

- **Git safety check**: inspects paths, differences, branding, and sensitive data; it creates no commit.
- **Local Git checkpoint**: creates a local commit and supports local rollback, but is lost with the local computer.
- **GitHub remote backup**: gains off-machine recovery value only after isolation, checks, commit, push, and fresh-clone validation.

These are different operations. Status reports must state separately which ones were completed.

## Current Target Repository

```text
https://github.com/baishihappy-ux/baishihappy-2.git
```

## Fixed Operating Rule

When the user requests a GitHub push, use this order:

```text
confirm business commit -> sync to isolated general release -> functional/branding/sensitive-data checks -> build and actual tests -> general-release commit -> push -> fresh-clone audit
```

Never skip the isolation directory, never push directly from the business directory, and never describe a local commit as a completed GitHub loss-recovery backup.
