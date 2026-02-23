import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PlanCommentBuilder, ReportCommentBuilder } from '../../scripts/lib/comment-builder.mjs';

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

describe('ReportCommentBuilder', () => {
  it('should generate empty warning when no data', () => {
    const builder = new ReportCommentBuilder('apply');
    const output = builder.build();
    assert.ok(output.includes(ReportCommentBuilder.COMMENT_HEADER));
    assert.ok(output.includes('No execution jobs found'));
  });

  it('should generate message-only report', () => {
    const builder = new ReportCommentBuilder('plan');
    builder.addMessage('Just a message.');
    const output = builder.build();
    assert.ok(output.includes('Just a message.'));
    assert.ok(!output.includes('| Target |'), 'Should not have table');
  });

  it('should generate success report with table and link', () => {
    const builder = new ReportCommentBuilder('apply');
    builder.addResult('dev/app', 'success', 'http://log/1');
    builder.setWorkflowRunUrl('http://run/1');
    
    const output = builder.build();
    
    assert.ok(output.includes('### ✅ Apply Succeeded'));
    assert.ok(output.includes('| `dev/app` | ✅ | [Log](http://log/1) |'));
    assert.ok(output.includes('[View Workflow Run](http://run/1)'));
  });

  it('should generate failure report', () => {
    const builder = new ReportCommentBuilder('plan');
    builder.addResult('prod/db', 'failure', 'http://log/2');
    
    const output = builder.build();
    assert.ok(output.includes('### ❌ Plan Failed'));
    assert.ok(output.includes('| `prod/db` | ❌ |'));
  });
});
