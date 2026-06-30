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

- **Node.js 22 or higher** (tested with Node 24).
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
configure the 7 required secrets in your fork:

### 1. Hotmail / Outlook.com

#### `HOTMAIL_ACCOUNT_ADDRESS`

Your Hotmail/Outlook.com address (e.g. `your-account@hotmail.com`).
No additional configuration required — just the address you use to
log in to Hotmail.

#### `MSAL_CLIENT_ID`

Application (client) ID of the Azure App Registration that authenticates
against Microsoft Graph. See detailed steps in
[Initial MSAL token setup](#initial-msal-token-setup).

#### `MSAL_TOKEN_CACHE_JSON`

Native MSAL Node JSON with `AppMetadata` included. Generated with
`node scripts/get-msal-token-cache.mjs` after authenticating with the
Hotmail/Outlook.com account. See
[Initial MSAL token setup](#initial-msal-token-setup).

### 2. Gmail (OAuth2 Desktop application) — Step by step

**⚠️ Important:** the instructions assume your Gmail account does NOT
have Google's Advanced Protection Program (APP) enabled. If your
account has APP, you must use a different Gmail account as the report
destination (see TF-3 in tasks.md).

#### Step A: Create the project in Google Cloud Console

1. Go to https://console.cloud.google.com/
2. Top left, click the project dropdown → **"New Project"**
3. **Project name:** `mail-digest` (or any name you prefer)
4. **Organization:** leave default (no organization) or whatever applies
5. Click **"Create"**
6. Wait a few seconds for it to be created. You'll be notified in the top right
7. Make sure the new project is selected (it should be highlighted top left)

#### Step B: Enable Gmail API

1. Hamburger menu (☰) → **"APIs & Services"** → **"Library"**
2. In the search bar, type **"Gmail API"**
3. Click the "Gmail API" result (from Google Enterprise API)
4. Click **"Enable"** at the top
5. Wait until it says "API enabled" (takes a few seconds)

#### Step C: Configure OAuth Consent Screen

1. Menu ☰ → **"APIs & Services"** → **"OAuth consent screen"**
2. **User type:** choose **"External"** → click **"Create"**
3. **App information:**
   - **App name:** `Mail Digest`
   - **User support email:** your email
   - **App logo:** leave default (optional)
4. **App domain:** leave everything blank (not required for testing)
5. **Developer contact information:**
   - **Email addresses:** your email
6. Click **"Save and Continue"**
7. **Scopes:** ⚠️ **THIS IS THE CRITICAL STEP** — DO NOT leave default.
   - Click **"Add or remove scopes"**
   - In the panel that appears, filter by `gmail` or scroll
   - Check these 3 scopes (minimum):
     - `https://www.googleapis.com/auth/gmail.send` ← **CRITICAL for sending emails**
     - `https://www.googleapis.com/auth/openid` ← recommended
     - `https://www.googleapis.com/auth/userinfo.email` ← recommended
   - Click **"Update"**
   - Verify it says "3 scopes" or more in the summary
   - Click **"Save and Continue"**
   - **If you skip this step**, you'll get intermittent errors like
     `invalid_client` or `ERR_STREAM_PREMATURE_CLOSE` that look like network issues.
8. **Test users:**
   - Click **"+ ADD USERS"**
   - Add the Gmail email you'll use as destination
   - Click **"Add"**
   - Click **"Save and Continue"**
9. **Summary:** review and click **"Back to Dashboard"**

#### Step D: Create OAuth 2.0 Client ID

1. Menu ☰ → **"APIs & Services"** → **"Credentials"**
2. At the top, click **"+ Create Credentials"** → **"OAuth client ID"**
3. **Application type:** **"Desktop app"** (NOT "Web application" — important)
4. **Name:** `mail-digest-cli`
5. **Authorized redirect URIs:** leave default (no URLs needed)
6. Click **"Create"**
7. A modal appears with:
   - **Client ID:** something like `371674345711-xxx.apps.googleusercontent.com` → **COPY IT**
   - **Client secret:** a shorter string → **COPY IT** (this is the only time you see it in full; later it's shown truncated)
8. Click **"OK"** — the credential is saved in the "OAuth 2.0 Client IDs" list

#### Step E: Obtain the Refresh Token

**DO NOT use Google's OAuth 2.0 Playground** (it's cumbersome). Use the
script included in this repo:

```bash
cd "C:/Users/hetan/Documents/desarrollo/opencode/mcp"
export GMAIL_CLIENT_ID="<the-client-id-you-copied>"
export GMAIL_CLIENT_SECRET="<the-client-secret-you-copied>"
node scripts/get-gmail-refresh-token.mjs
```

**What happens:**
1. Browser opens to Google's screen
2. Log in with the Gmail account you added as test user in Step C
3. Google asks for permission for the app to send emails on your behalf (`gmail.send`)
4. Click **"Allow"**
5. Back in the terminal, a long JSON is printed → **that's the last line, it's your refresh token**
6. Copy it for the next step

**⚠️ If the script throws error `400: policy_enforced`:** your Gmail account has APP enabled. Use a different Gmail account.

#### Step F: Gmail variables summary

| Variable | Value |
|---|---|
| `GMAIL_OAUTH_CLIENT_ID` | The Client ID from Step D (e.g. `371674345711-xxx.apps.googleusercontent.com`) |
| `GMAIL_OAUTH_CLIENT_SECRET` | The Client Secret from Step D |
| `GMAIL_OAUTH_REFRESH_TOKEN` | The long string printed by the script in Step E |
| `GMAIL_DESTINATION_ADDRESS` | The Gmail address where you want to receive the report (same as the test user) |

### 3. Configure secrets with the `gh` CLI

```bash
# Replace the <...> placeholders with your real values.
# For MSAL_TOKEN_CACHE_JSON, pass the JSON as a file:

# Save the token cache to a temporary file (DO NOT commit this file)
node scripts/get-msal-token-cache.mjs > /tmp/msal-cache.json 2>&1
tail -1 /tmp/msal-cache.json > /tmp/msal-cache-clean.json

# Configure each secret
gh secret set HOTMAIL_ACCOUNT_ADDRESS --body "your-account@hotmail.com"
gh secret set MSAL_CLIENT_ID --body "<your-azure-app-client-id>"
gh secret set MSAL_TOKEN_CACHE_JSON < /tmp/msal-cache-clean.json
gh secret set GMAIL_OAUTH_CLIENT_ID --body "<your-client-id>.apps.googleusercontent.com"
gh secret set GMAIL_OAUTH_CLIENT_SECRET --body "<your-client-secret>"
gh secret set GMAIL_OAUTH_REFRESH_TOKEN --body "<refresh-token-printed-by-script>"
gh secret set GMAIL_DESTINATION_ADDRESS --body "destination@gmail.com"

# Clean up temporary files (they're secrets)
rm /tmp/msal-cache.json /tmp/msal-cache-clean.json

# Verify all 7 secrets are set
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

## Troubleshooting

This section covers the most common errors encountered during
development and first deploy. If your workflow fails, check here before
opening an issue.

### Error: `SyntaxError: Invalid or unexpected token` in tests

**Cause:** `.mjs` files with CRLF (Windows line endings). Vitest does
not tolerate `\r\n` in certain contexts where Node.js does.

**Solution:**

```bash
# Convert the specific file
sed -i 's/\r$//' scripts/index.mjs
```

**Prevention:** the repo includes `.gitattributes` that forces LF for
all `.mjs`, `.js`, `.json`, `.md`. If VS Code keeps opening files in
CRLF, add `"files.eol": "\n"` to your User Settings
(`Ctrl+Shift+P` → "Preferences: Open User Settings (JSON)").

### Error: `unauthorized_client: The client does not exist or is not enabled for consumers` (Azure)

**Cause:** the Azure App Registration was created with "Accounts in
this organizational directory only" instead of "Personal Microsoft
accounts only". MSA accounts (Hotmail/Outlook.com) do NOT work with
single-tenant organizational apps.

**Solution:** delete the app and create a new one with the correct
option. "Supported account types" **cannot be changed** after
creation.

### Error: `400: policy_enforced` when authorizing with Google

**Cause:** your Gmail account has Google's **Advanced Protection
Program** (APP) enabled. APP blocks ALL apps that are not formally
verified by Google, regardless of whether they are in "Testing" mode.

**Solution:** use another Gmail account that does NOT have APP. To
check if your account has APP:
https://myaccount.google.com/advancedprotection

### Error: `403: access_denied` when authorizing with Google

**Cause:** your email is missing as a **test user** in the OAuth
consent screen of Google Cloud Console.

**Solution:** Google Cloud Console → APIs & Services → OAuth consent
screen → Test users → + ADD USERS → add your email.

### Error: `invalid_client` or `ERR_STREAM_PREMATURE_CLOSE` from GitHub Actions (but works locally)

**Cause:** the OAuth consent screen in Google Cloud Console is missing
the `gmail.send` scope. The script works locally because the consent
was granted at some point, but the runner's IP may get different
behavior from Google if scopes are not declared.

**Solution:**

1. Google Cloud Console → APIs & Services → OAuth consent screen
2. Click **"Add or remove scopes"** (in the "Data Access" section)
3. Mark `https://www.googleapis.com/auth/gmail.send` (and any other
   scopes you need)
4. Click **"Update"** → **"Save and Continue"**
5. Re-run `node scripts/get-gmail-refresh-token.mjs` to get a new
   refresh token with the correct scope
6. Update the secret: `gh secret set GMAIL_OAUTH_REFRESH_TOKEN --body "<new-refresh-token>"`
7. Re-run the workflow

### Error: `Unable to locate executable file: pnpm` in GitHub Actions

**Cause:** incompatibility between `pnpm/action-setup@v4` and
`actions/setup-node@v4` with `cache: 'pnpm'` on Node 20+.

**Solution:** already fixed in this repo using **corepack** (bundled
with Node 20+). If you want to use a different approach, the workflow
YAML has explanatory comments.

### Error: `Please tell me who you are` during git commit in workflow

**Cause:** GitHub Actions runners do NOT have `user.name` /
`user.email` configured by default.

**Solution:** already fixed in this repo with a "Configure git
identity" step that runs before the pipeline.

### Error: `Nothing to commit, working tree clean` in workflow

**Cause:** the orchestrator (with `--commit`) already committed the
checkpoint internally. The "Commit checkpoint" step in the workflow is
redundant.

**Solution:** already fixed in this repo — the redundant step was
removed.

### Warning: Node.js 20 deprecated in workflow logs

**Cause:** GitHub is forcing runners to Node 24 because Node 20 will be
deprecated.

**Solution applied:** the workflow uses Node 22 (LTS) since this PR.
If you still see this warning, you are on an older version of the
workflow — update to the latest `main`.

**TF-2 completed.** See `openspec/changes/informe-semanal-hotmail/tasks.md`
for migration details.

## Forwarding emails to your main account

If you had to create a secondary Gmail account (because of APP) and
you want to receive the report in your main account:

1. Log in to `cusuga004@gmail.com`
2. Settings (⚙️) → "See all settings" → "Forwarding and POP/IMAP"
3. Click "Add a forwarding address" → enter your main account
4. Gmail sends a confirmation code — check your main account inbox
5. If APP blocks the confirmation link, you CANNOT forward
   (see TF-3 in tasks.md)
6. If the confirmation works, choose "keep Gmail's copy" or "mark as
   read and archive"

## Secrets and sensitive files

**NEVER** commit to the repo:

- `client_secret_*.json` — downloaded from Google Cloud Console
- `msal-cache.json` — output of scripts/get-msal-token-cache.mjs
- Your local `.env`
- Any output from the setup scripts

`.gitignore` already excludes most of these patterns. If you
accidentally commit one, **rotate the secret immediately** (regenerate
the cache or delete the credential in Google Cloud) — a secret in git
history is considered compromised even if you delete it later.
