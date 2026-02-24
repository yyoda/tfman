import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PlanCommentBuilder, ApplyCommentBuilder } from '../../scripts/lib/comment-builder.mjs';

describe('ApplyCommentBuilder', () => {
    it('should generate empty string when no results', () => {
        const builder = new ApplyCommentBuilder();
        assert.strictEqual(builder.build(), '');
    });

    it('should parse successful apply output correctly', () => {
        const builder = new ApplyCommentBuilder();
        const output = `
aws_s3_bucket.example: Creating...
aws_s3_bucket.example: Creation complete after 3s [id=example-bucket]

Apply complete! Resources: 1 added, 0 changed, 0 destroyed.
        `;
        builder.addResult('dev/s3', output, 'success');

        const comment = builder.build();
        
        assert.ok(comment.includes('## 🚀 Terraform Apply Result'));
        assert.ok(comment.includes('| `dev/s3` | ✅ | +1 |'));
        assert.ok(comment.includes('<details><summary><strong>Show Output Details</strong></summary>'));
        assert.ok(comment.includes('aws_s3_bucket.example: Creating...'));
    });

    it('should parse apply with changes correctly', () => {
        const builder = new ApplyCommentBuilder();
        const output = 'Apply complete! Resources: 2 added, 1 changed, 3 destroyed.';
        builder.addResult('prod/app', output, 'success');

        const comment = builder.build();
        assert.ok(comment.includes('| `prod/app` | ✅ | +2, ~1, -3 |'));
    });

    it('should handle failed apply output', () => {
        const builder = new ApplyCommentBuilder();
        const output = `
Error: infrastructure not found

Apply failed.
        `;
        builder.addResult('stage/db', output, 'failure');

        const comment = builder.build();
        assert.ok(comment.includes('| `stage/db` | ❌ | **Error** |'));
        assert.ok(comment.includes('Error: infrastructure not found'));
    });

    it('should handle output without standard stats line', () => {
        const builder = new ApplyCommentBuilder();
        const output = 'Something unexpected happened.';
        builder.addResult('unknown/path', output, 'failure');

        const comment = builder.build();
        assert.ok(comment.includes('| `unknown/path` | ❌ | - |'));
    });

    it('should escape backticks in output', () => {
        const builder = new ApplyCommentBuilder();
        const output = 'Output contains ``` code block ```';
        builder.addResult('security/test', output, 'success');

        const comment = builder.build();
        // Should replace ``` with '''
        assert.ok(comment.includes("''' code block '''"));
        assert.ok(!comment.includes('``` code block ```'));
    });
});

describe('PlanCommentBuilder', () => {

  it('Test Case 1: No changes', () => {
    const builder = new PlanCommentBuilder();
    builder.addResult('path/to/module-1', 'No changes. Infrastructure is up-to-date.');
    
    const chunks = builder.buildChunks();
    
    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].includes('## 📋 Terraform Plan Summary'));
    assert.ok(chunks[0].includes('✅'), 'Should show success icon');
    assert.ok(chunks[0].includes('No changes'), 'Should show no changes summary');
    // No details summary if no changes
    assert.ok(!chunks[0].includes('<details>'));
  });

  it('Test Case 2: Changes detected', () => {
    const builder = new PlanCommentBuilder();
    const planOutput = `
Terraform used the selected providers to generate the following execution plan. Resource actions are indicated with the following symbols:
  + create

Terraform will perform the following actions:

Plan: 1 to add, 0 to change, 0 to destroy.
        `;
    builder.addResult('path/to/module-2', planOutput);
    
    const chunks = builder.buildChunks();
    
    assert.strictEqual(chunks.length, 1);
    assert.ok(chunks[0].includes('⚠️'), 'Should show warning icon');
    assert.ok(chunks[0].includes('+1 add'), 'Should include change summary');
    
    assert.ok(chunks[0].includes('<details>'), 'Should include details block');
    assert.ok(chunks[0].includes('Show Detailed Plans'), 'Should show details summary');
    assert.ok(chunks[0].includes('path/to/module-2'), 'Should include module path in details');
  });

  it('Test Case 3: Split required (multiple large plans)', () => {
    const builder = new PlanCommentBuilder();
    const largePlan = 'x'.repeat(1000); 
    
    // Use full Plan format to ensure it's detected as changes
    const header = "Plan: 1 to add, 0 to change, 0 to destroy.";
    
    // Add multiple large results to force split
    builder.addResult('module-1', `${header}\n${largePlan}`);
    builder.addResult('module-2', `${header}\n${largePlan}`);
    builder.addResult('module-3', `${header}\n${largePlan}`);
    
    // Limit 1500 chars. Summary takes ~200, each detail ~1100 => total > 2300 => Needs split
    const chunks = builder.buildChunks(1500); 
    
    assert.ok(chunks.length >= 2, 'Should be split into multiple chunks');
    assert.ok(chunks[0].includes('module-1'), 'First chunk should have module-1');
    
    // Check subsequent chunks for continuation header
    let foundContinuation = false;
    for (let i = 1; i < chunks.length; i++) {
       if (chunks[i].includes('Terraform Plan Details (Continued)')) {
         foundContinuation = true;
         break;
       }
    }
    assert.ok(foundContinuation, 'Should have continued header in subsequent chunks');
  });

  it('Test Case 4: Huge file truncation', () => {
    const builder = new PlanCommentBuilder();
    const hugePlan = 'x'.repeat(5000);
    
    const header = "Plan: 1 to add, 0 to change, 0 to destroy.";
    builder.addResult('huge-module', `${header}\n${hugePlan}`);
    
    // Limit 1000 chars. Should truncate.
    const chunks = builder.buildChunks(1000);
    
    const allContent = chunks.join('');
    // Implementation uses: "... (truncated)"
    assert.ok(allContent.includes('... (truncated)') || allContent.includes('... (content too long to display)'), 'Content should be truncated');
  });

  it('Test Case 5: Empty results', () => {
    const builder = new PlanCommentBuilder();
    const chunks = builder.buildChunks();
    assert.strictEqual(chunks.length, 0);
  });
});
