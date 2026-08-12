// Builds dist/ for deployment: copies the static site and obfuscates the
// shipped JS (in particular data/phrases.js) so future-day answers aren't
// sitting in plain text in the browser bundle. Source files are untouched.
import JavaScriptObfuscator from 'javascript-obfuscator';
import { cpSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIST = join(ROOT, 'dist');

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 1,
  rotateStringArray: true,
  renameGlobals: false,
  identifierNamesGenerator: 'mangled',
};

rmSync(DIST, { recursive: true, force: true });
for (const entry of ['index.html', 'css', 'js', 'data']) {
  cpSync(join(ROOT, entry), join(DIST, entry), { recursive: true });
}

function obfuscateDir(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      obfuscateDir(full);
    } else if (extname(full) === '.js') {
      const src = readFileSync(full, 'utf8');
      const out = JavaScriptObfuscator.obfuscate(src, OBFUSCATOR_OPTIONS).getObfuscatedCode();
      writeFileSync(full, out);
    }
  }
}

obfuscateDir(join(DIST, 'js'));
obfuscateDir(join(DIST, 'data'));

console.log('Built dist/ with obfuscated js/ and data/');
