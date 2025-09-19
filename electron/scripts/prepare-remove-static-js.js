// prepare-remove-static-js.js
// Helper to move legacy JS files to a backup folder (so they can be deleted safely by the author).
// This script does not run automatically; run it locally when you're ready.

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const files = [
  'static/app.js',
  'static/config.js',
  'static/viewer.js',
  'static/modules/bootstrap.js',
  'static/modules/chunk_mesher.js',
  'static/modules/chunks.js',
  'static/modules/events.js',
  'static/modules/main.js',
  'static/modules/players.js',
  'static/modules/scene.js',
  'static/modules/state.js',
  'static/modules/ui.js',
  'static/modules/utils.js',
  'static/modules/websocket.js'
];

const backupDir = path.join(repoRoot, 'static', '_legacy_js_backup');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

console.log('Files to move:');
files.forEach(rel => console.log('  ' + rel));

console.log('\nThis script will move the listed files into', backupDir);
console.log('It will NOT perform any git operations.');

if (process.argv.includes('--doit')) {
  for (const rel of files) {
    const abs = path.join(repoRoot, rel.replace('/', path.sep));
    if (fs.existsSync(abs)) {
      const dest = path.join(backupDir, path.basename(rel));
      console.log(`Moving ${abs} -> ${dest}`);
      fs.renameSync(abs, dest);
    } else {
      console.log(`Missing: ${abs}`);
    }
  }
  console.log('\nDone. You can `git status` to review changes and commit them on your branch.');
} else {
  console.log('\nDRY RUN: Pass --doit to actually move files.');
}
