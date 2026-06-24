#!/usr/bin/env node
/**
 * One-shot helper to obtain a Microsoft Graph (MSA / Hotmail / Outlook.com)
 * token cache in the native MSAL Node format.
 *
 * Why this script exists:
 *   The CLI from @softeria/ms-365-mcp-server prints the cache wrapped in a
 *   JSON envelope (`{success, message, userData}`) which is NOT what
 *   @azure/msal-node expects. This script uses @azure/msal-node directly,
 *   which produces a cache the orchestrator can load verbatim.
 *
 * Usage:
 *   export MSAL_CLIENT_ID="<your-azure-app-client-id>"
 *   node scripts/get-msal-token-cache.mjs
 *
 * The script will:
 *   1. Start a local HTTP server on a random free port.
 *   2. Open the system browser to Microsoft's OAuth2 consent screen.
 *   3. Wait for Microsoft to redirect back with the authorization code.
 *   4. Exchange the code for tokens (with PKCE).
 *   5. Print the FULL MSAL Node cache JSON to stdout (a single line).
 *   6. Copy that line into GitHub Secrets as MSAL_TOKEN_CACHE_JSON.
 *
 * Prerequisite:
 *   You need a Client ID for a "Mobile and desktop applications" / "Public
 *   client" Azure app registration. Tenant must be set to "consumers"
 *   (personal Microsoft accounts) or "common".
 *
 *   Quick way to get one for testing: register an app at
 *   https://entra.microsoft.com/#home → Applications → App registrations
 *   → New registration → "Personal Microsoft accounts only" → Redirect
 *   type: "Mobile and desktop applications" → add
 *   http://localhost/oauth2callback as redirect URI.
 */

import http from 'node:http';
import { URL } from 'node:url';
import {
  PublicClientApplication,
  LogLevel,
  InteractionRequiredAuthError,
} from '@azure/msal-node';

const REDIRECT_HOST = '127.0.0.1';
const REDIRECT_PORT = 8400;
const REDIRECT_PATH = '/oauth2callback';
const REDIRECT_URI = `http://${REDIRECT_HOST}:${REDIRECT_PORT}${REDIRECT_PATH}`;
const TENANT = 'consumers'; // MSA / personal accounts
const SCOPES = [
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'offline_access',
];

function readEnv(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`ERROR: environment variable ${name} is not set.`);
    console.error(`Set it with: export ${name}="<value>"`);
    process.exit(1);
  }
  return value;
}

async function waitForCode(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.on('request', (req, res) => {
      try {
        const reqUrl = new URL(req.url, REDIRECT_URI);
        if (reqUrl.pathname !== REDIRECT_PATH) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        const error = reqUrl.searchParams.get('error');
        if (error) {
          res.statusCode = 400;
          res.end(`Microsoft returned an error: ${error}`);
          reject(new Error(error));
          return;
        }
        const code = reqUrl.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.end('Missing authorization code.');
          reject(new Error('missing code'));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          '<html><body style="font-family:sans-serif;text-align:center;padding:40px">' +
            '<h1>Sign-in complete</h1>' +
            '<p>You can close this tab and return to the terminal.</p>' +
            '</body></html>',
        );
        resolve({ code, server });
      } catch (err) {
        reject(err);
      }
    });
    server.on('error', reject);
    server.listen(port, REDIRECT_HOST);
  });
}

async function main() {
  const clientId = readEnv('MSAL_CLIENT_ID');

  const pca = new PublicClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${TENANT}`,
    },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  });

  // Generate the auth URL with PKCE.
  const authUrl = await pca.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: REDIRECT_URI,
  });

  console.log('Opening browser to Microsoft sign-in...');
  console.log(`If the browser does not open, visit manually:\n  ${authUrl}\n`);

  const { default: open } = await import('open');
  open(authUrl).catch(() => {});

  // Wait for the redirect.
  const { code, server } = await waitForCode(REDIRECT_PORT);

  try {
    // Exchange the code for tokens. This populates the in-memory cache.
    const tokenResponse = await pca.acquireTokenByCode({
      code,
      scopes: SCOPES,
      redirectUri: REDIRECT_URI,
    });

    // Read the full cache from MSAL's in-memory store.
    const cacheJson = pca.getTokenCache().serialize();
    if (!cacheJson) {
      console.error('ERROR: failed to serialize MSAL cache.');
      process.exit(1);
    }

    // Validate the JSON parses (defensive check).
    const parsed = JSON.parse(cacheJson);
    if (!parsed.AppMetadata) {
      console.warn('WARNING: cache does not contain AppMetadata; the orchestrator will need an explicit MSAL_CLIENT_ID env var.');
    }

    console.log('\nSUCCESS. MSAL Node cache obtained.');
    console.log('Account:', tokenResponse.account?.username || '(unknown)');
    console.log('Expires in:', tokenResponse.expiresOn?.toISOString() || '(unknown)');
    console.log('Cache size:', cacheJson.length, 'bytes');
    console.log('Cache keys:', Object.keys(parsed).join(', '));
    console.log('\nCopy the line below into GitHub Secrets as MSAL_TOKEN_CACHE_JSON:\n');
    // Print on a single line for easy copy.
    console.log(cacheJson);
    console.log('\nDone.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  if (err instanceof InteractionRequiredAuthError) {
    console.error('Microsoft requires additional interaction. Re-run the script.');
  } else {
    console.error('Unexpected error:', err.message || err);
  }
  process.exit(1);
});
