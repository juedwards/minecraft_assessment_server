// build-static.js — simple esbuild wrapper used by npm script
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const staticDir = path.join(repoRoot, 'static');
const outBundle = path.join(staticDir, 'dist', 'bundle.js');
const distStaticDir = path.join(repoRoot, 'dist', 'static');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(srcDir, e.name);
    const destPath = path.join(destDir, e.name);
    if (e.isDirectory()) copyDir(srcPath, destPath);
    else copyFile(srcPath, destPath);
  }
}

esbuild.build({
  entryPoints: ['static/modules/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  outfile: 'static/dist/bundle.js',
  sourcemap: true,
  target: ['es2020'],
  logLevel: 'info'
}).then(() => {
  console.log('\nBundle built. Copying static assets into dist/static...');
  // Ensure dist/static exists and copy index.html, css, images, and the bundle
  fs.mkdirSync(distStaticDir, { recursive: true });

  const filesToCopy = ['index.html', 'app.css', 'logo.png'];
  for (const f of filesToCopy) {
    const src = path.join(staticDir, f);
    const dest = path.join(distStaticDir, f);
    if (fs.existsSync(src)) copyFile(src, dest);
  }

  // Copy static/dist (bundle and sourcemap) into dist/static/dist
  copyDir(path.join(staticDir, 'dist'), path.join(distStaticDir, 'dist'));

  console.log('Static assets copied to', distStaticDir);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
