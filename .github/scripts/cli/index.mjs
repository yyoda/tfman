#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run as runDetectChanges } from './commands/detect-changes.mjs';
import { run as runSelectTargets } from './commands/select-targets.mjs';
import { run as runGenerateDeps } from './commands/generate-deps.mjs';
import { run as runOperateCommand } from './commands/operate-command.mjs';

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
            head: { type: 'string' },
            'deps-file': { type: 'string' },
            output: { type: 'string' }
          },
          strict: false
        });
        const result = await runDetectChanges(values);
        if (result && !values.output) {
             console.log(JSON.stringify(result, null, 2));
        }
        break;
      }
      case 'select-targets': {
        const { values } = parseArgs({
            args: commandArgs,
            options: {
                targets: { type: 'string' },
                output: { type: 'string' }
            },
            strict: false
        });
        const result = await runSelectTargets(values);
        if (result && !values.output) {
            console.log(JSON.stringify(result, null, 2));
        }
        break;
      }
      case 'generate-deps': {
        const { values } = parseArgs({
          args: commandArgs,
          options: {
            root: { type: 'string' },
            output: { type: 'string' },
            'ignore-file': { type: 'string' }
          },
          strict: false
        });
        await runGenerateDeps(values);
        break;
      }
      case 'operate-command': {
        const { values } = parseArgs({
          args: commandArgs,
          options: {
            'comment-body': { type: 'string' },
            'base-sha': { type: 'string' },
            'head-sha': { type: 'string' }
          },
          strict: false
        });
        const result = await runOperateCommand(values);
        if (result) {
          console.log(JSON.stringify(result, null, 2));
        }
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
