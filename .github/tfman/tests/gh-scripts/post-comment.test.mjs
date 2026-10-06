import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlanCommentBuilder, ApplyCommentBuilder } from '../../lib/comment-builder.mjs';
import postComment from '../../gh-scripts/post-comment.mjs';

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
        paginate: mock.fn(async (fn, params) => (await fn(params)).data),
        rest: {
            pulls: { get: mock.fn() },
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
        github.paginate.mock.mockImplementation(async (fn, params) => (await fn(params)).data);
        
        // Clear all mock history
        core.info.mock.resetCalls();
        core.warning.mock.resetCalls();
        core.error.mock.resetCalls();
        core.setFailed.mock.resetCalls();
        github.rest.pulls.get.mock.resetCalls();
        glob.create.mock.resetCalls();
        github.paginate.mock.resetCalls();
        
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

    for (const mode of ['constructor', '__proto__', 'toString']) {
        it(`rejects unsupported mode ${mode} without using inherited properties`, async () => {
            const setFailed = mock.fn();
            await postComment({ github, context, core: { setFailed }, glob }, { mode }, { fs, path });
            assert.equal(setFailed.mock.callCount(), 1);
            assert.equal(setFailed.mock.calls[0].arguments[0], `Unsupported mode: ${mode}`);
        });
    }

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
        assert.equal(github.paginate.mock.calls.length, 1);
        assert.equal(github.paginate.mock.calls[0].arguments[0], github.rest.issues.listComments);
        assert.deepEqual(github.paginate.mock.calls[0].arguments[1], {
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: context.issue.number,
            per_page: 100,
        });
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

    it('should only clean up previous plan comments in cleanupOnly mode', async () => {
        github.rest.issues.listComments.mock.mockImplementation(async () => ({
            data: [
                { id: 1, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER },
                { id: 2, user: { type: 'User' }, body: PlanCommentBuilder.COMMENT_HEADER },
                { id: 3, user: { type: 'Bot' }, body: 'Other bot comment' },
                { id: 4, user: { type: 'Bot' }, body: '### 📋 Terraform Plan Details (Continued)' },
            ],
        }));

        await postComment({ github, context, core, glob }, {
            mode: 'plan', cleanupOnly: true, deletePreviousComments: true,
        }, { fs, path });

        assert.equal(github.rest.issues.deleteComment.mock.calls.length, 1);
        assert.equal(github.rest.issues.deleteComment.mock.calls[0].arguments[0].comment_id, 1);
        assert.equal(glob.create.mock.calls.length, 0);
        assert.equal(github.rest.issues.createComment.mock.calls.length, 0);
        assert.equal(core.info.mock.calls[0].arguments[0], 'Removed previous plan comments (cleanup only).');
    });

    it('should do nothing in cleanupOnly mode when deletion is disabled', async () => {
        await postComment({ github, context, core, glob }, {
            mode: 'plan', cleanupOnly: true, deletePreviousComments: false,
        }, { fs, path });

        assert.equal(github.paginate.mock.calls.length, 0);
        assert.equal(github.rest.issues.deleteComment.mock.calls.length, 0);
        assert.equal(glob.create.mock.calls.length, 0);
        assert.equal(github.rest.issues.createComment.mock.calls.length, 0);
    });

    it('should delete plan comments beyond the first page', async () => {
        const comments = Array.from({ length: 35 }, (_, index) => ({
            id: index + 1, user: { type: 'User' }, body: 'Keep me',
        }));
        comments[30] = { id: 31, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER };
        github.paginate.mock.mockImplementation(async () => comments);

        await postComment({ github, context, core, glob }, {
            mode: 'plan', cleanupOnly: true, deletePreviousComments: true,
        }, { fs, path });

        assert.equal(github.paginate.mock.calls.length, 1);
        assert.equal(github.rest.issues.deleteComment.mock.calls.length, 1);
        assert.equal(github.rest.issues.deleteComment.mock.calls[0].arguments[0].comment_id, 31);
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
             if (filepath.endsWith('info.json')) return JSON.stringify({ path: 'missing/log', outcome: 'success' });
             return '';
        });
        // Log file does not exist
        fs.existsSync.mock.mockImplementation(() => false); 

        await postComment({ github, context, core, glob }, { mode: 'plan' }, { fs, path });

        // Assert comment contains fallback message (which is handled inside post-comment.mjs logic)
        // '(Log file not found)' is passed to builder
        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        assert.ok(body.includes('missing/log'));
        assert.ok(body.includes('❌'));
        assert.ok(body.includes('Plan Failed'));
    });

    it('should skip posting when processing artifacts produces an empty body', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => ['plans/invalid/info.json']);
        fs.readFileSync.mock.mockImplementation(() => '{invalid json');

        await postComment({ github, context, core, glob }, { mode: 'plan' }, { fs, path });

        assert.equal(core.error.mock.calls.length, 1);
        assert.equal(github.rest.issues.createComment.mock.calls.length, 0);
    });

    it('should handle no artifacts found case', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => []); // Empty list

        await postComment({ github, context, core, glob }, { mode: 'plan' }, { fs, path });

        assert.equal(core.info.mock.calls.length, 1);
        assert.match(core.info.mock.calls[0].arguments[0], /No plan results found/);
        assert.equal(github.rest.issues.createComment.mock.calls.length, 1);
        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        assert.ok(body.includes('No plan results were produced for this run.'));
        assert.ok(!body.includes('No changes were detected'));
    });

    it('should include failed plan outcome and error output', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => ['plans/fail/info.json']);
        fs.readFileSync.mock.mockImplementation((filepath) => {
            if (filepath.endsWith('info.json')) return JSON.stringify({ path: 'env/fail', outcome: 'failure' });
            return 'Error: init failed';
        });
        fs.existsSync.mock.mockImplementation(() => true);

        await postComment({ github, context, core, glob }, { mode: 'plan' }, { fs, path });

        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        assert.ok(body.includes('| `env/fail` | ❌ | Plan Failed |'));
        assert.ok(body.includes('Error: init failed'));
    });

    it('should default apply outcome to success when the log exists', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => ['applies/default/info.json']);
        fs.readFileSync.mock.mockImplementation((filepath) => {
            if (filepath.endsWith('info.json')) return JSON.stringify({ path: 'env/default' });
            return 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.';
        });
        fs.existsSync.mock.mockImplementation(() => true);

        await postComment({ github, context, core, glob }, { mode: 'apply' }, { fs, path });

        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
        assert.ok(body.includes('| `env/default` | ✅ | +1 |'));
    });

    it('cleans up stale comments before posting the zero-artifact notice', async () => {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => []);
        github.rest.issues.listComments.mock.mockImplementation(async () => ({ data: [
            { id: 42, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER },
        ] }));
        github.rest.issues.createComment.mock.mockImplementation(async () => {
            assert.equal(github.rest.issues.deleteComment.mock.calls.length, 1);
        });
        await postComment({ github, context, core, glob }, {
            mode: 'plan', deletePreviousComments: true,
        }, { fs, path });
        assert.equal(github.rest.issues.deleteComment.mock.calls[0].arguments[0].comment_id, 42);
        assert.ok(github.rest.issues.createComment.mock.calls[0].arguments[0].body.startsWith(PlanCommentBuilder.COMMENT_HEADER));
    });

    for (const hasArtifact of [true, false]) {
        it(`reports missing expected paths with existing artifacts: ${hasArtifact}`, async () => {
            glob.create.mock.mockImplementation(async () => globberMock);
            globberMock.glob.mock.mockImplementation(async () => hasArtifact ? ['plans/a/info.json'] : []);
            fs.existsSync.mock.mockImplementation(() => true);
            fs.readFileSync.mock.mockImplementation(filepath => filepath.endsWith('info.json')
                ? JSON.stringify({ path: 'env/a', outcome: 'success' })
                : 'No changes. Infrastructure is up-to-date.');
            await postComment({ github, context, core, glob }, {
                mode: 'plan', expectedPaths: ['env/a', 'env/a/'],
            }, { fs, path });
            const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
            assert.ok(body.includes('| `env/a/` | ❌ | Plan Failed |'));
            assert.ok(body.includes(hasArtifact ? '| `env/a` | ✅ | No changes |' : '| `env/a` | ❌ | Plan Failed |'));
            assert.ok(body.includes('(No result artifact was produced for this path — the job may have been cancelled or failed before uploading)'));
            assert.ok(!body.includes('No plan results were produced for this run.'));
        });
    }

    const headSha = 'a'.repeat(40);
    const provenance = { headSha, mergeCommit: 'b'.repeat(40), runAttempt: '2' };
    const runContext = { ...context, runId: 99 };

    function setupProvenancePath(route) {
        glob.create.mock.mockImplementation(async () => globberMock);
        globberMock.glob.mock.mockImplementation(async () => route === 'normal' ? ['plans/a/info.json'] : []);
        fs.existsSync.mock.mockImplementation(() => true);
        fs.readFileSync.mock.mockImplementation(filepath => filepath.endsWith('info.json')
            ? JSON.stringify({ path: 'env/a' })
            : 'Plan: 1 to add, 0 to change, 0 to destroy.');
        github.rest.issues.listComments.mock.mockImplementation(async () => ({ data: [
            { id: 42, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER },
        ] }));
        github.rest.issues.createComment.mock.mockImplementation(async () => {});
        return { mode: 'plan', provenance, cleanupOnly: route === 'cleanup', deletePreviousComments: true };
    }

    for (const route of ['normal', 'cleanup', 'no-results']) {
        for (const freshness of ['matching', 'mismatching', 'unverifiable']) {
            it(`${freshness} provenance guards the ${route} path`, async () => {
                const options = setupProvenancePath(route);
                const events = [];
                github.rest.pulls.get.mock.mockImplementation(async params => {
                    assert.deepEqual(params, { owner: context.repo.owner, repo: context.repo.repo, pull_number: context.issue.number });
                    if (route === 'normal') assert.equal(fs.readFileSync.mock.callCount(), 2);
                    assert.equal(github.paginate.mock.callCount(), 0);
                    events.push('guard');
                    if (freshness === 'unverifiable') throw new Error('lookup unavailable');
                    return { data: { head: { sha: freshness === 'matching' ? headSha : 'c'.repeat(40) } } };
                });
                github.rest.issues.deleteComment.mock.mockImplementation(async () => events.push('delete'));
                github.rest.issues.createComment.mock.mockImplementation(async () => events.push('post'));
                await postComment({ github, context: runContext, core, glob }, options, { fs, path });
                assert.equal(core.setFailed.mock.callCount(), freshness === 'unverifiable' ? 1 : 0);
                if (freshness === 'matching') {
                    assert.deepEqual(events, route === 'cleanup' ? ['guard', 'delete'] : ['guard', 'delete', 'post']);
                    if (route !== 'cleanup') {
                        const body = github.rest.issues.createComment.mock.calls[0].arguments[0].body;
                        assert.equal(body.split('\n')[1], `> tfman-plan-provenance: pr_head=${headSha} merge_commit=${provenance.mergeCommit} run=https://github.com/test-owner/test-repo/actions/runs/99/attempts/2`);
                        if (route === 'no-results') assert.ok(body.includes('No plan results were produced'));
                    }
                } else {
                    assert.deepEqual(events, ['guard']);
                    assert.equal(github.paginate.mock.callCount(), 0);
                    assert.equal(github.rest.issues.deleteComment.mock.callCount(), 0);
                    assert.equal(github.rest.issues.createComment.mock.callCount(), 0);
                    if (freshness === 'unverifiable') {
                        assert.equal(core.warning.mock.callCount(), 0);
                        const message = core.setFailed.mock.calls[0].arguments[0];
                        assert.match(message, /lookup unavailable/);
                        assert.match(message, /re-run this post job/);
                        if (route === 'cleanup') assert.doesNotMatch(message, /\$terraform plan/);
                        else assert.match(message, /\$terraform plan/);
                    } else {
                        assert.equal(core.warning.mock.callCount(), 1);
                        assert.match(core.warning.mock.calls[0].arguments[0], /Skipped stale/);
                    }
                }
            });
        }
    }

    for (const invalid of [{ headSha: 'invalid', runAttempt: '1' }, { headSha: 'A'.repeat(40), runAttempt: '1' }, { headSha, runAttempt: '' }, { headSha }]) {
        it(`fails closed for invalid provenance ${JSON.stringify(invalid)}`, async () => {
            await postComment({ github, context, core, glob }, { provenance: invalid, deletePreviousComments: true }, { fs, path });
            assert.equal(core.setFailed.mock.callCount(), 1);
            assert.equal(github.rest.pulls.get.mock.callCount(), 0);
            assert.equal(github.paginate.mock.callCount(), 0);
            assert.equal(github.rest.issues.deleteComment.mock.callCount(), 0);
            assert.equal(github.rest.issues.createComment.mock.callCount(), 0);
        });
    }

    it('uses none for plans without a merge commit', async () => {
        const options = setupProvenancePath('no-results');
        github.rest.pulls.get.mock.mockImplementation(async () => ({ data: { head: { sha: headSha } } }));
        await postComment({ github, context: runContext, core, glob }, {
            ...options, provenance: { headSha, runAttempt: '3', mergeCommit: undefined },
        }, { fs, path });
        assert.equal(core.setFailed.mock.callCount(), 0);
        assert.ok(github.rest.issues.createComment.mock.calls[0].arguments[0].body.includes('merge_commit=none'));
    });

    for (const [label, invalid] of [
        ['zero attempt', { ...provenance, runAttempt: '0' }],
        ['non-numeric attempt', { ...provenance, runAttempt: 'abc' }],
        ['oversized attempt', { ...provenance, runAttempt: '1'.repeat(60000) }],
        ['invalid merge commit', { ...provenance, mergeCommit: 'xyz' }],
    ]) {
        it(`fails closed for provenance with ${label}`, async () => {
            await postComment({ github, context, core, glob }, { provenance: invalid, deletePreviousComments: true }, { fs, path });
            assert.equal(core.setFailed.mock.callCount(), 1);
            assert.match(core.setFailed.mock.calls[0].arguments[0], /runAttempt.*mergeCommit/);
            assert.equal(github.rest.pulls.get.mock.callCount(), 0);
            assert.equal(github.paginate.mock.callCount(), 0);
            assert.equal(github.rest.issues.deleteComment.mock.callCount(), 0);
            assert.equal(github.rest.issues.createComment.mock.callCount(), 0);
        });
    }

    for (const mode of ['plan', 'apply']) {
        it(`keeps legacy ${mode} behavior without a freshness lookup`, async () => {
            setupProvenancePath('no-results');
            await postComment({ github, context, core, glob }, {
                mode, ...(mode === 'apply' ? { provenance: { headSha: 'invalid' } } : {}),
            }, { fs, path });
            assert.equal(core.setFailed.mock.callCount(), 0);
            assert.equal(github.rest.pulls.get.mock.callCount(), 0);
            assert.equal(github.rest.issues.createComment.mock.callCount(), 1);
            assert.ok(!github.rest.issues.createComment.mock.calls[0].arguments[0].body.includes('tfman-plan-provenance'));
        });
    }

});

