# Review PRs

Parallel PR triage: decide merge-worthiness, prepare worktrees updated from `nightly`, fix blockers, return them for the owner's merge (agents merge only their own PRs; `docs/agents/policy.md`).

## Arguments

`$ARGUMENTS` optional:
- space/comma-separated PR numbers/URLs; or
- GitHub-search qualifiers (`is:open`, `author:foo`, `label:bug`, `draft:false`, ...) and/or time window (`3d`, `2w`, `12h`).

No PRs or flags: all open PRs opened in last 3 days.

## 1. Resolve PRs

Parse `$ARGUMENTS`. Explicit numbers/URLs: use verbatim. Otherwise `github` `op: search_prs`; no-args default:

```
github { op: "search_prs", query: "is:open", since: "3d", limit: 50 }
```

Pass supplied qualifiers verbatim in `query`; add `is:open` unless present. Time window (`3d`, `2w`, `12h`, ISO date; see `github` docs): `since`. `dateField` defaults `created`; set `"updated"` only on explicit request for recently-touched PRs. Print resolved set before fan-out.

## 2. One parallel `task` subagent/PR

Assign each PR's number, head ref, author, and workflow. Agents isolate; use `irc` only if a fix on PR A obviously conflicts with PR B.

### Required subagent workflow

#### Read and decide

1. Read `pr://<N>` (comments default; `?comments=0` skips) and `pr://<N>/diff` (changed-file listing). Full unified diff: `pr://<N>/diff/all`; file slice: `pr://<N>/diff/<i>`.
2. Check `git log origin/nightly` and `gh search prs` for an already-landed equivalent.
3. Decision:
   - `slop`: AI-generated noise, broken, off-spec, or net-negative. Drop; 1–2-line justification; no checkout.
   - `superseded`: fixed/merged in `nightly` or newer PR. Drop with pointer.
   - `worthy`: proceed.

Ambiguous: `worthy`; the owner decides on a real branch.

#### Owner-head gate (decides whether PR code may run)

Reading a PR is always allowed; executing it on the owner's machine is allowed only for an **owner head**: the PR is opened by the owner from a branch in the owner's repository, and every commit from base to head carries a signature GitHub verified for the owner's account (the owner's key or the agent key registered to it). Commit author fields do not count. The commit list must come from the paginated compare range, and a truncated list (the PR commits endpoint stops at 250) does not count: the number of commits seen must equal the PR's own commit count, else fail closed.

```bash
REPO=PsychedelicShayna/neopi; OWNER=${REPO%/*}
PRJ=$(gh api "repos/$REPO/pulls/<N>")
B=$(jq -r .base.sha <<<"$PRJ"); GATE_SHA=$(jq -r .head.sha <<<"$PRJ")
LOCAL_RUN=$(
  { printf '%s\n' "$PRJ"; gh api --paginate --slurp "repos/$REPO/compare/$B...$GATE_SHA?per_page=100"; } |
  jq -s --arg o "$OWNER" '
    .[0] as $pr | [.[1][].commits[]] as $c
    | ($pr.user.login == $o and $pr.head.repo.owner.login == $o)
      and ($c | length) > 0 and ($c | length) == $pr.commits
      and all($c[]; .commit.verification.verified and .committer.login == $o)') || LOCAL_RUN=false
```

`LOCAL_RUN=true`: owner head, verified at `$GATE_SHA`; continue below. Anything else is a **contributor head**: do the review read-only from `pr://<N>/diff/all` (or `git fetch origin pull/<N>/head` plus `git diff`). No `pr_checkout` worktree, no `bun install`, `bun fmt`, `bun test`, `bun run`, `./build.sh`, cargo, and no agent session rooted in that tree. Skip Checkout, Symlink, Update from base, Fix, and Commit; report `Fixes: none (contributor head, read-only)` with findings under Blockers.

After checkout and before any PR-controlled command or session runs, require `git -C "$WT" rev-parse HEAD` to equal `$GATE_SHA`; `pr_checkout` fetches the mutable head and may reuse an existing worktree. On mismatch, rerun the gate on the new head and start over; never run code the gate did not check.

