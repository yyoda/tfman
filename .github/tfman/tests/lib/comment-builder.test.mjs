import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PlanCommentBuilder, ApplyCommentBuilder } from '../../lib/comment-builder.mjs';

describe('ApplyCommentBuilder', () => {

  it('should truncate oversized summary tables with an omission row', () => {
    const builder = new ApplyCommentBuilder();
    const runUrl = 'https://example.invalid/r/1';
    const paths = Array.from({ length: 300 }, (_, i) =>
      `environments/very-long-environment-name-${String(i).padStart(3, '0')}/stack`);
    for (const path of paths) {
      builder.addResult(path, 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.', 'success');
    }

    const comment = builder.buildComment({ runUrl, maxCommentLength: 5000 });
    assert.ok(comment.length <= 5000, `Comment length ${comment.length} should be <= 5000`);
    assert.ok(comment.includes(ApplyCommentBuilder.COMMENT_HEADER));
    assert.ok(comment.includes(paths[0]));
    assert.ok(!comment.includes(paths[paths.length - 1]));
    assert.ok(comment.includes('more paths omitted'));
    assert.ok(comment.includes(`[workflow run summary](${runUrl})`));
  });

    it('should return empty string when no results', () => {
        const builder = new ApplyCommentBuilder();
        assert.strictEqual(builder.buildComment(), '');
    });

    it('should parse successful apply output correctly (full inline)', () => {
        const builder = new ApplyCommentBuilder();
        const output = `
aws_s3_bucket.example: Creating...
aws_s3_bucket.example: Creation complete after 3s [id=example-bucket]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
        `;
        builder.addResult('dev/s3', output, 'success');

        const comment = builder.buildComment();

        assert.ok(comment.includes('## 🚀 Terraform Apply Result'));
        assert.ok(comment.includes('| `dev/s3` | ✅ | +1 |'));
        assert.ok(comment.includes('<details><summary><strong>Show Output Details</strong></summary>'));
        assert.ok(comment.includes('aws_s3_bucket.example: Creating...'));
    });

    it('should parse apply with changes correctly', () => {
        const builder = new ApplyCommentBuilder();
        const output = 'Apply complete! Resources: 2 added, 1 changed, 3 destroyed.';
        builder.addResult('prod/app', output, 'success');

        const comment = builder.buildComment();
        assert.ok(comment.includes('| `prod/app` | ✅ | +2, ~1, -3 |'));
    });

    it('should handle failed apply output', () => {
        const builder = new ApplyCommentBuilder();
        const output = `
Error: infrastructure not found

Apply failed.
        `;
        builder.addResult('stage/db', output, 'failure');

        const comment = builder.buildComment();
        assert.ok(comment.includes('| `stage/db` | ❌ | **Error** |'));
        assert.ok(comment.includes('Error: infrastructure not found'));
    });

    it('should handle output without standard stats line', () => {
        const builder = new ApplyCommentBuilder();
        const output = 'Something unexpected happened.';
        builder.addResult('unknown/path', output, 'failure');

        const comment = builder.buildComment();
        assert.ok(comment.includes('| `unknown/path` | ❌ | - |'));
    });

    it('should escape backticks in output', () => {
        const builder = new ApplyCommentBuilder();
        const output = 'Output contains ``` code block ```';
        builder.addResult('security/test', output, 'success');

        const comment = builder.buildComment();
        // Should replace ``` with '''
        assert.ok(comment.includes("''' code block '''"));
        assert.ok(!comment.includes('``` code block ```'));
    });

    it('should NOT add a run summary link when the full output fits', () => {
        const builder = new ApplyCommentBuilder();
        builder.addResult('dev/s3', 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.', 'success');

        const comment = builder.buildComment({ runUrl: 'https://github.com/org/repo/actions/runs/1' });
        // Normal (fitting) case is unchanged: no truncation, no link footer.
        assert.ok(!comment.includes('workflow run summary'), 'No link footer when it fits');
        assert.ok(comment.includes('<details>'), 'Full details remain when it fits');
        assert.ok(!comment.includes('Inline details were omitted'), 'No omission note when it fits');
    });

    it('should fall back to summary-only + link when it exceeds the limit', () => {
        const builder = new ApplyCommentBuilder();
        const url = 'https://github.com/org/repo/actions/runs/123';
        builder.addResult('big', 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.\n' + 'x'.repeat(3000), 'success');

        const comment = builder.buildComment({ runUrl: url, maxCommentLength: 1500 });
        assert.ok(comment.length <= 1500, `Comment length ${comment.length} should be <= 1500`);
        assert.ok(!comment.includes('<details>'), 'Inline details should be omitted');
        assert.ok(comment.includes('Inline details were omitted'), 'Should explain the omission');
        assert.ok(comment.includes(`[workflow run summary](${url})`), 'Should link to the run summary');
    });

    it('should keep all summary rows when details for multiple paths exceed the limit', () => {
        const builder = new ApplyCommentBuilder();
        const url = 'https://github.com/org/repo/actions/runs/9';
        for (let i = 0; i < 6; i++) {
            builder.addResult(`module-${i}`, 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.\n' + 'x'.repeat(1000), 'success');
        }

        const comment = builder.buildComment({ runUrl: url, maxCommentLength: 2000 });
        assert.ok(comment.length <= 2000, `Comment length ${comment.length} should be <= 2000`);
        assert.ok(!comment.includes('<details>'), 'Inline details should be dropped on overflow');
        assert.ok(comment.includes('Inline details were omitted'), 'Should note that details were omitted');
        assert.ok(comment.includes(`[workflow run summary](${url})`), 'Should link to the run summary');
        // Summary must still be present for every path
        assert.ok(comment.includes('module-0') && comment.includes('module-5'));
    });
});

describe('PlanCommentBuilder', () => {

  it('should truncate oversized summary tables with an omission row', () => {
    const builder = new PlanCommentBuilder();
    const runUrl = 'https://example.invalid/r/1';
    const paths = Array.from({ length: 300 }, (_, i) =>
      `environments/very-long-environment-name-${String(i).padStart(3, '0')}/stack`);
    for (const path of paths) {
      builder.addResult(path, 'Plan: 1 to add, 0 to change, 0 to destroy.', 'success');
    }

    const comment = builder.buildComment({ runUrl, maxCommentLength: 5000 });
    assert.ok(comment.length <= 5000, `Comment length ${comment.length} should be <= 5000`);
    assert.ok(comment.includes(PlanCommentBuilder.COMMENT_HEADER));
    assert.ok(comment.includes(paths[0]));
    assert.ok(!comment.includes(paths[paths.length - 1]));
    assert.ok(comment.includes('more paths omitted'));
    assert.ok(comment.includes(`[workflow run summary](${runUrl})`));
  });


  it('should include failed plan output in details', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('env/a', 'Error: something broke', 'failure');
    const comment = builder.buildComment();
    assert.ok(comment.includes('| `env/a` | ❌ | Plan Failed |'));
    assert.ok(comment.includes('<details>'));
    assert.ok(comment.includes('Error: something broke'));
  });

  it('should report missing plan output as failure', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('env/b', '(Log file not found)', 'failure');
    const comment = builder.buildComment();
    assert.ok(comment.includes('| `env/b` | ❌ | Plan Failed |'));
    assert.ok(!comment.includes('No changes detected'));
  });

  it('should report output-only changes with details', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('env/outputs', `Changes to Outputs:
  + endpoint = "https://example.invalid"

You can apply this plan to save these new output values to the Terraform state, without changing any real infrastructure.`);
    const comment = builder.buildComment();
    assert.ok(comment.includes('| `env/outputs` | ⚠️ | outputs changed |'));
    assert.ok(comment.includes('<details>'));
    assert.ok(!comment.includes('No changes detected'));
  });

  it('should combine resource and output changes', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('env/both', 'Plan: 1 to add, 0 to change, 0 to destroy.\nChanges to Outputs:');
    assert.ok(builder.buildComment().includes('+1 add, outputs changed'));
  });

  it('should default omitted outcome to success', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('env/default', 'Plan: 1 to add, 0 to change, 0 to destroy.');
    assert.ok(builder.buildComment().includes('| `env/default` | ⚠️ | +1 add |'));
  });

  it('No changes: omits the details block', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('path/to/module-1', 'No changes. Infrastructure is up-to-date.');

    const comment = builder.buildComment();

    assert.ok(comment.includes('## 📋 Terraform Plan Summary'));
    assert.ok(comment.includes('✅'), 'Should show success icon');
    assert.ok(comment.includes('No changes'), 'Should show no changes summary');
    // No details block if no changes
    assert.ok(!comment.includes('<details>'));
  });

  it('Changes detected: includes full details inline', () => {
    const builder = new PlanCommentBuilder();
    const planOutput = `
Terraform used the selected providers to generate the following execution plan. Resource actions are indicated with the following symbols:
  + create

Terraform will perform the following actions:

Plan: 1 to add, 0 to change, 0 to destroy.
        `;
    builder.addResult('path/to/module-2', planOutput);

    const comment = builder.buildComment();

    assert.ok(comment.includes('⚠️'), 'Should show warning icon');
    assert.ok(comment.includes('+1 add'), 'Should include change summary');
    assert.ok(comment.includes('<details>'), 'Should include details block');
    assert.ok(comment.includes('Show Detailed Plans'), 'Should show details summary');
    assert.ok(comment.includes('path/to/module-2'), 'Should include module path in details');
  });

  it('Changes with imports: still detected as changes (config-driven import blocks)', () => {
    const builder = new PlanCommentBuilder();
    const planOutput = `
Terraform used the selected providers to generate the following execution plan. Resource actions are indicated with the following symbols:
  + create
  ~ update in-place
  - destroy
  <= import

Terraform will perform the following actions:

Plan: 2 to import, 4 to add, 11 to change, 1 to destroy.
        `;
    builder.addResult('path/to/module-3', planOutput);

    const comment = builder.buildComment();

    assert.ok(comment.includes('⚠️'), 'Should show warning icon, not success');
    assert.ok(!comment.includes('No changes detected'), 'Should not report no changes');
    assert.ok(comment.includes('↩2 import'), 'Should include import count');
    assert.ok(comment.includes('+4 add'), 'Should include add count');
    assert.ok(comment.includes('~11 change'), 'Should include change count');
    assert.ok(comment.includes('-1 destroy'), 'Should include destroy count');
    assert.ok(comment.includes('<details>'), 'Should include details block');
  });

  it('should NOT add a run summary link when the full output fits', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('m', 'Plan: 1 to add, 0 to change, 0 to destroy.');

    const comment = builder.buildComment({ runUrl: 'https://github.com/org/repo/actions/runs/1' });
    assert.ok(!comment.includes('workflow run summary'), 'No link footer when it fits');
    assert.ok(comment.includes('<details>'), 'Full details remain when it fits');
    assert.ok(!comment.includes('Inline details were omitted'), 'No omission note when it fits');
  });

  it('should fall back to summary-only + link when it exceeds the limit', () => {
    const builder = new PlanCommentBuilder();
    const url = 'https://github.com/org/repo/actions/runs/999';
    builder.addResult('huge-module', `Plan: 1 to add, 0 to change, 0 to destroy.\n${'x'.repeat(3000)}`);

    const comment = builder.buildComment({ runUrl: url, maxCommentLength: 1500 });
    assert.ok(comment.length <= 1500, `Comment length ${comment.length} should be <= 1500`);
    assert.ok(!comment.includes('<details>'), 'Inline details should be omitted');
    assert.ok(comment.includes('Inline details were omitted'), 'Should explain the omission');
    assert.ok(comment.includes(`[workflow run summary](${url})`), 'Should link to the run summary');
  });

  it('should keep all summary rows when details for multiple paths exceed the limit', () => {
    const builder = new PlanCommentBuilder();
    const url = 'https://github.com/org/repo/actions/runs/9';
    const header = 'Plan: 1 to add, 0 to change, 0 to destroy.';
    for (let i = 0; i < 6; i++) {
      builder.addResult(`module-${i}`, `${header}\n${'x'.repeat(1000)}`);
    }

    const comment = builder.buildComment({ runUrl: url, maxCommentLength: 2000 });
    assert.ok(comment.length <= 2000, `Comment length ${comment.length} should be <= 2000`);
    assert.ok(!comment.includes('<details>'), 'Inline details should be dropped on overflow');
    assert.ok(comment.includes('Inline details were omitted'), 'Should note that details were omitted');
    assert.ok(comment.includes(`[workflow run summary](${url})`), 'Should link to the run summary');
  });

  it('Empty results: returns empty string', () => {
    const builder = new PlanCommentBuilder();
    assert.strictEqual(builder.buildComment(), '');
  });
});

it('reports output changes even when an output contains No changes.', () => {
  const builder = new PlanCommentBuilder();
  builder.addResult('env/outputs', 'Changes to Outputs:\n  + message = "No changes."', 'success');
  const comment = builder.buildComment();
  assert.ok(comment.includes('| `env/outputs` | ⚠️ | outputs changed |'));
  assert.ok(comment.includes('<details>'));
  assert.ok(comment.includes('message = "No changes."'));
});

it('prioritizes a Plan summary over a No changes line', () => {
  const builder = new PlanCommentBuilder();
  builder.addResult('env/resources', 'No changes.\nPlan: 1 to add, 0 to change, 0 to destroy.', 'success');
  assert.ok(builder.buildComment().includes('| `env/resources` | ⚠️ | +1 add |'));
});
