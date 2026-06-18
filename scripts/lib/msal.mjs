/**
 * MSAL Node wrapper for the Hotmail (MSA) authentication.
 *
 * Pipeline integration:
 *   1. The workflow stores the MSAL token cache as the
 *      MSAL_TOKEN_CACHE_JSON secret (a JSON string).
 *   2. loadMsal() deserializes it into a PublicClientApplication so
 *      subsequent acquireTokenSilent() calls hit MSAL's in-memory
 *      cache and only round-trip to Microsoft when the access token
 *      actually expired.
 *   3. acquireTokenSilent() returns { accessToken, account }.
 *   4. After the pipeline finishes, serializeCache() returns the
 *      possibly-rotated cache; the orchestrator (PR2) persists it
 *      back to the GitHub secret via `gh secret set`.
 *
 * Why PublicClientApplication (not Confidential):
 *   The locked design keeps the env list at 6 secrets — there is no
 *   client secret to feed ConfidentialClientApplication. MSA accounts
 *   are normally authenticated with a public client + device-code /
 *   interactive flow (the same flow @softeria/ms-365-mcp-server uses
 *   to generate the cache). The cache JSON contains everything MSAL
 *   needs to refresh silently, so the digest side can stay public.
 *
 * Client ID handling: there is no separate MSAL_CLIENT_ID env var.
 * loadMsal() first tries an explicit clientId argument, then falls
 * back to reading AppMetadata.clientId from the deserialized cache.
 * If neither is present, ConfigError is thrown with a clear
 * remediation hint.
 */

import { PublicClientApplication } from '@azure/msal-node';
import { TokenError, ConfigError } from './errors.mjs';

export const DEFAULT_SCOPES = Object.freeze([
  'Mail.Read',
  'Mail.ReadWrite',
  'offline_access',
]);

export function createMsalConfig({ clientId, tenantId = 'consumers' } = {}) {
  if (!clientId) {
    throw new ConfigError(
      'No se pudo determinar el MSAL client_id (proveer explicitamente o incluir AppMetadata en el cache JSON).',
      'msal-config',
    );
  }
  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
    },
    // Silent logger to avoid MSAL writing to stdout mid-run; the
    // pipeline logger handles diagnostics.
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: 3, // MsalLogLevel.warning
      },
    },
  };
}

/**
 * Reads the clientId from AppMetadata entries in the serialized cache.
 * MSAL Node stores one AppMetadata per (clientId, environment) pair, so
 * we take the first non-empty one.
 *
 * @param {string} cacheJson
 * @returns {string|null}
 */
function extractClientIdFromCache(cacheJson) {
  try {
    const parsed = typeof cacheJson === 'string' ? JSON.parse(cacheJson) : cacheJson;
    const metadata = parsed?.AppMetadata;
    if (!metadata || typeof metadata !== 'object') return null;
    for (const value of Object.values(metadata)) {
      if (value && typeof value.clientId === 'string' && value.clientId.length > 0) {
        return value.clientId;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Builds a PublicClientApplication from the supplied cache JSON.
 * The returned app has the cache pre-loaded so acquireTokenSilent can
 * find the account immediately.
 *
 * @param {{ clientId?: string, tenantId?: string, cacheJson: string|object }} opts
 * @returns {Promise<import('@azure/msal-node').PublicClientApplication>}
 */
export async function loadMsal({ clientId, tenantId = 'consumers', cacheJson } = {}) {
  if (cacheJson === undefined || cacheJson === null || cacheJson === '') {
    throw new TokenError('Falta MSAL_TOKEN_CACHE_JSON', 'msal-init');
  }

  const resolvedClientId = clientId || extractClientIdFromCache(cacheJson);
  const config = createMsalConfig({ clientId: resolvedClientId, tenantId });
  const app = new PublicClientApplication(config);

  const serialized = typeof cacheJson === 'string' ? cacheJson : JSON.stringify(cacheJson);
  try {
    app.tokenCache.deserialize(serialized);
  } catch (err) {
    throw new TokenError(
      `No se pudo deserializar el cache MSAL: ${err.message}`,
      'msal-init',
    );
  }

  const accounts = await app.getAllAccounts();
  if (accounts.length === 0) {
    throw new TokenError(
      'El cache MSAL no contiene cuentas. Regenera MSAL_TOKEN_CACHE_JSON con el flujo de login local.',
      'msal-init',
    );
  }

  return app;
}

/**
 * Acquires an access token silently for the first account in the app's
 * cache. Falls back to passing `account` explicitly when supplied.
 *
 * @param {import('@azure/msal-node').PublicClientApplication} app
 * @param {{ account?: object, scopes?: string[] }} [opts]
 * @returns {Promise<{ accessToken: string, account: object, expiresOn: Date|null }>}
 */
export async function acquireTokenSilent(app, { account, scopes = [...DEFAULT_SCOPES] } = {}) {
  if (!app) throw new TokenError('App MSAL no inicializada', 'msal-acquire');
  const target = account || (await app.getAllAccounts())[0];
  if (!target) {
    throw new TokenError('No hay cuentas MSAL para adquirir token', 'msal-acquire');
  }
  try {
    const result = await app.acquireTokenSilent({ account: target, scopes });
    if (!result || !result.accessToken) {
      throw new TokenError('MSAL devolvió resultado sin accessToken', 'msal-acquire');
    }
    return {
      accessToken: result.accessToken,
      account: result.account || target,
      expiresOn: result.expiresOn || null,
    };
  } catch (err) {
    if (err instanceof TokenError) throw err;
    throw new TokenError(
      `No se pudo adquirir token silenciosamente: ${err.message || String(err)}`,
      'msal-acquire',
    );
  }
}

/**
 * Serializes the in-memory MSAL cache back to a JSON string. After a
 * successful run, the orchestrator persists this to the
 * MSAL_TOKEN_CACHE_JSON secret so the rotated refresh token survives.
 *
 * @param {import('@azure/msal-node').PublicClientApplication} app
 * @returns {string}
 */
export function serializeCache(app) {
  if (!app || !app.tokenCache) {
    throw new TokenError('App MSAL no inicializada para serializar', 'msal-cache');
  }
  return app.tokenCache.serialize();
}