#### Checkout (owner heads only)

```bash
gh_PR=<NUMBER>
# pr_checkout creates ~/.omp/wt/<encoded-repo>/pr-<N>/ and configures push remote
```

MUST use `github pr_checkout`, not raw `gh pr checkout`: it creates a dedicated worktree wired for later `pr_push`.

#### Symlink build artifacts (owner heads only)

Before any worktree build/test, from the worktree symlink main-checkout outputs to avoid `bun check` / `cargo build` / native-loader recompilation:

```bash
MAIN="<absolute path to main worktree, e.g. ~/repos/neopi-nightly>"
WT="$(pwd)"

# Rust target dir + JS deps (root-level in this monorepo)
ln -snf "$MAIN/target"        "$WT/target"
ln -snf "$MAIN/node_modules"  "$WT/node_modules"

# Prebuilt native addon (avoids 30s+ napi-rs rebuild). Link only the .node
# binaries — the rest of packages/natives/native/ is tracked by git, so
# folder-level symlinks would shadow PR-modified files and break review.
for f in "$MAIN"/packages/natives/native/*.node; do
  [ -e "$f" ] && ln -snf "$f" "$WT/packages/natives/native/"
done
```

Before `pr_checkout`, derive `$MAIN` from original cwd: `git rev-parse --show-toplevel`. Symlinks MUST use absolute paths: worktree is outside main repo; relative paths break. MUST NOT symlink whole `packages/natives/native/`: it shadows tracked PR changes.

#### Update from base (owner heads only)

```bash
git fetch origin nightly
git merge -S"$HOME/.ssh/id_ed25519_github_signing_agents.pub" origin/nightly \
  -m "chore: merge origin/nightly into <branch>" \
  -m "Model: <provider>/<model-id>" -m "Co-authored-by: <Model Name> <noreply@<provider-domain>>"
git verify-commit HEAD
```

Fast-forward or already-up-to-date produces no commit; otherwise the merge commit carries the agent key and trailers like any other commit.

Mechanical conflicts (formatting, import order, adjacent edits): resolve, continue. Semantic conflicts: abort, note final report, do not commit. Never rebase.

#### Review and fix (fixes: owner heads only)

Review for correctness, security, regressions, breaking-change impact, and new-path test coverage. Fix merge blockers only: build/test failure, obvious PR-introduced bugs, or edge cases required by the PR's goal. Do NOT taste-rewrite, unrelated-refactor, or expand scope.

Each fix: read existing patterns; follow `AGENTS.md` conventions; add/update behavior-change tests; run targeted area test files only—no project-wide subagent tests. End with `bun fmt` over union of edited files.

#### Commit

One conventional commit/logical fix atop the PR branch, signed and trailered per `docs/agents/policy.md`:

```bash
git add -A
git commit -m "fix(<scope>): <what & why>

Addresses review feedback on #<PR>."
```

Do NOT amend author commits, force-push, or push to or merge PRs you do not own (`docs/agents/policy.md`); the owner merges contributor PRs.

#### Report

Return:

```
PR #<N>  <title>
Decision: worthy | slop | superseded
Worktree: ~/.omp/wt/.../pr-<N>   (or: not checked out)
Base:     clean | conflicts (resolved | aborted: <reason>)
Fixes:    <commit shas + one-liners>   (or: none needed)
Blockers: <anything the owner must decide>
```

## 3. Aggregate

After all agents finish, print:

```
| PR | Title | Decision | Rebase | Fixes | Blockers |
|----|-------|----------|--------|-------|----------|
```

Then worktree paths grouped by decision.

## Rules

- MUST use parallel subagents, one/PR; NEVER serial loop.
- `slop`/`superseded`: skip checkout; record decision only.
- Fixes limited to merge blockers in that PR's diff.
- MUST NOT push to or merge PRs you do not own; the owner merges them (`docs/agents/policy.md`).
