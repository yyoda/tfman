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

export class CustomCommandCommentBuilder {
  /**
   * @param {string} command - 'plan' or 'apply'
   */
  constructor(command) {
    this.command = command || 'unknown';
    this.results = [];
    this.messages = [];
    this.workflowRunUrl = '';
  }

  /**
   * Add a job result
   * @param {string} target - The target name (e.g. 'dev/base')
   * @param {string} conclusion - The job conclusion (e.g. 'success', 'failure')
   * @param {string} url - The URL to the job logs
   */
  addResult(target, conclusion, url) {
    this.results.push({ target, conclusion, url });
  }

  /**
   * Add a custom message to the report
   * @param {string} message 
   */
  addMessage(message) {
    if (message) {
      this.messages.push(message);
    }
  }

  /**
   * Set the workflow run URL for the footer
   * @param {string} url 
   */
  setWorkflowRunUrl(url) {
    this.workflowRunUrl = url;
  }

  /**
   * Build the markdown report
   * @returns {string} The markdown content
   */
  build() {    
    let report = '';

    // Add custom messages
    if (this.messages.length > 0) {
      report += `${this.messages.join('\n\n')}\n\n`;
    }

    // If no results, handle "No execution jobs" case
    if (this.results.length === 0) {
      if (this.messages.length === 0) {
         report += "No execution jobs found. (Maybe filtered or skipped?)";
      }
      return report.trim();
    }

    // Determine overall status
    const allSuccess = this.results.every(r => r.conclusion === 'success');
    const statusIcon = allSuccess ? '✅' : '❌';
    
    let statusSummary = '';
    if (this.command === 'plan') {
      statusSummary = allSuccess ? 'Plan Completed' : 'Plan Failed';
    } else {
      statusSummary = allSuccess ? 'Apply Succeeded' : 'Apply Failed';
    }
    
    const statusLine = `### ${statusIcon} ${statusSummary}`;

    report += `${statusLine}\n\n| Target | Status | Link |\n| :--- | :---: | :--- |\n`;

    // Sort by target
    this.results.sort((a, b) => a.target.localeCompare(b.target));

    for (const res of this.results) {
      let icon = '❓';
      if (res.conclusion === 'success') icon = '✅';
      else if (res.conclusion === 'failure') icon = '❌';
      else if (res.conclusion === 'cancelled') icon = '🚫';
      else if (res.conclusion === 'skipped') icon = '⏭️';

      const link = res.url ? `[Log](${res.url})` : '-';
      report += `| \`${res.target}\` | ${icon} | ${link} |\n`;
    }

    // Add footer
    if (this.workflowRunUrl) {
      report += `\n[View Workflow Run](${this.workflowRunUrl})`;
    }

    return report;
  }
}
