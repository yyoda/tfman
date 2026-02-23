import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { PlanCommentBuilder } from '../../../scripts/lib/comment-builder.mjs';
import report from '../../../scripts/gh-scripts/pr-review/post-plan.mjs';

describe('report script', () => {
  let mockGithub;
  let mockContext;
  let mockCore;
  let mockGlob;

  beforeEach(() => {
    mockGithub = {
      rest: {
        issues: {
          listComments: mock.fn(async () => ({ data: [] })),
          deleteComment: mock.fn(async () => {}),
          createComment: mock.fn(async () => {})
        }
      }
    };

    mockContext = {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 101 }
    };

    mockCore = {
      info: mock.fn(),
      warning: mock.fn(),
      error: mock.fn(),
      setFailed: mock.fn()
    };

    mockGlob = {
        create: mock.fn(async () => ({
            glob: mock.fn(async () => [])
        }))
    };
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('should explicitly clean up previous plan comments', async () => {
    // Setup existing comments
    mockGithub.rest.issues.listComments.mock.mockImplementation(async () => ({
      data: [
        { id: 1, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER },
        { id: 2, user: { type: 'User' }, body: 'LGTM' }
      ]
    }));

    await report({ github: mockGithub, context: mockContext, core: mockCore, glob: mockGlob });

    assert.strictEqual(mockGithub.rest.issues.deleteComment.mock.callCount(), 1);
    assert.deepStrictEqual(mockGithub.rest.issues.deleteComment.mock.calls[0].arguments[0], {
        owner: 'test-owner',
        repo: 'test-repo',
        comment_id: 1
    });
  });

  it('should warn if no plan files found', async () => {
    // Glob returns empty array by default in beforeEach
    await report({ github: mockGithub, context: mockContext, core: mockCore, glob: mockGlob });
    
    assert.strictEqual(mockCore.info.mock.calls.length, 1);
    assert.strictEqual(mockCore.info.mock.calls[0].arguments[0], 'No plans found to post.');
  });
  
  it('should post plan comments when artifacts exist', async () => {
    // Mock glob results
    const mockFiles = ['/tmp/plans/dev-app/info.json'];
    mockGlob.create.mock.mockImplementation(async () => ({
        glob: async () => mockFiles
    }));

    // Mock fs
    mock.method(fs, 'readFileSync', (file) => {
        if (file.endsWith('info.json')) {
            return JSON.stringify({ path: 'dev/app' });
        }
        if (file.endsWith('plan.txt')) {
            return 'Plan: 1 to add, 0 to change, 0 to destroy.';
        }
        return '';
    });
    mock.method(fs, 'existsSync', () => true);

    await report({ github: mockGithub, context: mockContext, core: mockCore, glob: mockGlob });
    
    // Validate comment creation
    assert.strictEqual(mockGithub.rest.issues.createComment.mock.callCount(), 1);
    const body = mockGithub.rest.issues.createComment.mock.calls[0].arguments[0].body;
    
    assert.ok(body.includes('dev/app'));
    assert.ok(body.includes('Plan: 1 to add, 0 to change, 0 to destroy.'));
  });

  it('should handle missing plan.txt gracefully', async () => {
    // Mock glob results
    const mockFiles = ['/tmp/plans/dev-app/info.json'];
    mockGlob.create.mock.mockImplementation(async () => ({
        glob: async () => mockFiles
    }));

    // Mock fs behavior
    mock.method(fs, 'readFileSync', (file) => {
        if (file.endsWith('info.json')) return JSON.stringify({ path: 'dev/app' });
        return '';
    });
    // plan.txt missing
    mock.method(fs, 'existsSync', (file) => !file.endsWith('plan.txt'));

    await report({ github: mockGithub, context: mockContext, core: mockCore, glob: mockGlob });

    // Should not post empty comment or fail, but in current logic if builder is empty, buildChunks returns []?
    // Let's check logic: builder.addResult is skipped -> builder.buildChunks() might return []?
    // Actually builder logic is imported, but assuming standard behavior. 
    // If no results added, chunks might be empty.
    
    // The code loops over chunks. If chunks is empty, createComment is never called.
    assert.strictEqual(mockGithub.rest.issues.createComment.mock.callCount(), 0);
  });
});
