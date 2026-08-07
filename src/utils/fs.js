import fs from 'fs';
import path from 'path';

/**
 * Recursively copies a directory, skipping output-*, test-results-*, .git, node_modules, and test-setup.sh.
 * @param {string} src - Source directory path
 * @param {string} dest - Destination directory path
 */
export function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip nested output/results directories, git files, node_modules, and test-setup.sh to avoid infinite recursion or copying setup files
    if (
      entry.name.startsWith('output-') ||
      entry.name.startsWith('test-results-') ||
      entry.name === '.git' ||
      entry.name === 'node_modules' ||
      entry.name === 'test-setup.sh'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
