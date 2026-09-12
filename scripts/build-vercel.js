const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'public');
const assets = ['index.html', 'app.js', 'api-client.js', 'style.css', 'full.css', 'quiz.css', 'contract.css', 'responsive.css'];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const asset of assets) {
  fs.copyFileSync(path.join(root, asset), path.join(output, asset));
}
