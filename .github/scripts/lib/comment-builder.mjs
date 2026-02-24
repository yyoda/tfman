export class PlanCommentBuilder {
  static get COMMENT_HEADER() {
    return '## 📋 Terraform Plan Summary';
  }

  static get CONTINUED_HEADER() {
    return '### 📋 Terraform Plan Details (Continued)';
  }

  constructor() {
    this.results = [];
  }

  /**
   * Add a plan result
   * @param {string} tfPath - Path to the Terraform configuration
   * @param {string} planContent - String content of the plan output
   */
  addResult(tfPath, planContent) {
    // Pre-processing of content can be done here if needed
    this.results.push({
      tfPath,
      planContent
    });
  }

  /**
   * Generate a list of chunks for the comment
   * @param {number} maxCommentLength - Maximum length of a comment (default is approx 65536 for GitHub Issue Comment limit)
   * @returns {string[]} Array of comment bodies
   */
  buildChunks(maxCommentLength = 60000) {
    if (this.results.length === 0) {
      return [];
    }

    // Sort by path
    this.results.sort((a, b) => a.tfPath.localeCompare(b.tfPath));

    const SUMMARY_HEADER = PlanCommentBuilder.COMMENT_HEADER;
    const CONTINUED_HEADER = '\n' + PlanCommentBuilder.CONTINUED_HEADER;
    
    let summaryTable = `${SUMMARY_HEADER}\n\n| Path | Result | Change Detail |\n| :--- | :---: | :--- |\n`;
    const planDetails = [];

    // Generate summary and prepare details list
    for (const res of this.results) {
      const { tfPath, planContent } = res;
      const stats = this._parseStats(planContent);
      
      summaryTable += `| \`${tfPath}\` | ${stats.icon} | ${stats.summary} |\n`;
      
      if (stats.hasChanges) {
        planDetails.push({
          path: tfPath,
          content: planContent
        });
      }
    }

    // Return only summary if there are no details
    if (planDetails.length === 0) {
      return [summaryTable];
    }

    // Process chunk splitting
    const chunks = [];
    let currentChunk = summaryTable;
    
    // Start tag for details section
    if (!currentChunk.endsWith('\n\n')) currentChunk += '\n\n';
    currentChunk += '<details><summary><strong>Show Detailed Plans</strong></summary>\n\n';

    const closingTag = '</details>';
    const buffer = 100;

    for (const detail of planDetails) {
      const { path: tfPath, content } = detail;
      const blockHeader = `### 📂 \`${tfPath}\`\n\`\`\`hcl\n`;
      const blockFooter = `\n\`\`\`\n\n`;
      
      // Estimated size if appended to current chunk
      let blockToAppend = `${blockHeader}${content}${blockFooter}`;
      let projectedLength = currentChunk.length + blockToAppend.length + closingTag.length + buffer;

      // Handle case where capacity is exceeded
      if (projectedLength > maxCommentLength) {
        // Close current chunk
        currentChunk += closingTag;
        chunks.push(currentChunk);

        // Start new chunk
        currentChunk = `${CONTINUED_HEADER}\n\n<details open><summary><strong>Show Detailed Plans (Continued)</strong></summary>\n\n`;
        
        // Calculate available space in new chunk
        const availableSpace = maxCommentLength - currentChunk.length - closingTag.length - buffer;

        // Truncate if it still doesn't fit in the new chunk
        if (blockToAppend.length > availableSpace) {
          const maxContentLen = availableSpace - blockHeader.length - blockFooter.length - 20; // error msg length
          if (maxContentLen > 0) {
            const truncatedContent = content.slice(0, maxContentLen) + '\n... (truncated)';
            blockToAppend = `${blockHeader}${truncatedContent}${blockFooter}`;
          } else {
            blockToAppend = `${blockHeader}... (content too long to display)${blockFooter}`;
          }
        }
      }
      
      currentChunk += blockToAppend;
    }

    // Close the last chunk
    if (!currentChunk.endsWith(closingTag)) {
      currentChunk += '</details>';
    }

    chunks.push(currentChunk);
    return chunks;
  }

  /**
   * Extract statistics from Plan output
   * @param {string} content 
   * @returns {{icon: string, summary: string, hasChanges: boolean}}
   */
  _parseStats(content) {
    // Plan: 1 to add, 0 to change, 0 to destroy.
    // No changes.
    
    if (content.includes('No changes.')) {
      return { icon: '✅', summary: 'No changes', hasChanges: false };
    }
    
    // Terraform 0.12+ output usually: Plan: X to add, Y to change, Z to destroy.
    
    // Sometimes it says "No changes. Infrastructure is up-to-date."
    
    let add = 0, change = 0, destroy = 0;
    
    // Try standard format
    const stdMatch = content.match(/Plan: (\d+) to add, (\d+) to change, (\d+) to destroy/);
    if (stdMatch) {
      add = parseInt(stdMatch[1], 10);
      change = parseInt(stdMatch[2], 10);
      destroy = parseInt(stdMatch[3], 10);
    } else {
      // Fallback or error case
      if (content.includes('Error:')) {
        return { icon: '❌', summary: 'Plan Failed', hasChanges: true }; 
      }
    }

    const parts = [];
    if (add > 0) parts.push(`+${add} add`);
    if (change > 0) parts.push(`~${change} change`);
    if (destroy > 0) parts.push(`-${destroy} destroy`);

    const hasChanges = (add + change + destroy) > 0;
    
    return {
      icon: hasChanges ? '⚠️' : '✅',
      summary: parts.join(', ') || 'No changes detected',
      hasChanges
    };
  }
}