describe('post-comment issueNumber', () => {
    for (const issueNumber of [456, undefined, null]) {
        for (const expectedPaths of [[], ['env/a']]) {
            it(`uses ${issueNumber ?? 'context issue'} for freshness, cleanup and posting (${expectedPaths.length} paths)`, async () => {
                const headSha = 'a'.repeat(40);
                const listComments = mock.fn(async () => ({ data: [{ id: 99, user: { type: 'Bot' }, body: PlanCommentBuilder.COMMENT_HEADER }] }));
                const deleteComment = mock.fn();
                const createComment = mock.fn();
                const get = mock.fn(async () => ({ data: { head: { sha: headSha } } }));
                const setFailed = mock.fn();
                await postComment({
                    github: { paginate: async (fn, params) => (await fn(params)).data, rest: { pulls: { get }, issues: { listComments, deleteComment, createComment } } },
                    context: { repo: { owner: 'owner', repo: 'repo' }, issue: { number: 123 }, runId: 1 },
                    core: { setFailed, info() {} },
                    glob: { create: async () => ({ glob: async () => [] }) },
                }, { issueNumber, expectedPaths, deletePreviousComments: true, provenance: { headSha, runAttempt: 1 } });
                assert.equal(setFailed.mock.callCount(), 0);
                assert.equal(get.mock.calls[0].arguments[0].pull_number, issueNumber ?? 123);
                assert.equal(listComments.mock.calls[0].arguments[0].issue_number, issueNumber ?? 123);
                assert.equal(createComment.mock.calls[0].arguments[0].issue_number, issueNumber ?? 123);
                assert.deepEqual(deleteComment.mock.calls[0].arguments[0], { owner: 'owner', repo: 'repo', comment_id: 99 });
            });
        }
    }
    for (const issueNumber of [0, -1, 1.5, '456', NaN, Infinity, false]) {
        it(`rejects invalid issueNumber ${String(issueNumber)} before any API call`, async () => {
            const setFailed = mock.fn();
            await postComment({ github: {}, context: {}, core: { setFailed } }, { issueNumber });
            assert.equal(setFailed.mock.callCount(), 1);
            assert.match(setFailed.mock.calls[0].arguments[0], /Invalid issueNumber/);
        });
    }
});

