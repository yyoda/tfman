import { describe, it } from 'node:test';
import assert from 'node:assert';
import { run } from '../../../scripts/cli/commands/operate-command.mjs';

describe('cli/commands/operate-command', () => {

  describe('run (Orchestration Logic)', () => {
    const baseArgs = {
      'comment-body': 'MOCK_BODY', // Value doesn't matter because we mock the parser
      'base-sha': 'base',
      'head-sha': 'head',
    };

    it('should call detectChanges when parser returns no explicit targets', async () => {
      // Mock Parser: returns a valid command but NO targets
      const _parseCommand = () => ({ command: 'apply', targets: [] });
      
      let detectedDetails = null;
      // Mock Detector
      const _detectChanges = async (base, head) => {
        detectedDetails = { base, head };
        return [{ path: 'auto/detected' }];
      };
      // Mock Selector (should NOT be called)
      const _selectTargets = async () => { throw new Error('Should not be called'); };
      
      const result = await run(
        { ...baseArgs },
        { _detectChanges, _selectTargets, _parseCommand }
      );

      // Verify correct execution path
      assert.deepStrictEqual(detectedDetails, { base: 'base', head: 'head' });
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, [{ path: 'auto/detected' }]);
    });

    it('should call selectTargets when parser returns explicit targets', async () => {
      // Mock Parser: returns explicit targets
      const _parseCommand = () => ({ command: 'apply', targets: ['dev/app'] });
      
      let selectedTargetsArgs = null;
      // Mock Selector
      const _selectTargets = async (targets) => {
        selectedTargetsArgs = targets;
        return [{ path: 'manual/target' }];
      };
      // Mock Detector (should NOT be called)
      const _detectChanges = async () => { throw new Error('Should not be called'); };
      
      const result = await run(
        { ...baseArgs },
        { _selectTargets, _detectChanges, _parseCommand }
      );

      // Verify correct execution path
      assert.strictEqual(selectedTargetsArgs, 'dev/app'); // join(' ') is handled in selectTargets in actual code? Oh wait, let's check implementation. 
      // The implementation does: matrixParams = await _selectTargets(targets.join(' ')); 
      // Wait, targets is array ['dev/app']. join(' ') is correct.
      
      assert.strictEqual(result.command, 'apply');
      assert.deepStrictEqual(result.targets, [{ path: 'manual/target' }]);
    });

    it('should return error when command parsing fails (invalid syntax)', async () => {
      // Mock Parser: returns null (invalid)
      const _parseCommand = () => null;
      
      const result = await run(
        { ...baseArgs },
        { _parseCommand }
      );

      assert.strictEqual(result.command, 'error');
      assert.ok(result.message.includes('Not a valid command'));
    });

    it('should return error immediately when parser returns an explicit error', async () => {
      let detectCalled = false;
      const _detectChanges = async () => {
        detectCalled = true;
        return [{ path: 'auto/detected' }];
      };

      const _parseCommand = () => ({
        command: 'error',
        targets: [],
        message: 'Invalid target path provided: "../etc".'
      });

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _parseCommand }
      );

      assert.strictEqual(detectCalled, false);
      assert.strictEqual(result.command, 'error');
      assert.strictEqual(result.done, true);
      assert.ok(result.message.includes('Invalid target path'));
    });

    it('should return error when no directories are found (after detection)', async () => {
      const _parseCommand = () => ({ command: 'plan', targets: [] });
      const _detectChanges = async () => []; // Returns empty list

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _parseCommand }
      );
      
      assert.strictEqual(result.command, 'error');
      assert.ok(result.message.includes('No Terraform directories matched'));
    });

    it('should return help message immediately if command is help', async () => {
      const msg = 'Usage: ...';
      const _parseCommand = () => ({ command: 'help', targets: [], message: msg });

      // Detect/Select should not be called
      const result = await run(
        { ...baseArgs },
        { _parseCommand }
      );

      assert.strictEqual(result.command, 'help');
      assert.strictEqual(result.message, msg);
    });

    it('should return error when dependencies fail', async () => {
      const _parseCommand = () => ({ command: 'apply', targets: [] });
      const _detectChanges = async () => { throw new Error('Git Error'); };

      const result = await run(
        { ...baseArgs },
        { _detectChanges, _parseCommand }
      );

      assert.strictEqual(result.command, 'error');
      assert.strictEqual(result.message, 'Git Error');
    });
  });
});