export class ApplyCommentBuilder {
  static get COMMENT_HEADER() {
    return '## 🚀 Terraform Apply Result';
  }

  constructor() {
    this.results = [];
  }

  /**
   * Add an apply result
   * @param {string} tfPath 
   * @param {string} output 
   * @param {string} outcome - 'success' or 'failure'
   */
  addResult(tfPath, output, outcome) {
    this.results.push({
      tfPath,
      output,
      outcome
    });
  }

  /**
   * Build the comment body
   * @returns {string}
   */
  build() {
    if (this.results.length === 0) return '';

    // Sort by path
    this.results.sort((a, b) => a.tfPath.localeCompare(b.tfPath));

    let comment = `${ApplyCommentBuilder.COMMENT_HEADER}\n\n`;
    comment += '| Path | Outcome | Changes |\n| :--- | :---: | :--- |\n';

    for (const res of this.results) {
      const { tfPath, output, outcome } = res;
      const stats = this._parseStats(output);
      const icon = outcome === 'success' ? '✅' : '❌';
      
      comment += `| \`${tfPath}\` | ${icon} | ${stats} |\n`;
    }

    comment += '\n<details><summary><strong>Show Output Details</strong></summary>\n\n';
    
    for (const res of this.results) {
      const { tfPath, output } = res;
      // Sanitize output to avoid breaking markdown code blocks
      const safeOutput = output.replace(/```/g, "'''");
      
      comment += `### 📂 \`${tfPath}\`\n\n\`\`\`text\n${safeOutput}\n\`\`\`\n\n`;
    }
    
    comment += '</details>';

    return comment;
  }

  /**
   * Parse apply output to find resource changes
   * @param {string} output 
   * @returns {string}
   */
  _parseStats(output) {
    // Look for: "Apply complete! Resources: 1 added, 0 changed, 1 destroyed."
    const match = output.match(/Resources: (\d+) added, (\d+) changed, (\d+) destroyed/);
    if (match) {
      const added = parseInt(match[1], 10);
      const changed = parseInt(match[2], 10);
      const destroyed = parseInt(match[3], 10);

      const parts = [];
      if (added > 0) parts.push(`+${added}`);
      if (changed > 0) parts.push(`~${changed}`);
      if (destroyed > 0) parts.push(`-${destroyed}`);
      
      // If there are counts but they are all 0, it means no changes were made.
      if (parts.length === 0) return 'No changes';
      return parts.join(', ');
    }

    if (output.includes('Error:')) return '**Error**';
    
    return '-';
  }
}
