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
    };

    it('should call detectChanges when no targets provided', async () => {
      let detectedDetails = null;
      const _detectChanges = async ({ base, head }) => {
        detectedDetails = { base, head };
        return [{ path: 'auto/detected' }];
      };
      
      const result = await run(
        { ...baseArgs },
        { _detectChanges }
      );

      assert.deepStrictEqual(detectedDetails, { base: 'base', head: 'head' });
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.matrix.include, [{ path: 'auto/detected' }]);
    });

    it('should call selectTargets when targets are provided', async () => {
      let selectedTargets = null;
      const _selectTargets = async ({ targets }) => {
        selectedTargets = targets;
        return [{ path: 'manual/target' }];
      };
      
      const result = await run(
        { ...baseArgs, commentBody: '/apply dev/app' },
        { _selectTargets }
      );

      assert.strictEqual(selectedTargets, 'dev/app');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.matrix.include, [{ path: 'manual/target' }]);
    });

    it('should handle dry-run (plan)', async () => {
      const _detectChanges = async () => [{ path: 'foo' }];
      
      const result = await run(
        { ...baseArgs, commentBody: '/apply --dry-run' },
        { _detectChanges }
      );

      assert.strictEqual(result.command, 'plan');
      assert.ok(result.result_message.includes('Planning'));
    });

    it('should handle no matching directories', async () => {
      const _detectChanges = async () => [];

      const result = await run(
        { ...baseArgs },
        { _detectChanges }
      );

      assert.strictEqual(result.command, 'noop');
      assert.ok(result.result_message.includes('No Terraform directories'));
    });

    it('should handle help command', async () => {
      const result = await run(
        { ...baseArgs, commentBody: '/apply --help' },
        {}
      );

      assert.strictEqual(result.command, 'help');
      assert.ok(result.result_message.includes('Usage'));
    });
  });
});
