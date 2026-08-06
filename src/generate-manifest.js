import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const useCasesDir = path.join(rootDir, 'use-cases');

/**
 * Scans the use-cases directory for all test-results-*.json files and output folders.
 * Writes reports-manifest.json to the workspace root.
 * @returns {object} Manifest data structure
 */
export function generateManifest() {
  const runs = [];
  const discoveredUseCases = [];

  if (!fs.existsSync(useCasesDir)) {
    console.warn(`⚠️ [MANIFEST] use-cases directory not found at ${useCasesDir}`);
    return { generatedAt: new Date().toISOString(), useCases: [], runs: [] };
  }

  const caseEntries = fs.readdirSync(useCasesDir, { withFileTypes: true });

  for (const entry of caseEntries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

    const caseName = entry.name;
    discoveredUseCases.push(caseName);
    const casePath = path.join(useCasesDir, caseName);

    const caseFiles = fs.readdirSync(casePath, { withFileTypes: true });

    // Look for test-results-*.json files
    for (const file of caseFiles) {
      if (file.isFile() && file.name.startsWith('test-results-') && file.name.endsWith('.json')) {
        const jsonFilePath = path.join(casePath, file.name);
        const match = file.name.match(/^test-results-(.+)\.json$/);
        const timestamp = match ? match[1] : '';

        let resultData = null;
        try {
          const raw = fs.readFileSync(jsonFilePath, 'utf8');
          resultData = JSON.parse(raw);
        } catch (err) {
          console.error(`❌ [MANIFEST] Error parsing JSON file ${jsonFilePath}:`, err.message);
          continue;
        }

        const outputDirName = `output-${timestamp}`;
        const outputDirPath = path.join(casePath, outputDirName);
        const hasOutputDir = fs.existsSync(outputDirPath) && fs.statSync(outputDirPath).isDirectory();

        const relJsonPath = path.relative(rootDir, jsonFilePath).replace(/\\/g, '/');
        const relOutputDir = hasOutputDir ? path.relative(rootDir, outputDirPath).replace(/\\/g, '/') : null;

        // Check for specific AGENT-* artifact files
        const checkArtifact = (filename) => {
          if (!hasOutputDir) return null;
          const artPath = path.join(outputDirPath, filename);
          if (fs.existsSync(artPath)) {
            return path.relative(rootDir, artPath).replace(/\\/g, '/');
          }
          return null;
        };

        const artifacts = {
          walkthrough: checkArtifact('AGENT-WALKTHROUGH.md'),
          stdout: checkArtifact('AGENT-OUTPUT.out'),
          stderr: checkArtifact('AGENT-OUTPUT.err'),
          prompt: checkArtifact('PROMPT.md'),
          readme: checkArtifact('README.md'),
        };

        runs.push({
          id: `${caseName}-${timestamp}`,
          caseName: resultData.caseName || caseName,
          timestamp,
          jsonPath: relJsonPath,
          outputDir: relOutputDir,
          artifacts,
          data: resultData,
        });
      }
    }
  }

  // Sort runs by timestamp descending (newest first)
  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const manifest = {
    generatedAt: new Date().toISOString(),
    useCases: discoveredUseCases.sort(),
    runs,
  };

  const manifestPath = path.join(rootDir, 'reports-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`📋 [MANIFEST] Updated reports-manifest.json with ${runs.length} test run(s) across ${discoveredUseCases.length} use case(s).`);

  return manifest;
}

// Allow direct execution: node src/generate-manifest.js
if (process.argv[1] && process.argv[1].endsWith('generate-manifest.js')) {
  generateManifest();
}
