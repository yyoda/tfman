import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, mkdir, writeFile, symlink, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const source = await readFile(new URL('../../../workflows/pr-review-dispatch.yml', import.meta.url), 'utf8');
const prSource = await readFile(new URL('../../../workflows/pr-review.yml', import.meta.url), 'utf8');
const match = source.match(/      - name: Resolve PR context\n[\s\S]*?          script: \|\n([\s\S]*?)(?=\n      - )/);
assert.ok(match, 'inline context resolver must exist');
const script = match[1].replace(/^            /gm, '');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const resolve = new AsyncFunction('github', 'context', 'core', 'process', script);
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);

async function run({ env = {}, change = () => {}, apiError, defaultBranch = 'main' } = {}) {
  const pr = { state: 'open', head: { sha: head, repo: { full_name: 'owner/repo' } }, base: { sha: base, ref: 'main' } };
  change(pr);
  const get = mock.fn(async () => {
    if (apiError) throw new Error('API unavailable');
    return { data: pr };
  });
  const outputs = {};
  const setFailed = mock.fn();
  await resolve({ rest: { pulls: { get } } }, {
    repo: { owner: 'owner', repo: 'repo' }, payload: { repository: { default_branch: defaultBranch } },
  }, { setFailed, setOutput: (name, value) => { outputs[name] = value; } }, {
    env: { PR_NUMBER: '123', HEAD_SHA: head, ...env },
  });
  return { outputs, setFailed, get };
}

describe('PRReview context resolver', () => {
  for (const ref of ['main', 'master', 'release/stable']) {
    it(`accepts a current open same-repository PR against ${ref}`, async () => {
      const result = await run({ defaultBranch: ref, change: pr => { pr.base.ref = ref; } });
      assert.equal(result.setFailed.mock.callCount(), 0);
      assert.deepEqual(result.outputs, { base_sha: base, head_sha: head });
      assert.deepEqual(result.get.mock.calls[0].arguments[0], { owner: 'owner', repo: 'repo', pull_number: 123 });
    });
  }
  const invalid = [
    { name: 'bad pr_number', env: { PR_NUMBER: '123; echo unsafe' }, noApi: true },
    ...['0', '0123', '1234567890', '-1'].map(PR_NUMBER => ({ name: `invalid number ${PR_NUMBER}`, env: { PR_NUMBER }, noApi: true })),
    { name: 'empty pr_number', env: { PR_NUMBER: '' }, noApi: true },
    { name: 'bad head_sha', env: { HEAD_SHA: 'A'.repeat(40) }, noApi: true },
    { name: 'short head_sha', env: { HEAD_SHA: 'abc' }, noApi: true },
    { name: 'closed PR', change: pr => { pr.state = 'closed'; } },
    { name: 'null fork repo', change: pr => { pr.head.repo = null; } },
    { name: 'different fork repo', change: pr => { pr.head.repo.full_name = 'fork/repo'; } },
    { name: 'stale head', change: pr => { pr.head.sha = 'c'.repeat(40); } },
    { name: 'missing default branch', defaultBranch: null },
    { name: 'main is not the default branch', defaultBranch: 'trunk' },
    { name: 'unsupported base', change: pr => { pr.base.ref = 'develop'; } },
    { name: 'PR API error', apiError: true },
  ];
  for (const entry of invalid) {
    it(`rejects ${entry.name} without outputs`, async () => {
      const result = await run(entry);
      assert.equal(result.setFailed.mock.callCount(), 1);
      assert.deepEqual(result.outputs, {});
      if (entry.noApi) assert.equal(result.get.mock.callCount(), 0);
      if (entry.message) assert.match(result.setFailed.mock.calls[0].arguments[0], entry.message);
    });
  }

});

