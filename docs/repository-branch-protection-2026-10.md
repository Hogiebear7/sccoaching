# Branch protection for `redesign/index-html-blueprint` (recommended settings)

**This document recommends settings. Nothing was changed.** Repository settings were not modified by any code or PR in this work; the
owner (or a repo admin) applies them in GitHub under *Settings, Branches* (or *Rules, Rulesets*).

## Why

At the time of the post-merge audit the base branch was **unprotected** (`protected: false`): anyone with write access could push straight to it,
and a push does not run CI, because `.github/workflows/pr-checks.yml` triggers only on `pull_request` targeting this branch. A direct push can
therefore put unreviewed, untested money-path code on the branch the production build is made from. Merge commits, squash and rebase merges are
all allowed, and merged branches are not auto-deleted.

## Recommended settings

| Setting | Value | Reason |
| --- | --- | --- |
| Require a pull request before merging | on | No direct pushes. Every change is reviewed and runs CI. |
| Required approving reviews | 1 (2 for the billing and tenant paths if the team grows) | A second pair of eyes on entitlement and tenant code. |
| Dismiss stale approvals when new commits are pushed | on | An approval of commit A must not cover a later commit B. Worth the extra re-approval for this codebase. |
| Require review from code owners | optional, once a `CODEOWNERS` file exists for `lib/iap`, `lib/tenant-*`, `app/api/stripe`, `app/api/billing` | Keeps billing code from merging without the right reviewer. |
| Require status checks to pass before merging | on | See the list below. |
| Require branches to be up to date before merging | on | CI must have run against the commit that actually lands. Pair with the "Update branch" button. |
| Require conversation resolution | on | Open review comments block the merge. |
| Block force pushes | on | History of the shared branch is never rewritten. |
| Block deletions | on | The branch cannot be deleted. |
| Do not allow bypassing the above | on, including admins | An exception should be a deliberate, visible settings change, not a habit. |
| Require linear history | **off while merge commits are the merge method** | See below. |
| Automatically delete head branches | optional, on | Tidiness only. |

### Required status checks (exact names)

These are the five jobs in `.github/workflows/pr-checks.yml`. GitHub matches the **job name**:

1. `TypeScript`
2. `ESLint (changed files)`
3. `Test suite`
4. `Whitespace (git diff --check)`
5. `Production build`

A check only appears in the picker after it has run once on the repository; they have all run on recent PRs. If a job is renamed in the
workflow, the required-check entry must be renamed with it, or the PR will wait forever for a check that no longer exists.

### Linear history and the merge-commit policy

"Require linear history" forbids merge commits. The existing stack was merged with **merge commits** (`#60` to `#66`), and the repository allows
them. Turning linear history on while keeping merge commits would block every merge. Choose one deliberately:

- **Keep merge commits** (today's practice, preserves each PR's commits and the stacked-PR parent links): leave linear history **off**.
- **Move to squash or rebase merging**: turn linear history **on**, disable "Allow merge commits", and accept that stacked PRs must be
  retargeted and rebased after each parent merges (squash rewrites the parent's commits, so a stacked child needs a rebase).

Recommended for now: keep merge commits, leave linear history off, and revisit if the team prefers a squash-only history.

## Operational notes

- A PR opened from a branch pushed with a plain `git push` runs CI only when the PR targets this branch. A PR targeting another branch
  (for example a stacked PR's parent) does not run CI until it is retargeted, which is why stacked PRs were retargeted before merging.
- A pushed commit from automation does not trigger `pull_request` workflows when it was made with the default `GITHUB_TOKEN`; use "Update branch"
  or a normal push to re-trigger.
- Applying these settings is **not** reversible by this repository's code and should be done by the owner. Verify afterwards that a throwaway
  PR can still be merged once the five checks are green.
