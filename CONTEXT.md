# Repository and tracker context

Project/package contexts are routed by [CONTEXT-MAP.md](CONTEXT-MAP.md).
Operating rules live in [docs/agents/policy.md](docs/agents/policy.md); label
spellings and meanings live in [triage-labels.md](docs/agents/triage-labels.md).

| Term | Meaning here |
| --- | --- |
| Agent (product) | The coding-agent CLI implementation, usually `packages/coding-agent/`, when discussing product behavior |
| Agent (tracker actor) | The implementer doing unattended, out-of-the-loop work |
| ITL / OTL | In-the-loop human participation / out-of-the-loop unattended work; human participation does not mean the human writes code |
| Pending | Eligible work waiting for its named actor to claim it |
| Started | The named actor claimed the work; not a heartbeat or continuous activity claim |
| Finished | The named actor's part is done; whole-change review, acceptance and merge may remain |
| Triage | Two-pass assessment: provisional classification, then comparison with all open issues and relevant upstream work |
| Claim | Ownership signal warning another actor not to duplicate work; shared GitHub account assignment alone is insufficient |
| Mergeable | Meets repository merge criteria, not just GitHub's conflict check; separate from who may merge |
| Integration / default | `nightly` receives topic PRs; `neopi` is the owner-promoted default branch |
| Promotion | Merge of integration into default, shipping changes from `npi-nightly` to `npi` |
| Upstream | `can1357/oh-my-pi`, including sync, compatibility, divergence and conflict-avoidance involvement |
| Downstream | A project consuming NeoPi; independent of upstream involvement |
| Baseline | A defect already on the PR base; it may be fork-local and is not synonymous with upstream |
| Duplicate | The same underlying request; reconcile useful new context into the canonical issue before closure |
| Entangled | Mutually incompatible alternatives requiring an owner choice; not merely related or dependent work |
| Idea / spec | Undecided possibility / implementation specification; neither alone authorizes work |
| Experiment | Work isolated on an `experimental/` branch pending an owner integration decision |
| Difficulty / frame / priority | Implementation challenge / estimated time unit / urgency or ordering; independent axes |
| Frame normalization | Lower a fresh agent estimate one unit exactly once, with hours as the floor; human estimates unchanged |
| Reviewer token | Configured name such as `codex`, mapped to bot login and invocation in the review guide |
| Review state | Optional review activity and findings; descriptive only, unchanged by base movement and independent of actor state |
| Round / receipt | A requested reviewer response on one head / the evidence that identifies its pass, status and commit |
| Acceptance | The full requested contract, not merely a merged linked PR or implementation claim |

PR: a unit of tangible change the owner can feel when she runs the build.
