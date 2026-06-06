/**
 * Playwright Global Teardown — AE Shared E2E Suite
 *
 * Cleans up auth state files written by globalSetup.ts.
 * These files contain access tokens and must not be committed.
 */

import * as fs from 'fs';
import * as path from 'path';

async function globalTeardown(): Promise<void> {
  const e2eDir = path.join(process.cwd(), 'e2e');

  const stateFiles = ['auth-state.json', 'auth-state-b.json'];

  for (const filename of stateFiles) {
    const filePath = path.join(e2eDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[globalTeardown] Deleted ${filename}`);
    }
  }
}

export default globalTeardown;
