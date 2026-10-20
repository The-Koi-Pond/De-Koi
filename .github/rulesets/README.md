# Repository rulesets

`protect-main.json` is the reviewed source for the active `Protect main` ruleset.
It requires pull requests and the `Required Validation` job published by
`ci-full.yml`, merges through GitHub's merge queue, and blocks deletion and
non-fast-forward updates.

After the workflow change is present on the default branch and has produced the
new check at least once, a repository administrator can apply the ruleset:

```bash
gh api \
  --method PUT \
  repos/The-Koi-Pond/De-Koi/rulesets/17943981 \
  --input .github/rulesets/protect-main.json
```

Verify the live result before closing the protection issue:

```bash
gh api repos/The-Koi-Pond/De-Koi/rulesets/17943981
```

The live response must contain `pull_request`, `merge_queue` and
`required_status_checks` rules, with `Required Validation` as the required context and no bypass actors.
Run `pnpm check:workflow-protection` whenever this contract changes.

## Merging with the queue

The queue only works when `Required Validation` reports on `merge_group`
events, so `ci-full.yml` listens for them. Keep that trigger on any workflow
whose check becomes required.

- Queue a pull request once its own `Required Validation` passes and its review
  threads are resolved, with the merge button on the pull request page or the
  command below. The branch does not need updating first.
- `gh pr merge` queues through the auto-merge API, so it fails with "Auto merge
  is not allowed for this repository" while the repository's auto-merge setting
  is off. Use the enqueue mutation instead:

  ```bash
  id=$(gh pr view <number> --repo The-Koi-Pond/De-Koi --json id -q .id)
  gh api graphql -f query="mutation { enqueuePullRequest(input: {pullRequestId: \"$id\"}) { mergeQueueEntry { position } } }"
  ```

- The queue builds main plus the queued pull requests, runs CI Full on that
  commit, and squash-merges when `Required Validation` passes there.
- A failing or conflicting pull request is removed from the queue without
  blocking the others. Fix it and queue it again.

Merge queue trial 2: tiny test change.
