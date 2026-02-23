#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run as runDetectChanges } from './commands/detect-changes.mjs';
import { run as runSelectTargets } from './commands/select-targets.mjs';
import { run as runGenerateDeps } from './commands/generate-deps.mjs';
import { run as runPrepareCustomCommand } from './commands/prepare-custom-command.mjs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node index.mjs <command> [options]");
  process.exit(1);
}

const command = args[0];
const commandArgs = args.slice(1);

async function main() {
  try {
    switch (command) {
      case 'detect-changes': {
        const { values } = parseArgs({
          args: commandArgs,
          options: {
            base: { type: 'string' },
            head: { type: 'string' }
          },
          strict: false // allow other args? no, but strict ensures valid options
        });
        const result = await runDetectChanges(values);
        console.log(JSON.stringify({ include: result }));
        break;
      }
      case 'select-targets': {
        const { values } = parseArgs({
          args: commandArgs,
          options: {
            targets: { type: 'string' }
          }
        });
        const result = await runSelectTargets(values);
        console.log(JSON.stringify({ include: result }));
        break;
      }
      case 'generate-deps': {
        const { values } = parseArgs({
          args: commandArgs,
          options: {
            root: { type: 'string' },
            output: { type: 'string' },
            'ignore-file': { type: 'string' }
          }
        });
        await runGenerateDeps(values);
        break;
      }
      case 'prepare-custom-command': {
        const { values } = parseArgs({
          args: commandArgs,
          options: {
            'comment-body': { type: 'string' },
            'base-sha': { type: 'string' },
            'head-sha': { type: 'string' },
            output: { type: 'string' }
          }
        });
        await runPrepareCustomCommand({
          commentBody: values['comment-body'],
          baseSha: values['base-sha'],
          headSha: values['head-sha'],
          output: values.output
        });
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
       console.error(`Error: ${error.message}`);
    } else {
       console.error(`❌ ${error.message}`);
    }
    process.exit(1);
  }
}

main();
