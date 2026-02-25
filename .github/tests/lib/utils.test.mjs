
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { writeFile, unlink, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runCommand, getWorkspaceRoot, loadJson } from '../../scripts/lib/utils.mjs';

describe('utils.mjs', () => {

  describe('runCommand', () => {
    it('should resolve with stdout when command succeeds', async () => {
      // Use array args for security update and platform independence
      const { stdout } = await runCommand('echo', ['hello', 'world']);
      assert.strictEqual(stdout, 'hello world');
    });

    it('should reject when command fails (non-zero exit code)', async () => {
      // Use 'false' or similar command that exits with 1
      // 'exit 1' is a shell builtin, so it won't work with spawn(..., {shell: false})
      // Using 'false' command which is standard
      await assert.rejects(
        async () => await runCommand('false'),
        (err) => {
          assert.strictEqual(err.code, 1);
          return true;
        }
      );
    });

    it('should return stderr content', async () => {
      // Cannot use shell redirection >&2 with shell: false.
      // Need a way to write to stderr without shell.
      // node -e "console.error('warning')" is a portable way
      const { stderr } = await runCommand('node', ['-e', 'console.error("warning")']);
      assert.strictEqual(stderr, 'warning');
    });
  });

  describe('getWorkspaceRoot', () => {
    it('should return a non-empty string', async () => {
      const root = await getWorkspaceRoot();
      assert.strictEqual(typeof root, 'string');
      assert.ok(root.length > 0);
      // Since we are inside a git repo (this workspace), it should return an absolute path
      assert.match(root, /^\//); 
    });
  });

  describe('loadJson', () => {
    
    it('should load valid JSON', async () => {
        const tempFile = join(tmpdir(), `test-utils-${Date.now()}.json`);
        const data = { foo: 'bar', num: 123 };
        
        try {
            await writeFile(tempFile, JSON.stringify(data));
            const loaded = await loadJson(tempFile);
            assert.deepStrictEqual(loaded, data);
        } finally {
            await unlink(tempFile).catch(() => {});
        }
    });

    it('should throw "File not found" error if file does not exist', async () => {
        const nonExistent = join(tmpdir(), `non-existent-${Date.now()}.json`);
        await assert.rejects(
            async () => await loadJson(nonExistent),
            (err) => {
                return err.message.includes('File not found');
            }
        );
    });

    it('should throw "Failed to decode JSON" error on invalid JSON syntax', async () => {
        const invalidFile = join(tmpdir(), `invalid-utils-${Date.now()}.json`);
        try {
            await writeFile(invalidFile, '{ broken json: }'); // Write invalid JSON
            await assert.rejects(
                async () => await loadJson(invalidFile),
                (err) => {
                    return err.message.includes('Failed to decode JSON');
                }
            );
        } finally {
            await unlink(invalidFile).catch(() => {});
        }
    });
  });
});
