import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCommand, run } from '../../../scripts/cli/commands/prepare-custom-command.mjs';

describe('cli/commands/prepare-custom-command', () => {

  describe('parseCommand', () => {
    it('should return null for empty body', () => {
      assert.strictEqual(parseCommand(null), null);
      assert.strictEqual(parseCommand(''), null);
    });

    it('should return null for invalid commands', () => {
      assert.strictEqual(parseCommand('/invalid'), null);
      assert.strictEqual(parseCommand('hello world'), null);
    });

    it('should parse basic /apply command', () => {
      const result = parseCommand('/apply');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, []);
    });

    it('should parse basic /plan command', () => {
      const result = parseCommand('/plan');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targets, []);
    });

    it('should parse /help command', () => {
      const result = parseCommand('/help');
      assert.strictEqual(result.command, 'help');
      assert.ok(result.message.includes('Usage'));
    });

    it('should parse /apply with targets', () => {
      const result = parseCommand('/apply dev/frontend prod/backend');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, ['dev/frontend', 'prod/backend']);
    });

    it('should ignore quotes and split args correctly', () => {
      const result = parseCommand('/apply "dev/foo bar" \'prod/baz\'');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, ['dev/foo bar', 'prod/baz']);
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
      assert.deepStrictEqual(result.targets, [{ path: 'auto/detected' }]);
    });

    it('should call selectTargets when targets are provided', async () => {
      let selectedTargetsArgs = null;
      const _selectTargets = async (args) => {
        selectedTargetsArgs = args;
        return [{ path: 'manual/target' }];
      };
      
      const result = await run(
        { ...baseArgs, commentBody: '/apply dev/app' },
        { _selectTargets }
      );

      assert.deepStrictEqual(selectedTargetsArgs, { targets: 'dev/app' });
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, [{ path: 'manual/target' }]);
    });

    it('should return skipped when parsing fails', async () => {
      const result = await run(
        { ...baseArgs, commentBody: '/invalid' },
        {}
      );

      assert.strictEqual(result.command, 'skipped');
      assert.ok(result.message.includes('Not a valid command'));
    });

    it('should return skipped when detectChanges finds nothing', async () => {
      const _detectChanges = async () => [];

      const result = await run(
        { ...baseArgs },
        { _detectChanges }
      );
      
      assert.strictEqual(result.command, 'skipped');
      assert.ok(result.message.includes('No Terraform directories matched'));
    });

    it('should return help message', async () => {
      const result = await run(
        { ...baseArgs, commentBody: '/help' },
        {}
      );

      assert.strictEqual(result.command, 'help');
      assert.ok(result.message.includes('Usage'));
    });

    it('should return skipped on error', async () => {
      const _detectChanges = async () => { throw new Error('Boom'); };

      const result = await run(
        { ...baseArgs },
        { _detectChanges }
      );

      assert.strictEqual(result.command, 'skipped');
    });
  });
});
