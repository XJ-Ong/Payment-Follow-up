import { spawnSync } from 'node:child_process';

// A published bundle always uses the real login and its own origin for API calls.
const env = {
  ...process.env,
  VITE_AUTH_MODE: 'session',
  VITE_DATA_MODE: 'api',
  VITE_API_URL: '',
};
for (const [file, args] of [
  ['node_modules/typescript/bin/tsc', ['-b']],
  ['node_modules/vite/bin/vite.js', ['build']],
]) {
  const result = spawnSync(process.execPath, [file, ...args], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
