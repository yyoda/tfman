#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run as runDetectChanges } from './commands/detect-changes.mjs';
import { run as runSelectTargets } from './commands/select-targets.mjs';
import { run as runGenerateDeps } from './commands/generate-deps.mjs';
import { run as runOperateCommand } from './commands/operate-command.mjs';
import { run as runWriteResult } from './commands/write-result.mjs';

// Commands share parsing and error handling; each declares its string options
// and whether its return value belongs on stdout.
const commands = {
  'detect-changes': {
    run: runDetectChanges,
    options: ['base', 'head', 'deps-file', 'output', 'root'],
    printResult: values => !values.output,
  },
  'select-targets': {
    run: runSelectTargets,
    options: ['targets', 'output', 'root'],
    printResult: values => !values.output,
  },
  'generate-deps': {
    run: runGenerateDeps,
    options: ['root', 'output', 'ignore-file'],
  },
  'write-result': {
    run: runWriteResult,
    options: ['path', 'command', 'outcome'],
  },
  'operate-command': {
    run: runOperateCommand,
    options: ['comment-body', 'base-sha', 'head-sha', 'roles', 'actor', 'root'],
    printResult: () => true,
  },
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('Usage: node index.mjs <command> [options]');
    process.exitCode = 1;
    return;
  }
  if (!Object.hasOwn(commands, command)) {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
    return;
  }

  try {
    const definition = commands[command];
    const { values } = parseArgs({
      args,
      options: Object.fromEntries(definition.options.map(name => [name, { type: 'string' }])),
      strict: false,
    });
    if (Object.hasOwn(values, 'github-output')) {
      throw new Error('--github-output has moved to gh-scripts/write-outputs.mjs; pipe CLI JSON to that script');
    }
    const result = await definition.run(values);
    if (result && definition.printResult?.(values)) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    const prefix = error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? 'Error:' : '❌';
    console.error(`${prefix} ${error.message}`);
    process.exitCode = 1;
  }
}

main();
