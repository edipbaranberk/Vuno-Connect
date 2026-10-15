// Vuno Connect - Dosya loglaması
// Çökmeler ve hatalar userData/logs/ altına da yazılır — sessiz çökme teşhisi için.
const path = require('path');
const fs = require('fs');

function logToFile(msg) {
  try {
    const dir = path.join(require('electron').app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, `vuno-${new Date().toISOString().slice(0, 10)}.log`),
      `${new Date().toISOString()} ${msg}\n`
    );
  } catch (_) {}
}

function attachConsoleHooks() {
  const origError = console.error;
  console.error = (...args) => {
    try { logToFile('[HATA] ' + args.map((a) => (a && a.stack) || String(a)).join(' ')); } catch (_) {}
    origError(...args);
  };
  const origWarn = console.warn;
  console.warn = (...args) => {
    try { logToFile('[UYARI] ' + args.map(String).join(' ')); } catch (_) {}
    origWarn(...args);
  };
}

module.exports = { logToFile, attachConsoleHooks };
