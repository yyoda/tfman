import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { parseCommand, run } from '../../../scripts/cli/commands/prepare-custom-command.mjs';

describe('cli/commands/prepare-custom-command', () => {

  describe('parseCommand', () => {
    it('should return null for empty body', () => {
      assert.strictEqual(parseCommand(null), null);
      assert.strictEqual(parseCommand(''), null);
    });

    it('should return null for non-apply commands', () => {
      assert.strictEqual(parseCommand('/plan'), null);
      assert.strictEqual(parseCommand('hello world'), null);
    });

    it('should parse basic /apply command', () => {
      const result = parseCommand('/apply');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, []);
    });

    it('should parse /apply with targets', () => {
      const result = parseCommand('/apply dev/frontend prod/backend');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, ['dev/frontend', 'prod/backend']);
    });

    it('should parse dry-run flag', () => {
      const result = parseCommand('/apply --dry-run');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targets, []);
    });

    it('should parse dry-run flag with targets', () => {
      const result = parseCommand('/apply dev/db --dry-run');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targets, ['dev/db']);
    });

    it('should return help command', () => {
      const result = parseCommand('/apply --help');
      assert.strictEqual(result.command, 'help');
      assert.ok(result.helpMsg);
    });

    it('should ignore quotes in args', () => {
      const result = parseCommand('/apply "dev/foo" \'prod/bar\'');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, ['dev/foo', 'prod/bar']);
    });
  });

  describe('run', () => {
    const baseArgs = {
      commentBody: '/apply',
      baseSha: 'base',
      headSha: 'head',
      output: 'output.json'
    };

    it('should call detectChanges when no targets provided', async () => {
      let detectedDetails = null;
      const _detectChanges = async ({ base, head }) => {
        detectedDetails = { base, head };
        return [{ path: 'auto/detected' }];
      };
      
      let writtenFile = null;
      const _writeFile = async (path, content) => {
        writtenFile = { path, content: JSON.parse(content) };
      };

      await run(
        { ...baseArgs },
        { _detectChanges, _writeFile }
      );

      assert.deepStrictEqual(detectedDetails, { base: 'base', head: 'head' });
      assert.strictEqual(writtenFile.path, 'output.json');
      assert.strictEqual(writtenFile.content.command, 'apply');
      assert.deepStrictEqual(writtenFile.content.matrix.include, [{ path: 'auto/detected' }]);
    });

    it('should call selectTargets when targets are provided', async () => {
      let selectedTargets = null;
      const _selectTargets = async ({ targets }) => {
        selectedTargets = targets;
        return [{ path: 'manual/target' }];
      };
      
      let writtenFile = null;
      const _writeFile = async (path, content) => {
        writtenFile = { path, content: JSON.parse(content) };
      };

      await run(
        { ...baseArgs, commentBody: '/apply dev/app' },
        { _selectTargets, _writeFile }
      );

      assert.strictEqual(selectedTargets, 'dev/app');
      assert.strictEqual(writtenFile.content.command, 'apply');
      assert.deepStrictEqual(writtenFile.content.matrix.include, [{ path: 'manual/target' }]);
    });

    it('should handle dry-run (plan)', async () => {
      const _detectChanges = async () => [{ path: 'foo' }];
      let writtenFile = null;
      const _writeFile = async (path, content) => {
        writtenFile = { path, content: JSON.parse(content) };
      };

      await run(
        { ...baseArgs, commentBody: '/apply --dry-run' },
        { _detectChanges, _writeFile }
      );

      assert.strictEqual(writtenFile.content.command, 'plan');
      assert.ok(writtenFile.content.result_message.includes('Planning'));
    });

    it('should handle no matching directories', async () => {
      const _detectChanges = async () => [];
      let writtenFile = null;
      const _writeFile = async (path, content) => {
        writtenFile = { path, content: JSON.parse(content) };
      };

      await run(
        { ...baseArgs },
        { _detectChanges, _writeFile }
      );

      assert.strictEqual(writtenFile.content.command, 'noop');
      assert.ok(writtenFile.content.result_message.includes('No Terraform directories'));
    });

    it('should handle help command', async () => {
      let writtenFile = null;
      const _writeFile = async (path, content) => {
        writtenFile = { path, content: JSON.parse(content) };
      };

      await run(
        { ...baseArgs, commentBody: '/apply --help' },
        { _writeFile }
      );

      assert.strictEqual(writtenFile.content.command, 'help');
      assert.ok(writtenFile.content.result_message.includes('Usage'));
    });
  });
});
