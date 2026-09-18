const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
const dirs = ['css', 'js', 'assets'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let files = 0;
for (const name of fs.readdirSync(root)) {
  if (name.endsWith('.html')) {
    fs.copyFileSync(path.join(root, name), path.join(dist, name));
    files++;
  }
}
for (const name of dirs) {
  const src = path.join(root, name);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(dist, name), { recursive: true });
    files += fs.readdirSync(src, { recursive: true }).filter(f => fs.statSync(path.join(src, f)).isFile()).length;
  }
}

console.log(`dist ready (${files} files) -> ${dist}`);