describe('post-comment artifact isolation', () => {
    async function report(files, options = {}) {
        const warning = mock.fn();
        const createComment = mock.fn();
        const create = mock.fn(async () => ({ glob: async () => Object.keys(files) }));
        await postComment({
            github: { rest: { issues: { createComment } } },
            context: { repo: { owner: 'owner', repo: 'repo' }, issue: { number: 1 } },
            core: { warning, info() {}, error(message) { assert.fail(message); } },
            glob: { create },
        }, options, { fs: {
            existsSync: () => true,
            readFileSync: file => file.endsWith('/info.json') ? JSON.stringify(files[file])
                : options.mode === 'apply' ? 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.' : 'No changes. Infrastructure is up-to-date.',
        } });
        return { body: createComment.mock.calls[0].arguments[0].body, warning, create };
    }

    for (const mode of ['plan', 'apply']) {
        it('keeps default artifact root and unrestricted ' + mode + ' behavior', async () => {
            const root = mode === 'plan' ? 'plans' : 'applies';
            const result = await report({ [root + '/a/info.json']: { path: 'env/a' }, [root + '/b/info.json']: { path: 'env/a' } }, { mode });
            assert.equal(result.create.mock.calls[0].arguments[0], root + '/**/info.json');
            assert.equal(result.warning.mock.callCount(), 0);
            assert.doesNotMatch(result.body, /Duplicate result/);
            assert.ok(result.body.includes('✅'));
        });
        it('ignores unexpected ' + mode + ' result paths', async () => {
            const result = await report({ 'plans/unexpected/info.json': { path: 'env/unexpected', outcome: 'success' } }, { mode, expectedPaths: ['env/a'] });
            assert.doesNotMatch(result.body, /env\/unexpected/);
            assert.ok(result.body.includes('`env/a` | ❌'));
            assert.match(result.warning.mock.calls[0].arguments[0], /Ignoring unexpected/);
        });
        it('fails duplicate ' + mode + ' results without retaining success rows', async () => {
            const result = await report(Object.fromEntries(['a', 'b', 'c'].map(name => ['plans/' + name + '/info.json', { path: 'env/a', outcome: 'success' }])), { mode, expectedPaths: ['env/a'] });
            assert.ok(result.body.includes('`env/a` | ❌'));
            assert.doesNotMatch(result.body, /✅/);
            assert.match(result.body, /\(Duplicate result artifacts were produced for this path\)/);
            assert.equal(result.warning.mock.callCount(), 2);
        });
    }

    for (const hasRealArtifact of [true, false]) {
        it('ignores checkout forgeries with external artifacts present: ' + hasRealArtifact, async t => {
            const fsp = await import('node:fs/promises');
            const { tmpdir } = await import('node:os');
            const { join } = await import('node:path');
            const dir = await fsp.mkdtemp(join(tmpdir(), 'tfman-artifact-isolation-'));
            t.after(async () => {
                await fsp.rm(dir, { recursive: true, force: true });
                await assert.rejects(fsp.access(dir), { code: 'ENOENT' });
            });
            const checkout = join(dir, 'checkout');
            const artifactRoot = join(dir, 'runner-temp', 'tfman-plans');
            const forgedDir = join(checkout, 'plans', 'forged');
            const realDir = join(artifactRoot, 'plan-a');
            await fsp.mkdir(forgedDir, { recursive: true });
            await fsp.mkdir(realDir, { recursive: true });
            await fsp.writeFile(join(forgedDir, 'info.json'), JSON.stringify({ path: 'env/a', outcome: 'success' }));
            await fsp.writeFile(join(forgedDir, 'plan.txt'), 'No changes. Infrastructure is up-to-date.');
            if (hasRealArtifact) {
                await fsp.writeFile(join(realDir, 'info.json'), JSON.stringify({ path: 'env/a', outcome: 'failure' }));
                await fsp.writeFile(join(realDir, 'plan.txt'), 'Error: real plan failed');
            }
            const createComment = mock.fn();
            const create = mock.fn(async pattern => {
                assert.equal(pattern, artifactRoot + '/**/info.json');
                const selectedRoot = pattern.slice(0, -'/**/info.json'.length);
                const entries = await fsp.readdir(selectedRoot, { recursive: true });
                return { glob: async () => entries.filter(entry => entry.endsWith('info.json')).map(entry => join(selectedRoot, entry)) };
            });
            await postComment({
                github: { rest: { issues: { createComment } } },
                context: { repo: { owner: 'owner', repo: 'repo' }, issue: { number: 1 } },
                core: { info() {}, warning() {}, error(message) { assert.fail(message); } }, glob: { create },
            }, { artifactRoot, expectedPaths: ['env/a'] });
            const body = createComment.mock.calls[0].arguments[0].body;
            assert.ok(body.includes('| `env/a` | ❌ | Plan Failed |'));
            assert.doesNotMatch(body, /✅|No changes/);
            assert.match(body, hasRealArtifact ? /real plan failed/ : /No result artifact was produced/);
        });
    }
});
