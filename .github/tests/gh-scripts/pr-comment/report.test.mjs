import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import report from '../../../scripts/gh-scripts/pr-comment/report.mjs';

describe('report script', () => {
  let mockGithub;
  let mockContext;
  let mockConfig;

  beforeEach(() => {
    // Mock octokit client
    mockGithub = {
      paginate: async () => [],
      rest: {
        actions: {
          listJobsForWorkflowRun: 'mock-endpoint'
        },
        issues: {
          createComment: async () => {},
          listComments: async () => ({ data: [] }),
          deleteComment: async () => {} 
        }
      }
    };

    // Mock github context
    mockContext = {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      runId: 12345,
      issue: { number: 101 },
      payload: {
        repository: {
          html_url: 'https://github.com/test-owner/test-repo'
        }
      }
    };

    // Default config
    mockConfig = {
      command: 'apply',
      result_message: ''
    };
  });

  it('should do nothing if no message and no jobs found', async (t) => {
    // Setup spy on createComment
    let createCommentCall = null;
    mockGithub.rest.issues.createComment = async (args) => { createCommentCall = args; };
    
    // Run
    await report({ github: mockGithub, context: mockContext, config: mockConfig });

    // Assert
    assert.ok(createCommentCall, 'should call createComment');
    assert.ok(createCommentCall.body.includes('No execution jobs found'), 'Should warn about no jobs');
  });

  it('should post success report when apply jobs succeed', async (t) => {
    // Setup jobs
    mockGithub.paginate = async () => [
      { name: 'apply on dev/app', conclusion: 'success', html_url: 'http://log/1' },
      { name: 'apply on prod/db', conclusion: 'success', html_url: 'http://log/2' }
    ];
    
    // Setup spy
    let createCommentCall = null;
    mockGithub.rest.issues.createComment = async (args) => { createCommentCall = args; };

    await report({ github: mockGithub, context: mockContext, config: mockConfig });

    assert.ok(createCommentCall);
    // Modified expectation: Check for new header
    assert.ok(createCommentCall.body.includes('### ✅ Apply Succeeded'));
    
    assert.match(createCommentCall.body, /\|\s*`dev\/app`\s*\|\s*✅\s*\|\s*\[Log\]\(http:\/\/log\/1\)\s*\|/);
    assert.match(createCommentCall.body, /\|\s*`prod\/db`\s*\|\s*✅\s*\|\s*\[Log\]\(http:\/\/log\/2\)\s*\|/);
  });

  it('should post failure report when some apply jobs fail', async (t) => {
    mockGithub.paginate = async () => [
      { name: 'apply on dev/app', conclusion: 'success', html_url: 'http://log/1' },
      { name: 'apply on prod/db', conclusion: 'failure', html_url: 'http://log/2' }
    ];

    let createCommentCall = null;
    mockGithub.rest.issues.createComment = async (args) => { createCommentCall = args; };

    await report({ github: mockGithub, context: mockContext, config: mockConfig });

    assert.ok(createCommentCall.body.includes('### ❌ Apply Failed'));
    assert.match(createCommentCall.body, /\|\s*`prod\/db`\s*\|\s*❌\s*\|\s*\[Log\]\(http:\/\/log\/2\)\s*\|/);
  });

  it('should respect custom message (result_message)', async (t) => {
    mockConfig.result_message = 'Custom message from caller';
    
    let createCommentCall = null;
    mockGithub.rest.issues.createComment = async (args) => { createCommentCall = args; };

    await report({ github: mockGithub, context: mockContext, config: mockConfig });
    
    assert.ok(createCommentCall.body.includes('Custom message from caller'));
  });

  it('should handle "plan" command specifically', async (t) => {
    mockConfig.command = 'plan';
    mockGithub.paginate = async () => [
      { name: 'apply on dev/app', conclusion: 'success', html_url: 'http://log/1' }
    ];

    let createCommentCall = null;
    mockGithub.rest.issues.createComment = async (args) => { createCommentCall = args; };

    await report({ github: mockGithub, context: mockContext, config: mockConfig });

    assert.ok(createCommentCall.body.includes('✅ Plan Completed'));
  });
  
  it('should clean up matrix suffix from job names', async (t) => {
    mockGithub.paginate = async () => [
      { name: 'apply on dev/app (ubuntu-latest)', conclusion: 'success', html_url: 'http://log/1' }
    ];

    let createCommentCall = null;
    mockGithub.rest.issues.createComment = async (args) => { createCommentCall = args; };
    
    await report({ github: mockGithub, context: mockContext, config: mockConfig });
    
    // Should contain `dev/app` without suffix
    assert.match(createCommentCall.body, /\|\s*`dev\/app`\s*\|/);
  });

  it('should NOT attempt to cleanup previous comments', async (t) => {
    let listCommentsCalled = false;
    let deleteCommentCalled = false;

    mockGithub.rest.issues.listComments = async () => {
      listCommentsCalled = true;
      return { data: [] };
    };
    mockGithub.rest.issues.deleteComment = async () => {
      deleteCommentCalled = true;
    };

    await report({ github: mockGithub, context: mockContext, config: mockConfig });

    assert.strictEqual(listCommentsCalled, false, 'Should not retrieve comments list');
    assert.strictEqual(deleteCommentCalled, false, 'Should not delete comments');
  });
});
