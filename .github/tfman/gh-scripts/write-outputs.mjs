import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { appendGithubOutput, assertSafeRootPath } from '../lib/utils.mjs';
import { createMatrix } from '../lib/matrix.mjs';

function validateRoots(roots) {
  if (!Array.isArray(roots)) throw new Error('Expected an array of Terraform roots');
  for (const root of roots) assertSafeRootPath(root?.path);
}

export async function writeOutputs(kind, result, file = process.env.GITHUB_OUTPUT) {
  if (!file) throw new Error('GITHUB_OUTPUT is required');
  let outputs;
  if (kind === 'matrix') {
    validateRoots(result);
    outputs = {
      matrix: JSON.stringify(createMatrix(result)),
      'has-changes': String(result.length > 0),
    };
  } else if (kind === 'command') {
    if (!result || typeof result.done !== 'boolean' ||
        !['plan', 'apply', 'help', 'error'].includes(result.command) ||
        typeof result.message !== 'string' || !Array.isArray(result.tfTargets) ||
        !result.tfTargets.every(target => typeof target === 'string')) {
      throw new Error('Invalid command result');
    }
    validateRoots(result.targetDirs);
    outputs = {
      tf_targets_json: JSON.stringify(result.tfTargets),
      matrix: !result.done && result.targetDirs.length > 0
        ? JSON.stringify(createMatrix(result.targetDirs)) : '',
      command: result.command,
      done: String(result.done),
      message: result.message,
    };
  } else {
    throw new Error('Usage: write-outputs.mjs <matrix|command>');
  }
  await appendGithubOutput(outputs, file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const result = JSON.parse(input);
    await writeOutputs(process.argv[2], result);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
