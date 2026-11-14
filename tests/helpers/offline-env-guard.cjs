// Isolated helper runs must not inspect real target configuration or credentials.
const fs = require('node:fs');
const path = require('node:path');
const existsSync = fs.existsSync;
const readFileSync = fs.readFileSync;
const roots = [path.resolve(__dirname, '../..'), path.resolve(__dirname, '../../..')];
const envNames = new Set([
  '.env',
  ...['local', 'dev', 'qa', 'staging', 'prod'].flatMap((name) => [`.env.${name}`, `${name}.env`]),
]);
function isTargetEnv(file) {
  if (typeof file !== 'string') return false;
  const resolved = path.resolve(file);
  return roots.includes(path.dirname(resolved)) && envNames.has(path.basename(resolved));
}
fs.existsSync = function (file) {
  return isTargetEnv(file) ? false : existsSync.apply(this, arguments);
};
fs.readFileSync = function (file) {
  if (isTargetEnv(file)) throw new Error('Offline helper run blocked an environment file read');
  return readFileSync.apply(this, arguments);
};
