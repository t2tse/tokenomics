import fs from 'fs';
import path from 'path';

/**
 * Recursively copies a directory, skipping output-*, test-results-*, .git, and node_modules.
 * @param {string} src - Source directory path
 * @param {string} dest - Destination directory path
 */
export function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Skip nested output/results directories, git files, and node_modules to avoid infinite recursion
    if (
      entry.name.startsWith('output-') ||
      entry.name.startsWith('test-results-') ||
      entry.name === '.git' ||
      entry.name === 'node_modules'
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
