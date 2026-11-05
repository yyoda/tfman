import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../../workflows/pr-comment.yml', import.meta.url), 'utf8');
const step = name => {
  const start = source.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `Missing step: ${name}`);
  const end = source.indexOf('\n      - ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
};

describe('PRComment stale branch guard', () => {
  it('passes the base branch name from PR details to setup and the CLI', () => {
    assert.match(step('Get PR Details'), /--json baseRefOid,headRefOid,baseRefName/);
    assert.match(step('Get PR Details'), /base_ref=.*jq -r \.baseRefName/);
    assert.ok(source.includes('base_ref: ${{ steps.pr-details.outputs.base_ref }}'));
    const parse = step('Parse Comment and Generate Matrix');
    assert.ok(parse.includes('BASE_REF: ${{ steps.pr-details.outputs.base_ref }}'));
    assert.ok(parse.includes('--base-ref "$BASE_REF"'));
  });
  it('re-checks after both role checks and before apply using only the CLI', () => {
    const apply = step('Terraform Apply');
    assert.ok(apply.includes('BASE_REF: ${{ needs.setup.outputs.base_ref }}'));
    assert.ok(apply.includes('HEAD_SHA: ${{ needs.setup.outputs.head_sha }}'));
    const line = 'node "$GITHUB_WORKSPACE/.github/tfman/cli/index.mjs" check-base-ancestry --base-ref "$BASE_REF" --head-sha "$HEAD_SHA"';
    const check = apply.indexOf(line);
    assert.ok(check >= 0);
    assert.equal(apply.split(line).length, 2);
    for (const role of ['if ! echo "$APPLIERS"', 'if ! echo "$ROLES"']) {
      assert.ok(apply.indexOf(role) >= 0 && apply.indexOf(role) < check);
    }
    assert.ok(check < apply.indexOf('TARGET_FLAGS=()'));
    assert.ok(check < apply.indexOf('terraform apply -auto-approve'));
    assert.doesNotMatch(apply, /git |continue-on-error|\|\| true/);
  });
  it('leaves plan unguarded and uses no fixed base branch', () => {
    assert.doesNotMatch(step('Terraform Plan'), /BASE_REF|merge-base|base-ref|check-base-ancestry/);
    assert.doesNotMatch(source, /origin\/main|refs\/heads\/main/);
  });
});
