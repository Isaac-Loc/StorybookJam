# AGENTS.md

Read <https://docs.deep.space/llms.txt>, then fetch the relevant documentation
page as Markdown by appending `.md`. The installed package types and CLI
`--help` describe the exact version in this project. Use your existing HTTP,
shell, and browser tools; no skill, plugin, connector, or session restart is
required. Installing the optional skill is a separate explicit choice.

## StorybookJam: read this first

This repo is StorybookJam, a multiplayer Mad-Libs picture book. Before changing
anything, read [docs/HANDOFF.md](./docs/HANDOFF.md): the project spec, decisions
already made, architecture, costs, gotchas, testing, current state and next
steps. Non-negotiables:

- Do not commit, push or deploy, and do not make paid calls (anthropic, fal,
  anything), unless the developer asks. Always set `maxCostUsd` on
  `fal/run-model`.
- The repo is public: never commit secrets, `.dev.vars`, session files, test
  passwords, or personal emails and IDs.
- Hidden game data is hidden by the SERVER (record permissions). Action tools
  bypass RBAC, so authorize the caller inside every action. The app owner is
  automatically `admin` and also plays: check every permission rule for that.
- Never send raw player text to the image model. Keep the browser integration
  proxy deny-by-default.
- Keep the docs current: any change to behavior, limits, schemas, actions,
  integrations, costs or workflow must update docs/HANDOFF.md in the same
  commit (see its section 11).
- Before a commit run `npm run type-check && npm run lint && npm run test:unit
  && npm run build`. On Windows, commit with `git commit -F <message-file>`.

## About this project

This is a **DeepSpace** app — a real-time collaborative app built on the
[`deepspace`](https://www.npmjs.com/package/deepspace) SDK and deployed to
Cloudflare Workers via `npx deepspace deploy`.

## Version control

The app's **cloud repo** on the DeepSpace platform is the default version
control; no external account is needed. The first DeepSpace push/pull/deploy
command installs its Git remote as `space`. **Don't set up GitHub (or another
git host) unless the developer explicitly asks.** With the default DeepSpace
source, commit before you deploy: the release records that commit and refuses
a dirty worktree. When the app ships from GitHub (latched from the checkout's
remote at the app's first release, permanently), deploy instead ships the
current checkout, including dirty or unpushed bytes, and records no commit
lineage for that release; use ordinary Git to decide what should be committed
and pushed. For parallel DeepSpace-source work: `workspace new -t "<task>"` →
commit → `workspace sync` → `workspace land`. Use `status`, `activity`,
`releases`, and `rollback` to recover context and inspect what is live.

## Project commands

```sh
npx deepspace auth login   # authenticate with app.space
npx deepspace dev start    # local dev server (vite + miniflare)
npx deepspace deploy       # deploy to <app>.app.space
npx deepspace push         # sync code to the app's cloud repo
npx deepspace agent tools <app> --json # discover tools and their input schemas
npx deepspace agent invoke <app> <tool> --input-file tool-input.json --json
npx deepspace add --list   # list optional features (messaging, etc.)
npx deepspace add <feature>
```

`worker.ts` already exposes the tools from `src/ai/tools.ts` over HTTP, MCP and
browser tools; add tools there instead of registering the routes again. For
local app tools, always run `agent tools` first and follow the returned
description and input schema rather than guessing arguments. `agent invoke`
reuses the current CLI login and requires no separate connection. If it reports
`not_authenticated`, run the refusal's action when present. In a
headless shell without an action, run `npx deepspace auth login --help` and use
the operator-supplied credential path it names; never invent credentials or put
a password on the command line.
