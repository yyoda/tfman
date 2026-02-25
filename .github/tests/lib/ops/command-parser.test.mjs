import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseCommand } from '../../../scripts/lib/ops/command-parser.mjs';

describe('lib/ops/command-parser', () => {

  describe('parseCommand', () => {
    it('should return null for empty body', () => {
      assert.strictEqual(parseCommand(null), null);
      assert.strictEqual(parseCommand(''), null);
    });

    it('should return null for invalid commands', () => {
      assert.strictEqual(parseCommand('/invalid'), null);
      assert.strictEqual(parseCommand('hello world'), null);
      assert.strictEqual(parseCommand('$terraform invalid'), null);
    });

    it('should parse basic $terraform apply command', () => {
      const result = parseCommand('$terraform apply');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, []);
    });

    it('should parse basic $terraform plan command', () => {
      const result = parseCommand('$terraform plan');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targets, []);
    });

    it('should parse $terraform help command', () => {
      const result = parseCommand('$terraform help');
      assert.strictEqual(result.command, 'help');
      assert.ok(result.message.includes('Usage'));
    });

    it('should parse $terraform apply with targets', () => {
      const result = parseCommand('$terraform apply dev/frontend prod/backend');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, ['dev/frontend', 'prod/backend']);
    });

    it('should ignore quotes and split args correctly', () => {
      // Adjusted test: Ensure targets pass strict validation (no spaces within target itself)
      const result = parseCommand('$terraform apply "dev/foo-bar" \'prod/baz\'');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, ['dev/foo-bar', 'prod/baz']);
    });

    it('should return error for invalid target characters', () => {
      // Test for command injection or invalid chars
      const result = parseCommand('$terraform plan "dev/app; rm -rf /"');
      assert.strictEqual(result.command, 'error');
      assert.match(result.message, /Invalid target path provided/);
    });
  });
});