describe('PRReview dispatch structure', () => {
  const jobs = Object.fromEntries(['detect-changes', 'authorize-roots', 'plan', 'post-plan'].map(name => [name,
    source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`, 'm'))[1],
  ]));
  it('limits permissions to each job', () => {
    const workflow = source.split('\njobs:')[0];
    assert.match(workflow, /^permissions: \{\}$/m);
    assert.doesNotMatch(workflow, /id-token:|pull-requests:/);
    for (const [job, expected] of Object.entries({ 'detect-changes': 'contents: read\n      pull-requests: read', 'authorize-roots': 'contents: read', plan: 'contents: read\n      id-token: write', 'post-plan': 'contents: read\n      pull-requests: write' })) {
      assert.equal(jobs[job].match(/    permissions:\n([\s\S]*?)(?=^    \S)/m)[1].trim(), expected);
    }
  });
  it('declares required string inputs and separates pull_request events', () => {
    assert.match(source, /^name: PRReviewDispatch$/m);
    assert.match(source, /^on:\n  workflow_dispatch:/m);
    assert.doesNotMatch(source, /^  pull_request:/m);
    for (const input of ['pr_number', 'head_sha']) assert.match(source, new RegExp(`      ${input}:\\n        description: .+\\n        type: string\\n        required: true`));
    assert.match(prSource, /  pull_request:\n    types: \[opened, synchronize, reopened\]\n    branches:\n      - master\n      - main/);
  });
  it('preserves exact title, concurrency and merge expressions', () => {
    assert.ok(source.includes("run-name: >-\n  ${{ format('PRReview #{0} {1}', inputs.pr_number, inputs.head_sha) }}"));
    assert.ok(source.includes("group: PRReview-pr-${{ inputs.pr_number }}"));
    assert.match(source, /cancel-in-progress: true/);
    assert.doesNotMatch(source, /MERGE_SHA|mergeCommit|github\.event_name|ROOT_GATE_LABEL|outputs\.gate/);
    assert.doesNotMatch(source, /&&\s*''\s*\|\|/);
  });
  it('authorizes trusted code before any plan step can run', () => {
    assert.match(jobs['detect-changes'], /steps:\n      - name: Require default-branch ref/);
    const authorization = jobs['authorize-roots'];
    assert.match(authorization, /needs: detect-changes/);
    assert.match(authorization, /if: needs.detect-changes.outputs.has-changes == 'true'$/m);
    assert.match(authorization, /ref: refs\/heads\/\$\{\{ github.event.repository.default_branch \}\}/);
    assert.doesNotMatch(authorization, /inputs.head_sha|id-token:|pull-requests:/);
    assert.ok(authorization.indexOf('actions/checkout') < authorization.indexOf('await import'));
    assert.match(authorization, /import\(`\$\{process.env.GITHUB_WORKSPACE\}\/\.github\/tfman\/gh-scripts\/root-gate.mjs`\)/);
    assert.match(authorization, /MATRIX: \$\{\{ needs.detect-changes.outputs.matrix \}\}/);
    assert.match(authorization, /include.map\(entry => entry.path\)/);
    assert.match(authorization, /\{ roots, configPath: process.env.GATE_CONFIG \}/);
    const plan = jobs.plan;
    assert.doesNotMatch(plan, /Root allowlist gate|root-gate.mjs/);
    assert.match(plan, /needs: \[detect-changes, authorize-roots\]/);
    const condition = "needs.detect-changes.outputs.has-changes == 'true'";
    assert.equal(plan.match(/^    if: (.*)$/m)[1], condition);
    // Without an explicit status function, Actions implicitly requires success()
    // across every needed job, including skipped and cancelled dependencies.
    const evaluate = (expression, detectResult, hasChanges, gateResult) => {
      const implicitSuccess = !/\b(?:success|failure|cancelled|always)\s*\(/.test(expression);
      if (implicitSuccess && ![detectResult, gateResult].every(result => result === 'success')) return false;
      return new Function('hasChanges', 'return ' + expression.replaceAll('needs.detect-changes.outputs.has-changes', 'hasChanges'))(hasChanges);
    };
    for (const detectResult of ['success', 'failure']) {
      for (const hasChanges of ['true', 'false']) {
        for (const gateResult of ['success', 'failure', 'skipped', 'cancelled']) {
          assert.equal(evaluate(condition, detectResult, hasChanges, gateResult),
            detectResult === 'success' && hasChanges === 'true' && gateResult === 'success',
            JSON.stringify({ detectResult, hasChanges, gateResult }));
        }
      }
    }
    const steps = plan.split(/\n      - /).slice(1);
    assert.match(steps[0], /actions\/checkout/);
    for (const step of steps.slice(1)) {
      assert.ok(step.includes('uses:') || step.includes('run:'), step);
      assert.equal(evaluate(condition, 'success', 'true', 'failure'), false, step);
    }
    for (const name of ['Configure AWS Credentials', 'Configure Azure Credentials', 'Configure GCP Credentials']) {
      assert.ok(steps.some(step => step.startsWith(`name: ${name}\n`)), name);
    }
    assert.match(jobs['post-plan'], /needs: \[detect-changes, authorize-roots, plan\]/);
    assert.match(jobs['post-plan'], /if: \$\{\{ !cancelled\(\) && needs.detect-changes.result == 'success' \}\}/);
  });
  it('omits all cache steps while creating the provider cache directory', () => {
    assert.doesNotMatch(source, /uses: actions\/cache(?:@|\/)|name: Cache Terraform Providers|name: Cache TFLint plugins/);
    assert.match(jobs.plan, /name: Create Cache Dir\n        run: mkdir -p "\$TF_PLUGIN_CACHE_DIR"/);
  });
  it('uses a block or quoted run-name to preserve the hash character', () => {
    assert.match(source, /^run-name: (?:[>|]-|["'])/m);
  });
  it('passes inputs through env and pins all dispatch checkouts', () => {
    assert.doesNotMatch(script, /\$\{\{/);
    for (const block of source.matchAll(/^ +(run|script): \|\n((?:^ {10,}.*\n|^\n)*)/gm)) {
      assert.doesNotMatch(block[2], /\$\{\{[^\n}]*inputs\./);
    }
    assert.equal(source.split("ref: ${{ inputs.head_sha }}").length - 1, 3);
    assert.match(source, /BASE_SHA: \$\{\{ steps.pr-context.outputs.base_sha \}\}/);
    assert.match(source, /HEAD_SHA: \$\{\{ steps.pr-context.outputs.head_sha \}\}/);
    assert.match(source, /--base "\$BASE_SHA"/);
    assert.match(source, /--head "\$HEAD_SHA"/);
    assert.match(source, /issueNumber: Number\(process.env.PR_NUMBER\)/);
    assert.ok(jobs['post-plan'].includes('PR_HEAD_SHA: ${{ inputs.head_sha }}'));
    assert.ok(jobs['post-plan'].includes('PR_NUMBER: ${{ inputs.pr_number }}'));
    assert.ok(jobs['post-plan'].includes('RUN_ATTEMPT: ${{ github.run_attempt }}'));
    assert.match(jobs['post-plan'], /provenance: \{ headSha: process.env.PR_HEAD_SHA, runAttempt: process.env.RUN_ATTEMPT \}/);
    assert.match(jobs['post-plan'], /deletePreviousComments: true, cleanupOnly: !hasChanges/);
  });
});

function jobSource(workflow, name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `${name} job must exist`);
  return match[1];
}

describe('PRReview pull_request workflow', () => {
  it('keeps the original event, concurrency, checkout and cache behavior', () => {
    assert.doesNotMatch(prSource, /authorize-roots|ROOT_GATE|workflow_dispatch|inputs\.|github\.event_name|Verify dispatch scope|^run-name:/m);
    assert.ok(prSource.includes('group: ${{ github.workflow }}-${{ github.ref }}'));
    assert.match(prSource, /cancel-in-progress: true/);
    assert.match(prSource, /^permissions: \{\}$/m);
    for (const [name, permissions] of Object.entries({
      'detect-changes': 'contents: read', plan: 'contents: read\n      id-token: write',
      'post-plan': 'contents: read\n      pull-requests: write',
    })) {
      const job = jobSource(prSource, name);
      assert.equal(job.match(/    permissions:\n([\s\S]*?)(?=^    \S)/m)[1].trim(), permissions);
      assert.doesNotMatch(job, /^          ref:/m);
      if (name !== 'plan') assert.doesNotMatch(job, /id-token:/);
    }
    assert.match(jobSource(prSource, 'detect-changes'), /fetch-depth: 0/);
    const steps = jobSource(prSource, 'plan').split(/\n      - /);
    const providerCache = steps.find(step => step.startsWith('name: Cache Terraform Providers\n'));
    const lintCache = steps.find(step => step.startsWith('name: Cache TFLint plugins\n'));
    assert.match(providerCache, /uses: actions\/cache@v5/);
    assert.doesNotMatch(providerCache, /if:/);
    assert.ok(lintCache.includes("if: ${{ !cancelled() && hashFiles('.tflint.hcl') != '' }}"));
    assert.match(lintCache, /uses: actions\/cache@v5/);
  });

  it('posts PR head and merge provenance without a dispatch issue number', () => {
    const post = jobSource(prSource, 'post-plan');
    assert.ok(post.includes('PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}'));
    assert.ok(post.includes('MERGE_SHA: ${{ github.sha }}'));
    assert.ok(post.includes('RUN_ATTEMPT: ${{ github.run_attempt }}'));
    assert.match(post, /provenance: \{ headSha: process.env.PR_HEAD_SHA, mergeCommit: process.env.MERGE_SHA, runAttempt: process.env.RUN_ATTEMPT \}/);
    assert.doesNotMatch(post, /PR_NUMBER|issueNumber/);
    assert.match(post, /deletePreviousComments: true, cleanupOnly: !hasChanges/);
    assert.match(post, /needs: \[detect-changes, plan\]/);
    assert.equal(post.match(/^    if: .*$/m)[0], jobSource(source, 'post-plan').match(/^    if: .*$/m)[0]);
  });
});

function assertPlanParity(prWorkflow, dispatchWorkflow) {
  const steps = workflow => jobSource(workflow, 'plan').split('    steps:\n')[1].split(/(?=^      - )/m).filter(Boolean);
  const caches = new Set(['Cache Terraform Providers', 'Cache TFLint plugins']);
  const prSteps = steps(prWorkflow);
  const removed = prSteps.filter(step => caches.has(step.match(/^      - name: (.*)$/m)?.[1]));
  assert.equal(removed.length, 2, 'exactly two cache steps must be removed');
  assert.deepEqual(new Set(removed.map(step => step.match(/^      - name: (.*)$/m)[1])), caches);
  const dispatchSteps = steps(dispatchWorkflow);
  const refLine = '          ref: ${{ inputs.head_sha }}';
  assert.equal(dispatchSteps.join('').split(refLine).length - 1, 1, 'exactly one checkout ref line must be removed');
  assert.match(dispatchSteps[0], /^      - uses: actions\/checkout@/);
  // The with mapping belongs solely to this ref; require its exact shape.
  assert.ok(dispatchSteps[0].includes('        with:\n' + refLine + '\n'));
  dispatchSteps[0] = dispatchSteps[0].replace('        with:\n' + refLine + '\n', '');
  assert.equal(dispatchSteps.join(''), prSteps.filter(step => !removed.includes(step)).join(''),
    'Only the dispatch checkout ref and the two PRReview cache steps may differ');
}

it('guards against drift between the two plan pipelines', () => {
  assertPlanParity(prSource, source);
});

it('rejects an extra unnamed step after a cache step', () => {
  const mutated = prSource.replace('      - name: Read Terraform Version',
    '      - uses: example/unexpected@v1\n\n      - name: Read Terraform Version');
  assert.notEqual(mutated, prSource);
  assert.throws(() => assertPlanParity(mutated, source), /Only the dispatch checkout ref/);
});

it('requires the default-branch ref before resolving the PR', () => {
  const detect = jobSource(source, 'detect-changes');
  assert.match(detect, /steps:\n      - name: Require default-branch ref\n/);
  assert.ok(detect.includes("if: github.ref != format('refs/heads/{0}', github.event.repository.default_branch)"));
  assert.ok(detect.includes("run: echo 'PRReviewDispatch must be started from the default branch' >&2; exit 1"));
});

it('downloads and reads dispatch artifacts outside the checkout', () => {
  const post = jobSource(source, 'post-plan');
  assert.ok(post.includes('path: ${{ runner.temp }}/tfman-plans'));
  assert.ok(post.includes('ARTIFACT_ROOT: ${{ runner.temp }}/tfman-plans'));
  assert.match(post, /artifactRoot: process.env.ARTIFACT_ROOT/);
  assert.match(jobSource(prSource, 'post-plan'), /path: plans/);
});

const scopeStep = source.match(/      - name: Verify dispatch scope\n([\s\S]*?)(?=\n      - )/);
assert.ok(scopeStep, 'inline scope verification must exist');
const scopeScript = scopeStep[1].split('        run: |\n')[1].replace(/^          /gm, '');
const protectedPaths = ['.github', '.tflint.hcl', 'trivy.yaml', '.tfdeps.json', '.tfdepsignore', '.gitmodules', '.gitattributes', '.terraform-version'];

describe('PRReview immutable dispatch scope', () => {
  it('checks immutable output SHAs before running checkout code', () => {
    assert.doesNotMatch(scopeStep[1], /        if:/);
    assert.ok(scopeScript.includes('scope_diff=$(mktemp "${TMPDIR:-/tmp}/dispatch-scope.XXXXXX")'));
    for (const name of ['BASE_SHA', 'HEAD_SHA']) {
      assert.ok(scopeStep[1].includes(`${name}: \${{ steps.pr-context.outputs.${name.toLowerCase()} }}`));
    }
    assert.doesNotMatch(scopeScript, /\$\{\{/);
    assert.doesNotMatch(script, /listFiles|paginate|3000/);
    const checkout = source.indexOf('actions/checkout');
    const scope = source.indexOf('- name: Verify dispatch scope');
    assert.ok(checkout < scope && scope < source.indexOf('- name: Setup Node'));
    assert.ok(scope < source.indexOf('- name: Detect Changes'));
    assert.match(scopeScript, /set -euo pipefail/);
    assert.match(scopeScript, /--quiet "\$BASE_SHA" "\$HEAD_SHA" --/);
    assert.match(scopeScript, /--raw --no-renames -z "\$BASE_SHA\.\.\.\$HEAD_SHA"/);
  });

  // All Git subprocesses here are confined to disposable, isolated repositories.
  async function fixture(t) {
    const dir = await mkdtemp(join(tmpdir(), 'tfman-dispatch-scope-'));
    t.after(async () => {
      await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' });
    });
    const env = { PATH: process.env.PATH, TMPDIR: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
    const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const write = async (path, value = '# fixture\n') => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), value);
    };
    git('init', '-b', 'main');
    git('config', 'user.name', 'Scope Test');
    git('config', 'user.email', 'scope@example.invalid');
    for (const path of protectedPaths) await write(path === '.github' ? '.github/config.txt' : path);
    await write('environments/test/main.tf');
    const commit = (stage = true) => { if (stage) git('add', '.'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
    const base = commit();
    git('checkout', '-b', 'pr');
    const verify = (baseSha, headSha) => spawnSync('bash', ['-c', scopeScript], {
      cwd: dir, env: { ...env, BASE_SHA: baseSha, HEAD_SHA: headSha }, encoding: 'utf8',
    });
    const indexRawPath = (name, mode, sha) => {
      const result = spawnSync('git', ['update-index', '-z', '--index-info'], {
        cwd: dir, env, encoding: 'utf8',
        input: Buffer.concat([Buffer.from(mode + ' ' + sha + '\t'), name, Buffer.from([0])]),
      });
      assert.equal(result.status, 0, result.stderr);
    };
    return { dir, git, write, commit, base, verify, indexRawPath };
  }
  it('accepts a clean Terraform-only PR', async t => {
    const f = await fixture(t);
    await f.write('environments/test/main.tf', '# changed\n');
    const result = f.verify(f.base, f.commit());
    assert.equal(result.status, 0, result.stderr);
  });
  for (const name of ['with spaces.tf', 'with\nnewline.tf']) {
    for (const kind of ['file', 'symlink', 'gitlink']) {
      it('handles unusual ' + kind + ' name ' + JSON.stringify(name), async t => {
        const f = await fixture(t);
        const path = 'environments/test/' + name;
        if (kind === 'file') await f.write(path);
        if (kind === 'symlink') await symlink('main.tf', join(f.dir, path));
        if (kind === 'gitlink') f.git('update-index', '--add', '--cacheinfo', '160000,' + f.base + ',' + path);
        const result = f.verify(f.base, f.commit(kind !== 'gitlink'));
        if (kind === 'file') assert.equal(result.status, 0, result.stderr);
        else {
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /symlinks or submodules/);
        }
      });
    }
  }
  for (const [kind, mode] of [['file', '100644'], ['symlink', '120000'], ['gitlink', '160000']]) {
    it('handles non-UTF-8 ' + kind + ' paths in the Git tree', async t => {
      const f = await fixture(t);
      // Write the raw name into the index so filesystems requiring UTF-8
      // cannot normalize or reject the test name before the scope script sees it.
      const name = Buffer.concat([Buffer.from('environments/test/non-utf8-'), Buffer.from([0xff])]);
      const sha = kind === 'gitlink' ? f.base : f.git('rev-parse', 'HEAD:environments/test/main.tf');
      f.indexRawPath(name, mode, sha);
      const result = f.verify(f.base, f.commit(false));
      if (kind === 'file') assert.equal(result.status, 0, result.stderr);
      else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /symlinks or submodules/);
      }
    });
  }
  it('accepts unchanged symlinks already present in the base root', async t => {
    const f = await fixture(t);
    await symlink('main.tf', join(f.dir, 'environments/test/link'));
    const baseWithLink = f.commit();
    await f.write('environments/test/main.tf', '# changed\n');
    const result = f.verify(baseWithLink, f.commit());
    assert.equal(result.status, 0, result.stderr);
  });
  for (const path of protectedPaths) {
    it(`rejects a change to ${path}`, async t => {
      const f = await fixture(t);
      await f.write(path === '.github' ? '.github/config.txt' : path, '# changed\n');
      const result = f.verify(f.base, f.commit());
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /protected paths differ/);
    });
  }
  it('rejects a branch behind a base-side protected change', async t => {
    const f = await fixture(t);
    await f.write('environments/test/main.tf', '# changed\n');
    const head = f.commit();
    f.git('checkout', 'main');
    await f.write('.github/config.txt', '# base update\n');
    const baseTip = f.commit();
    f.git('checkout', 'pr');
    const result = f.verify(baseTip, head);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /update your branch/);
  });
  for (const kind of ['symlink', 'gitlink', '.terraform', '.terraform.d', 'protected rename', 'missing base', 'missing head']) {
    it(`rejects ${kind}`, async t => {
      const f = await fixture(t);
      if (kind === 'symlink') await symlink('main.tf', join(f.dir, 'environments/test/link'));
      else if (kind === 'gitlink') f.git('update-index', '--add', '--cacheinfo', `160000,${f.base},environments/test/module`);
      else if (kind.startsWith('.terraform')) await f.write(`environments/test/${kind}/cached/provider`);
      else if (kind === 'protected rename') await rename(join(f.dir, '.tflint.hcl'), join(f.dir, 'moved.hcl'));
      else await f.write('environments/test/main.tf', '# changed\n');
      const head = f.commit(kind !== 'gitlink');
      const result = f.verify(kind === 'missing base' ? '0'.repeat(40) : f.base, kind === 'missing head' ? '0'.repeat(40) : head);
      assert.notEqual(result.status, 0, result.stderr);
      if (['symlink', 'gitlink'].includes(kind)) assert.match(result.stderr, /symlinks or submodules/);
      if (kind.startsWith('.terraform')) assert.match(result.stderr, /generated Terraform trees/);
      if (kind === 'protected rename') assert.match(result.stderr, /protected paths differ/);
    });
  }
});
