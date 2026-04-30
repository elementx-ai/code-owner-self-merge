A GitHub action that lets code-owners merge PRs via a comment.

This action uses the standardized structure of [a CODEOWNERS file](https://github.blog/2017-07-06-introducing-code-owners/) to handle the access controls.

<img src="screenshots/img.png">

## A simple example

With this file at `CODEOWNERS` or `.github/CODEOWNERS`:

```sh
README.md @your-username
```

If a PR contained _only_ a change to `README.md`, this action would comment that `@your-username` has the ability to merge by commenting `LGTM`.

When that happens, the GitHub Action will merge the PR automatically.

## Setting It Up

Create a workflow file at `.github/workflows/codeowners-merge.yml`:

```yml
name: Codeowners merging
on:
  pull_request_target: { types: [opened] }
  issue_comment: { types: [created] }
  pull_request_review: { types: [submitted] }

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - name: Run Codeowners merge check
        uses: elementx-ai/code-owner-self-merge@main
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Security

We force the use of [`pull_request_target`](https://github.blog/2020-08-03-github-actions-improvements-for-fork-and-pull-request-workflows/) as a workflow event to ensure that someone cannot change the CODEOWNER files at the same time as having that change be used to validate if they can merge.

### Issue / PR manipulation

Merging a PR has strict security requirements, but closing a PR or Issue can have a weaker one. Anyone with a GitHub login listed in the CODEOWNERS file has the ability to close any PR or Issue via a comment or review which includes:

```
@github-actions close
```

A closed PR can be re-opened with:

```
@github-actions reopen
```

### Labels

You can set labels for specific sections of the codebase by using square brackets in CODEOWNERS entries:

```sh
packages/docs/es/**/*.md @your-username [translate] [es]
```

## Config

Available inputs for the action:

- `token` — GitHub token to use for API calls (falls back to `GITHUB_TOKEN` env var)
- `cwd` — root folder to look for CODEOWNER files in
- `merge_method` — `merge` (default), `squash`, or `rebase`
- `quiet` — do not comment saying who can merge the PR
- `ownerNoPings` — list of usernames to wrap in an inline code block to prevent pinging
- `if_no_maintainers_add_label` — label to apply when no CODEOWNER covers the PR
- `if_no_maintainers_assign` — space-separated `@username` list to assign when no CODEOWNER covers the PR

```yml
- name: Run Codeowners merge check
  uses: elementx-ai/code-owner-self-merge@main
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    merge_method: "squash"
    if_no_maintainers_add_label: "maintainers"
    if_no_maintainers_assign: "@your-username"
```

## Dev

Run tests:

```sh
npm test
```

Build the distribution:

```sh
npm run build
```

The CI workflow (`build-and-test.yaml`) verifies that `dist/index.mjs` is up to date on every PR — run `npm run build` before pushing if you change `index.ts`.

## Deploy

Use the GitHub UI to create a tag and release.
