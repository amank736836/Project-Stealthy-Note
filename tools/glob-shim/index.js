'use strict';
const fs = require('node:fs');
const path = require('node:path');
const picomatch = require('picomatch');
const MAGIC = /[*?{}()[\]!+@|]/;
function config(value = {}) {
  return { cwd: path.resolve(value.cwd || process.cwd()), dot: value.dot === true, absolute: value.absolute === true, onlyDirectories: value.onlyDirectories === true, onlyFiles: value.onlyFiles !== false, ignore: Array.isArray(value.ignore) ? value.ignore : value.ignore ? [value.ignore] : [] };
}
function* walk(root, options) {
  const stack = [{ dir: '', depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { dir, depth } = stack.pop();
    if (depth > 40) continue;
    let entries;
    try { entries = fs.readdirSync(dir ? path.join(root, dir) : root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++count > 100000) return;
      if ((!options.dot && entry.name.startsWith('.')) || entry.isSymbolicLink()) continue;
      const relative = dir ? dir + '/' + entry.name : entry.name;
      yield { relative, directory: entry.isDirectory(), file: entry.isFile() };
      if (entry.isDirectory()) stack.push({ dir: relative, depth: depth + 1 });
    }
  }
}
function normalize(pattern) {
  let value = pattern.split('\\').join('/');
  while (value.endsWith('/')) value = value.slice(0, -1);
  return value || '.';
}
function globSync(patterns, inputOptions) {
  const options = config(inputOptions);
  const output = new Set();
  for (const raw of Array.isArray(patterns) ? patterns : [patterns]) {
    if (typeof raw !== 'string' || !raw) continue;
    const pattern = normalize(raw);
    if (!MAGIC.test(pattern)) {
      const absolute = path.resolve(options.cwd, pattern);
      let stat;
      try { stat = fs.statSync(absolute); } catch { continue; }
      const wanted = options.onlyDirectories ? stat.isDirectory() : options.onlyFiles ? stat.isFile() : true;
      if (wanted) output.add(options.absolute ? absolute : path.relative(options.cwd, absolute).split(path.sep).join('/') || '.');
      continue;
    }
    const matches = picomatch(pattern, { dot: options.dot });
    const ignored = options.ignore.length ? picomatch(options.ignore, { dot: options.dot }) : () => false;
    for (const entry of walk(options.cwd, options)) {
      const wanted = options.onlyDirectories ? entry.directory : options.onlyFiles ? entry.file : true;
      if (wanted && !ignored(entry.relative) && matches(entry.relative)) output.add(options.absolute ? path.join(options.cwd, entry.relative) : entry.relative);
    }
  }
  return Array.from(output).sort();
}
async function glob(patterns, inputOptions) { return globSync(patterns, inputOptions); }
glob.sync = globSync;
glob.glob = glob;
glob.globSync = globSync;
glob.default = glob;
module.exports = glob;
