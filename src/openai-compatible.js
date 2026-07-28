const SUPPORTED_BASE_URL_PROTOCOLS = new Set(['http:', 'https:']);
const OPTIONAL_API_KEY_PLACEHOLDER = 'not-required';

function normalizeBaseUrl(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return '';

  let parsedUrl;
  try {
    parsedUrl = new URL(input);
  } catch {
    throw new Error('Base URL must be a valid HTTP or HTTPS URL.');
  }

  if (!SUPPORTED_BASE_URL_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error('Base URL must use HTTP or HTTPS.');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Base URL must not contain embedded credentials.');
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error('Base URL must not contain a query string or fragment.');
  }

  return parsedUrl.toString().replace(/\/+$/, '');
}

function createCompatibleClientOptions(apiKey, baseUrl) {
  const baseURL = normalizeBaseUrl(baseUrl);
  if (!baseURL) {
    throw new Error('Set a Base URL for the Custom provider.');
  }

  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  return {
    apiKey: normalizedApiKey || OPTIONAL_API_KEY_PLACEHOLDER,
    baseURL
  };
}

module.exports = {
  OPTIONAL_API_KEY_PLACEHOLDER,
  createCompatibleClientOptions,
  normalizeBaseUrl
};
