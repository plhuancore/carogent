import { access, chmod, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'darwin' && process.platform !== 'linux') {
  process.exit(0);
}

const helperPath = join(
  process.cwd(),
  'node_modules',
  'node-pty',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'spawn-helper'
);

try {
  await access(helperPath, constants.F_OK);
  const current = await stat(helperPath);

  if ((current.mode & 0o111) === 0) {
    await chmod(helperPath, 0o755);
    console.log(`Fixed node-pty spawn-helper permissions: ${helperPath}`);
  }
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.warn(`Could not fix node-pty spawn-helper permissions: ${error.message}`);
  }
}
