# PR Body Template

Use this template when generating the PR body. Fill in each section from git diff and commit messages. Remove sections that are not applicable.

```markdown
## Summary

- <What this PR does — 1-3 bullet points>

## Changes

- <Specific file/component changes>
- <Any breaking changes or notable behavior changes>

## Test plan

- [ ] <How to verify the change works>
- [ ] <Edge cases or regression checks>

## Related

Closes #<issue-number>
```

## Filling guidelines

| Section | Source |
|---|---|
| Summary | High-level intent from branch name + commit messages |
| Changes | `git diff --stat` and key hunks from `git diff` |
| Test plan | Infer from changed files (e.g., API change → test the endpoint) |
| Related | Check branch name or commit message for issue references (e.g., `fix/123-...` → `Closes #123`) |

Omit the "Related" section if there is no linked issue.
