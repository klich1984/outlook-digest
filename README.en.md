# Mail Digest

> 🇺🇸 You're reading the README in English. **[Ver en español →](README.md)**

Weekly automation that fetches unread emails from a Hotmail account (via Microsoft Graph), builds an HTML report with details of each message, and delivers it to a user-configured Gmail address. Reported emails are marked as read to prevent accumulation, and a local checkpoint prevents duplicate reports if the workflow runs twice on the same day.

## What it does

1. Every Monday at 8:00 a.m. Colombia time (UTC-5), a GitHub Actions workflow triggers automatically.
2. The `scripts/index.mjs` script queries Microsoft Graph for unread inbox emails received in the last 7 days.
3. It detects security alerts (emails from known domains, security keywords, or `importance=high`) and highlights them with a red banner and a required actions section.
4. It builds an HTML + plain text report with each message (sender, subject, date, importance, attachments, body snippet).
5. It sends the report to the configured Gmail address via Gmail API OAuth2.
6. It marks reported messages as read.
7. It persists a checkpoint with the reported IDs and rotates the MSAL token cache for the next run.

If something fails, the system sends an error email to the same destination Gmail address and the GitHub Actions logs are available for diagnostics.

## Prerequisites

- **Node.js 20 or higher** (tested with Node 24).
- **A GitHub account** with permissions to create Actions workflows and secrets on the target repository.
- **A personal Hotmail / Outlook.com account** (MSA). The script uses the `consumers` tenant of Microsoft Graph.
- **A Gmail account** to receive the report. You need a project in Google Cloud Console with Gmail API enabled and OAuth2 credentials of type "Desktop application" (Client ID, Client Secret, Refresh Token with scope `gmail.send` and `access_type=offline`).

## Quick start

```bash
# 1. Install dependencies (npm or pnpm)
npm install
# — or —
pnpm install

# 2. Configure environment variables
cp .env.example .env
# Edit .env and fill in all 6 variables (see .env.example for details)

# 3. Dry run preview (no emails sent, no messages marked as read)
npm run dev:dry
# — or —
pnpm run dev:dry

# 4. Full local run (sends report, marks messages, writes checkpoint to
#    state/reported-ids.json — no commit to the repo)
npm run dev:once
# — or —
pnpm run dev:once
```

## Project structure

```
.
├── package.json                # type: module + scripts dev:once / dev:dry
├── .env.example                # environment variable template
├── scripts/
│   ├── index.mjs               # CLI entry point (parses --dry-run)
│   ├── build-digest.mjs        # Graph acquisition + alerts + report
│   └── lib/                    # reusable modules
│       ├── msal.mjs
│       ├── gmail.mjs
│       ├── graph.mjs
│       ├── alerts.mjs
│       ├── checkpoint.mjs
│       ├── templates.mjs
│       ├── timezone.mjs
│       ├── logger.mjs
│       └── errors.mjs
└── openspec/changes/informe-semanal-hotmail/
    └── design.md               # detailed architecture
```

## Additional documentation

- [`openspec/changes/informe-semanal-hotmail/design.md`](openspec/changes/informe-semanal-hotmail/design.md)
  — complete architecture, MSAL token lifecycle, HTML templates, failure handling and operational considerations.
- [`openspec/changes/informe-semanal-hotmail/specs/`](openspec/changes/informe-semanal-hotmail/specs/)
  — specifications by domain (graph-query, alerts, report, send, checkpoint, failure-handling, secrets, local-development).
