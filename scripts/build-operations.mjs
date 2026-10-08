import { createRequire, builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const require = createRequire(new URL('../client/package.json', import.meta.url));
const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href);
const root = new URL('../', import.meta.url);
await mkdir(new URL('operations/', root), { recursive: true });
const bundle = await rolldown({
  input: fileURLToPath(new URL('deploy/backup-upload.cjs', root)),
  platform: 'node',
  external: [...builtinModules, ...builtinModules.map(name => 'node:' + name)],
  onwarn(warning) {
    if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
    process.stderr.write(warning.message + '\n');
  }
});
try {
  await bundle.write({
    file: fileURLToPath(new URL('operations/backup-upload.cjs', root)),
    format: 'cjs',
    codeSplitting: false
  });
} finally {
  await bundle.close();
}
// Requiring the standalone artifact must work without the application loader.
// The uploader's CLI remains inert here because require.main is this script.
const uploader = require(fileURLToPath(new URL('operations/backup-upload.cjs', root)));
if (typeof uploader.uploadSet !== 'function' || typeof uploader.verifyObject !== 'function') {
  throw new Error('Bundled backup operations entrypoint is incomplete');
}
