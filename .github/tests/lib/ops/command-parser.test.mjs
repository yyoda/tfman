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
      assert.deepStrictEqual(result.targetDirs, []);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should parse basic $terraform plan command', () => {
      const result = parseCommand('$terraform plan');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targetDirs, []);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should parse $terraform help command', () => {
      const result = parseCommand('$terraform help');
      assert.strictEqual(result.command, 'help');
      assert.ok(result.message.includes('Usage'));
    });

    it('should parse $terraform apply with targetDirs', () => {
      const result = parseCommand('$terraform apply dev/frontend prod/backend');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, ['dev/frontend', 'prod/backend']);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should ignore quotes and split args correctly', () => {
      // Adjusted test: Ensure targets pass strict validation (no spaces within target itself)
      const result = parseCommand('$terraform apply "dev/foo-bar" \'prod/baz\'');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, ['dev/foo-bar', 'prod/baz']);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should allow dots in target paths', () => {
      const result = parseCommand('$terraform plan environments/v1.0/app .github/workflows');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targetDirs, ['environments/v1.0/app', '.github/workflows']);
      assert.deepStrictEqual(result.tfTargets, []);
    });

    it('should reject directory traversal attempt', () => {
      const result = parseCommand('$terraform plan ../../../etc/passwd');
      assert.strictEqual(result.command, 'error');
      assert.match(result.message, /Directory traversal "\.\." is invalid/);
    });

    it('should return error for invalid target characters', () => {
      // Test for command injection or invalid chars
      const result = parseCommand('$terraform plan "dev/app; rm -rf /"');
      assert.strictEqual(result.command, 'error');
      assert.match(result.message, /Invalid target path provided/);
    });

    it('should parse -target= flag as tfTarget', () => {
      const result = parseCommand('$terraform plan -target=aws_instance.example');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.targetDirs, []);
      assert.deepStrictEqual(result.tfTargets, ['aws_instance.example']);
    });

    it('should parse multiple -target= flags', () => {
      const result = parseCommand('$terraform apply -target=aws_instance.web -target=module.vpc');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, []);
      assert.deepStrictEqual(result.tfTargets, ['aws_instance.web', 'module.vpc']);
    });

    it('should parse both targetDirs and tfTargets together', () => {
      const result = parseCommand('$terraform apply environments/test1 -target=aws_instance.example');
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targetDirs, ['environments/test1']);
      assert.deepStrictEqual(result.tfTargets, ['aws_instance.example']);
    });

    it('should parse indexed resource address in -target', () => {
      const result = parseCommand('$terraform plan -target=aws_instance.web[0]');
      assert.strictEqual(result.command, 'plan');
      assert.deepStrictEqual(result.tfTargets, ['aws_instance.web[0]']);
    });

    it('should reject directory traversal in -target resource address', () => {
      const result = parseCommand('$terraform plan -target=../../etc/passwd');
      assert.strictEqual(result.command, 'error');
      assert.match(result.message, /Invalid -target resource address/);
    });

    it('should reject invalid characters in -target resource address', () => {
      const result = parseCommand('$terraform plan -target=aws_instance.web;rm -rf /');
      assert.strictEqual(result.command, 'error');
      assert.match(result.message, /Invalid -target resource address/);
    });
  });
});
