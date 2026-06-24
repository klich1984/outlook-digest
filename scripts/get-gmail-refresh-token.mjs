#!/usr/bin/env node
/**
 * One-shot helper to obtain a Gmail OAuth2 refresh token for the
 * mail-digest pipeline. Run this once locally, then store the printed
 * token as GMAIL_OAUTH_REFRESH_TOKEN in GitHub Secrets.
 *
 * Usage (from Git Bash on Windows, or any POSIX shell):
 *   export GMAIL_CLIENT_ID="<your-client-id>.apps.googleusercontent.com"
 *   export GMAIL_CLIENT_SECRET="<your-client-secret>"
 *   node scripts/get-gmail-refresh-token.mjs
 *
 * What it does:
 *   1. Starts a local HTTP server on a random free port.
 *   2. Opens the system browser to Google's OAuth2 consent screen with
 *      scope=gmail.send and access_type=offline.
 *   3. Waits for Google to redirect back to the local server with the
 *      authorization code.
 *   4. Exchanges the code for an access token + refresh token.
 *   5. Prints the refresh token to stdout so the developer can copy it
 *      into GitHub Secrets.
 *
 * Security notes:
 *   - The script only handles YOUR OWN Google account. It does not
 *     persist or transmit the refresh token to any third party.
 *   - The HTTP server binds to 127.0.0.1 only — never reachable from
 *     the network.
 *   - Close the browser tab after the script finishes; the token has
 *     already been captured.
 *
 * Prerequisite:
 *   You need a Google Cloud project with the Gmail API enabled and an
 *   OAuth 2.0 Client ID of type "Desktop application" (NOT "Web
 *   application" — the redirect URI must be http://localhost or
 *   http://127.0.0.1).
 *
 * Troubleshooting:
 *   - "400: policy_enforced" → your Google account has Advanced
 *     Protection Program (APP) enabled. Use a different Gmail account
 *     that does NOT have APP.
 *   - "403: access_denied" → your email is missing as a test user in
 *     the OAuth consent screen. Add it under "Test users".
 *   - "No refresh_token in response" → the app already issued a refresh
 *     token for this user. Revoke access at
 *     https://myaccount.google.com/permissions and re-run the script.
 */

import http from 'node:http';
import { URL } from 'node:url';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/gmail.send'];
const REDIRECT_HOST = '127.0.0.1';

function readEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`ERROR: environment variable ${name} is not set.`);
    console.error(`Set it with: export ${name}="<value>"`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const clientId = readEnv('GMAIL_CLIENT_ID');
  const clientSecret = readEnv('GMAIL_CLIENT_SECRET');

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${REDIRECT_HOST}:0/oauth2callback`, // placeholder, replaced below
  );

  // Bind a temporary server to get a random free port, then rewrite the
  // redirect URI on the OAuth2 client to match. This avoids needing the
  // user to pre-configure a specific port in Google Cloud Console.
  const server = http.createServer();
  await new Promise((resolve) => {
    server.listen(0, REDIRECT_HOST, resolve);
  });
  const { port } = server.address();
  const redirectUri = `http://${REDIRECT_HOST}:${port}/oauth2callback`;
  oauth2Client.redirectUri = redirectUri;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force Google to re-issue a refresh token
    scope: SCOPES,
  });

  console.log('Opening browser to Google consent screen...');
  console.log(`If the browser does not open automatically, visit:\n  ${authUrl}\n`);

  // Try to open the browser. open() returns a Promise we don't await
  // because the HTTP server is the actual blocker.
  const { default: open } = await import('open');
  open(authUrl).catch(() => {
    // Silently ignore — the user can paste the URL manually.
  });

  // Wait for the OAuth2 callback.
  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://${REDIRECT_HOST}:${port}`);
        if (reqUrl.pathname !== '/oauth2callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const error = reqUrl.searchParams.get('error');
        if (error) {
          res.statusCode = 400;
          res.end(`Google returned an error: ${error}`);
          reject(new Error(error));
          return;
        }
        const authCode = reqUrl.searchParams.get('code');
        if (!authCode) {
          res.statusCode = 400;
          res.end('Missing authorization code.');
          reject(new Error('missing code'));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          '<html><body style="font-family:sans-serif;text-align:center;padding:40px">' +
            '<h1>Authorization complete</h1>' +
            '<p>You can close this tab and return to the terminal.</p>' +
            '</body></html>',
        );
        resolve(authCode);
      } catch (err) {
        reject(err);
      }
    });
    server.on('error', reject);
  });

  // Stop the HTTP server; we have the code.
  await new Promise((resolve) => server.close(resolve));

  console.log('Exchanging authorization code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error('\nERROR: Google did not return a refresh_token.');
    console.error('This usually means the app already has a refresh token for this user.');
    console.error('Fix: go to https://myaccount.google.com/permissions');
    console.error('     → find "Mail Digest" → Remove → run this script again.');
    process.exit(1);
  }

  console.log('\nSUCCESS. Refresh token obtained.');
  console.log('Copy the line below into GitHub Secrets as GMAIL_OAUTH_REFRESH_TOKEN:\n');
  console.log(tokens.refresh_token);
  console.log('\nDone. The token is also valid until manually revoked.');
}

main().catch((err) => {
  console.error('Unexpected error:', err.message || err);
  process.exit(1);
});
