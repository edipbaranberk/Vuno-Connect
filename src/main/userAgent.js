// Electron Chromium sürümüyle uyumlu Chrome User-Agent (Google bot tespiti için format kritik)
function readChromeVersion() {
  const v = process.versions.chrome;
  if (v && /^\d+\.\d+\.\d+\.\d+$/.test(v)) return v;
  return '131.0.0.0';
}

const CHROME_VERSION = readChromeVersion();
const CHROME_MAJOR = CHROME_VERSION.split('.')[0] || '131';

function platformToken() {
  if (process.platform === 'win32') {
    return 'Windows NT 10.0; Win64; x64';
  }
  if (process.platform === 'darwin') {
    const rel = process.getSystemVersion?.() || '10.15.7';
    return `Macintosh; Intel Mac OS X ${rel.replace(/\./g, '_')}`;
  }
  return 'X11; Linux x86_64';
}

function buildChromeUserAgent() {
  return `Mozilla/5.0 (${platformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;
}

/** Google oturum sayfalarında Ferdium/Rambox tarzı sürümsüz UA */
function chromelessUserAgent(fullUa) {
  return fullUa.replace(/Chrome\/[\d.]+/, 'Chrome');
}

function isGoogleAccountsUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'accounts.google.com' || hostname.endsWith('.accounts.google.com');
  } catch (_) {
    return /accounts\.google\.com/i.test(String(url || ''));
  }
}

function secChUaHeaders(major = CHROME_MAJOR) {
  return {
    'Sec-CH-UA': `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`,
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': process.platform === 'win32' ? '"Windows"' : process.platform === 'darwin' ? '"macOS"' : '"Linux"'
  };
}

module.exports = {
  CHROME_VERSION,
  CHROME_MAJOR,
  buildChromeUserAgent,
  chromelessUserAgent,
  isGoogleAccountsUrl,
  secChUaHeaders
};
