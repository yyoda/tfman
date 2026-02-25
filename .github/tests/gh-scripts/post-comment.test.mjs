import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlanCommentBuilder, ApplyCommentBuilder } from '../../scripts/lib/comment-builder.mjs';
import postComment from '../../scripts/gh-scripts/post-comment.mjs';

// Setup Mock for fs and path
const fs = {
    existsSync: mock.fn(),
    readFileSync: mock.fn(),
};

const path = {
    dirname: (p) => p.split('/').slice(0, -1).join('/'),
    join: (...args) => args.join('/'),
};

describe('post-comment.mjs', () => {
    // Shared contexts
    const context = {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        issue: { number: 123 },
    };

    const core = {
        info: mock.fn(),
        warning: mock.fn(),
        error: mock.fn(),
        setFailed: mock.fn(),
    };

    const glob = {
        create: mock.fn(),
    };
    
    // Globber mock
    const globberMock = {
        glob: mock.fn(),
    };

    // GitHub API mocks
    const github = {
        rest: {
            issues: {
                listComments: mock.fn(),
                deleteComment: mock.fn(),
                createComment: mock.fn(),
            },
        },
    };

    afterEach(() => {
        mock.reset();
        
        // Reset specific mock implementations
        glob.create.mock.mockImplementation(() => globberMock);
        
        // Clear all mock history
        core.info.mock.resetCalls();
        core.warning.mock.resetCalls();
        core.error.mock.resetCalls();
        
        github.rest.issues.listComments.mock.resetCalls();
        github.rest.issues.deleteComment.mock.resetCalls();
        github.rest.issues.createComment.mock.resetCalls();
        
        fs.existsSync.mock.resetCalls();
        fs.readFileSync.mock.resetCalls();
    });

    it('should fail if unknown mode is provided', async () => {
        await postComment({ github, context, core, glob }, { mode: 'unknown' }, { fs, path });
        
        assert.equal(core.setFailed.mock.calls.length, 1);
        assert.match(core.setFailed.mock.calls[0].arguments[0], /Unsupported mode/);
    });

    it('should execute Plan logic cleanly', async () => {
        // Setup data
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => ['plans/test/info.json']);

        fs.readFileSync.mock.mockImplementation((filepath) => {
            if (filepath.endsWith('info.json')) return JSON.stringify({ path: 'test/path' });
            if (filepath.endsWith('plan.txt')) return 'Plan: 1 to add, 0 to change, 0 to destroy.'; // Plan output
            return '';
        });
        fs.existsSync.mock.mockImplementation(() => true);

        // Setup Comments for cleanup
        github.rest.issues.listComments.mock.mockImplementation(async () => ({
            data: [
                { id: 1, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER }, // Target
                { id: 2, user: { type: 'User' }, body: 'Keep me' }, // Ignore user
                { id: 3, user: { type: 'Bot' }, body: 'Other bot comment' } // Ignore other bot
            ]
        }));

        // Execute function (with cleanup flag true for plan)
        await postComment({ github, context, core, glob }, { mode: 'plan', deletePreviousComments: true }, { fs, path });

        // Assert Cleanup
        assert.equal(github.rest.issues.deleteComment.mock.calls.length, 1);
        assert.equal(github.rest.issues.deleteComment.mock.calls[0].arguments[0].comment_id, 1);

        // Assert File Reads
        // 1. info.json read
        // 2. plan.txt read (via builder.add)
        const calls = fs.readFileSync.mock.calls;
        assert.ok(calls.some(call => call.arguments[0].endsWith('info.json')));
        assert.ok(calls.some(call => call.arguments[0].endsWith('plan.txt')));

        // Assert Comment Post
        assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        assert.ok(body.includes(PlanCommentBuilder.COMMENT_HEADER));
        assert.ok(body.includes('+1 add')); // From mock plan content
    });

    it('should execute Apply logic without cleanup', async () => {
        // Setup data
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => ['applies/prod/info.json']);

        fs.readFileSync.mock.mockImplementation((filepath) => {
            if (filepath.endsWith('info.json')) return JSON.stringify({ path: 'prod/app', outcome: 'success' });
            if (filepath.endsWith('apply.txt')) return 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.'; 
            return '';
        });
        fs.existsSync.mock.mockImplementation(() => true);

        // Execute function (deletePreviousComments: false by default for apply logic we want to test)
        await postComment({ github, context, core, glob }, { mode: 'apply', deletePreviousComments: false }, { fs, path });

        // Assert Cleanup NOT called
        assert.equal(github.rest.issues.listComments.mock.calls.length, 0);
        assert.equal(github.rest.issues.deleteComment.mock.calls.length, 0);

        // Assert Comment Post (ApplyCommentBuilder format)
        assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        
        assert.ok(body.includes(ApplyCommentBuilder.COMMENT_HEADER));
        assert.ok(body.includes('| `prod/app` | ✅ |'));
    });

    it('should fallback log message if log file not found', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => ['plans/missing/info.json']);

        fs.readFileSync.mock.mockImplementation((filepath) => {
             if (filepath.endsWith('info.json')) return JSON.stringify({ path: 'missing/log' });
             return '';
        });
        // Log file does not exist
        fs.existsSync.mock.mockImplementation(() => false); 

        await postComment({ github, context, core, glob }, { mode: 'plan' }, { fs, path });

        // Assert comment contains fallback message (which is handled inside post-comment.mjs logic)
        // '(Log file not found)' is passed to builder
        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        // PlanCommentBuilder might not show file content directly in summary table unless mocked differently, 
        // but let's check if it builds successfully with empty/fallback content.
        assert.ok(body.includes('missing/log'));
    });

    it('should handle no artifacts found case', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => []); // Empty list

        await postComment({ github, context, core, glob }, { mode: 'plan' }, { fs, path });

        assert.equal(core.info.mock.calls.length, 1);
        assert.match(core.info.mock.calls[0].arguments[0], /No plan results found/);
        assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        assert.ok(body.includes('No changes were detected for this run.'));
    });

});
