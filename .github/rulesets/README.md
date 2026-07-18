# Repository rulesets

`protect-main.json` is the reviewed source for the active `Protect main` ruleset.
It requires pull requests and the `Required Validation` job published by
`ci-full.yml`, in addition to blocking deletion and non-fast-forward updates.

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

The live response must contain `pull_request` and `required_status_checks`
rules, with `Required Validation` as the required context and no bypass actors.
Run `pnpm check:workflow-protection` whenever this contract changes.
