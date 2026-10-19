# 0001: Review approval as a merge requirement (superseded)

Status: superseded by the owner's nightly delivery policy (2026-10-19).

## Current decision

[policy.md](../policy.md#nightly-delivery) owns delivery: integrate at about 80%
confidence, lower acceptable, and record confidence in the merge note. Build
and install after every merge or batch, then check launch. The owner uses the
build and decides what stays.

CI/test results and optional bot findings are information, not nightly gates.
Review is not requested by default; at most one round is allowed for a change
whose blast radius could make the harness unusable. Base changes never
invalidate anything. The owner may commission non-gating bug hunts on `nightly`.

## Context

Earlier versions of this decision made CI and review approval merge
requirements. The owner replaced that process with tangible nightly delivery
and feedback from the running build. The earlier requirements no longer apply.
The owner retains default-branch promotion authority.
