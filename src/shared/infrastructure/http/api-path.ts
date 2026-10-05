// Every route lives under /api/v{n}. Cookie paths and OAuth redirect URIs are
// built from the same constants so they cannot drift from the router.
export const API_PREFIX = 'api';
export const API_DEFAULT_VERSION = '1';
export const API_BASE_PATH = `/${API_PREFIX}/v${API_DEFAULT_VERSION}`;
