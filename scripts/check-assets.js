const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
const missing = [];

for (const htmlFile of htmlFiles) {
  const filePath = path.join(rootDir, htmlFile);
  const content = fs.readFileSync(filePath, 'utf8');
  const assetMatches = content.matchAll(/\/dist\/(\d+\.\d+\.\d+)\/(js\/[^"'\s)]+\.js)/g);
  const seen = new Set();
  for (const match of assetMatches) {
    const ref = match[0];
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);

    const version = match[1];
    const remainder = match[2];
    const assetPath = path.join(rootDir, 'dist', version, remainder);
    if (!fs.existsSync(assetPath)) {
      missing.push(`${ref} referenced in ${htmlFile}`);
    }
  }
}

if (missing.length > 0) {
  console.error('Missing JS assets:');
  for (const m of missing) {
    console.error(' -', m);
  }
  process.exit(1);
} else {
  console.log('All referenced JS assets exist.');
}
