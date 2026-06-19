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

## Initial MSAL token setup

To read emails from Hotmail/Outlook.com the script needs a valid
**MSAL token cache**. The cache is a JSON blob that MSAL produces
after a human authenticates once with Microsoft.

The cache is generated locally using the
`@softeria/ms-365-mcp-server` binary (the same MCP server opencode
uses):

```bash
# 1. Install the package (only the first time)
npm install -g @softeria/ms-365-mcp-server
# — or —
pnpm add -g @softeria/ms-365-mcp-server

# 2. Authenticate: a browser window opens, sign in with your
#    Hotmail/Outlook.com account and the cache is printed to stdout
npx @softeria/ms-365-mcp-server --login

# 3. Copy the JSON that appears in stdout (a long object with
#    "Account", "IdToken", "RefreshToken", etc. fields) and paste
#    it as the value of MSAL_TOKEN_CACHE_JSON in your .env
```

**Important:** the token cache is NOT the same as an access token. It
is a JSON blob containing the refresh tokens and metadata MSAL needs
to silently renew access tokens. **Typical expiry:** ~1 hour for
access tokens, ~90 days for refresh tokens.

When the workflow fails with `GRAPH_AUTH_ERROR` or "refresh token
rejected" errors, regenerate the cache with step 2 and update the
secret in GitHub Actions
(`gh secret set MSAL_TOKEN_CACHE_JSON < new-cache.json`).

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

## Deploy to GitHub Actions

The workflow runs automatically every Monday at 8:00 AM COL. To
configure the 6 required secrets in your fork:

### 1. Hotmail / Outlook.com

| Variable | How to obtain |
|---|---|
| `HOTMAIL_ACCOUNT_ADDRESS` | Your Hotmail/Outlook.com address (e.g. `your-account@hotmail.com`) |
| `MSAL_TOKEN_CACHE_JSON` | Paste the full JSON returned by `npx @softeria/ms-365-mcp-server --login` (see [Initial MSAL token setup](#initial-msal-token-setup)) |

### 2. Gmail (OAuth2 Desktop application)

| Variable | How to obtain |
|---|---|
| `GMAIL_OAUTH_CLIENT_ID` | Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID of type "Desktop app" |
| `GMAIL_OAUTH_CLIENT_SECRET` | The Client Secret corresponding to the Client ID above |
| `GMAIL_OAUTH_REFRESH_TOKEN` | OAuth2 flow with scope `https://www.googleapis.com/auth/gmail.send` and `access_type=offline`. Use the Google "OAuth 2.0 Playground" or a local script that performs the flow and captures the refresh_token |
| `GMAIL_DESTINATION_ADDRESS` | The Gmail address where you want to receive the report (can be the same one that authorized the app, or any other that has permission) |

### 3. Configure secrets with the `gh` CLI

```bash
# Replace the <...> placeholders with your real values.
# For MSAL_TOKEN_CACHE_JSON, pass the JSON as a file:

# Save the token cache to a temporary file
npx @softeria/ms-365-mcp-server --login > /tmp/msal-cache.json

# Configure each secret
gh secret set HOTMAIL_ACCOUNT_ADDRESS --body "your-account@hotmail.com"
gh secret set MSAL_TOKEN_CACHE_JSON < /tmp/msal-cache.json
gh secret set GMAIL_OAUTH_CLIENT_ID --body "<your-client-id>"
gh secret set GMAIL_OAUTH_CLIENT_SECRET --body "<your-client-secret>"
gh secret set GMAIL_OAUTH_REFRESH_TOKEN --body "<your-refresh-token>"
gh secret set GMAIL_DESTINATION_ADDRESS --body "destination@gmail.com"

# Verify they are all set
gh secret list
```

### 4. Activate the workflow

The workflow lives in `.github/workflows/weekly-digest.yml`. It runs
automatically every Monday at 13:00 UTC (8 AM COL). You can also
trigger it manually from the repo's "Actions" tab with "Run workflow"
→ check the **dry run** box to test without sending real emails.

### 5. Manual MSAL token rotation

The MSAL refresh token expires ~90 days after the last interactive
login. When the workflow fails with `GRAPH_AUTH_ERROR`:

```bash
# 1. Regenerate the cache locally
npx @softeria/ms-365-mcp-server --login > /tmp/msal-cache.json

# 2. Update the secret
gh secret set MSAL_TOKEN_CACHE_JSON < /tmp/msal-cache.json

# 3. Re-trigger the workflow manually from the Actions tab
```

**Total setup time for a new repo:** ~30 minutes following this guide
(assuming you already have your Hotmail and Gmail accounts ready).
