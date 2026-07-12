// Integrity check: find node_modules packages whose package.json or entry file is missing.
import fs from 'fs';
import path from 'path';

const root = process.argv[2] || 'node_modules';
const broken = [];

function checkPkg(dir) {
  const pj = path.join(dir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  } catch {
    broken.push(dir + '  (package.json missing/unreadable)');
    return;
  }
  if (pkg.main) {
    const m = path.join(dir, pkg.main);
    const candidates = [m, m + '.js', m + '.cjs', m + '.mjs', path.join(m, 'index.js')];
    if (!candidates.some((c) => fs.existsSync(c))) {
      broken.push(dir + `  (main "${pkg.main}" missing)`);
      return;
    }
  }
  // nested node_modules (e.g. @capacitor/cli/node_modules/semver)
  const nested = path.join(dir, 'node_modules');
  if (fs.existsSync(nested)) walk(nested);
}

function walk(nm) {
  for (const entry of fs.readdirSync(nm)) {
    if (entry.startsWith('.')) continue;
    const p = path.join(nm, entry);
    if (entry.startsWith('@')) {
      for (const sub of fs.readdirSync(p)) {
        if (!sub.startsWith('.')) checkPkg(path.join(p, sub));
      }
    } else {
      checkPkg(p);
    }
  }
}

walk(root);
console.log(broken.length ? broken.join('\n') : 'ALL-OK');
console.log('broken:', broken.length);
