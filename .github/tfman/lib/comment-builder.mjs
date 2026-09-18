// Default upper bound for a single GitHub Issue/PR comment body.
// GitHub's hard limit is 65536 characters; we stay well under it for safety.
export const DEFAULT_MAX_COMMENT_LENGTH = 60000;

/**
 * Build a single fenced detail block with the full output for one path.
 * @param {string} tfPath
 * @param {string} content
 * @param {string} fence - Code fence language (e.g. 'hcl', 'text')
 * @returns {string}
 */
function buildDetailBlock(tfPath, content, fence) {
  const header = `### 📂 \`${tfPath}\`\n\n\`\`\`${fence}\n`;
  const footer = `\n\`\`\`\n\n`;
  // Sanitize to avoid breaking the surrounding markdown code fence.
  const body = content.replace(/```/g, "'''");
  return `${header}${body}${footer}`;
}

/**
 * Wrap detail blocks in a collapsible <details> section.
 * @param {string[]} detailBlocks
 * @param {string} label - Summary label for the <details> element
 * @returns {string} '' when there are no blocks
 */
function wrapDetails(detailBlocks, label) {
  if (detailBlocks.length === 0) return '';
  return `\n<details><summary><strong>${label}</strong></summary>\n\n${detailBlocks.join('')}</details>`;
}

/**
 * Assemble a comment with a graded fallback so that the common case is
 * unchanged and only oversized output is degraded:
 *   1. Full inline output (no link footer) — kept whenever it fits the limit.
 *   2. Summary table only + a link to the full output in the run summary.
 *   3. Truncate summary rows with an omission row when the table does not fit.
 * The returned body is guaranteed to be within maxCommentLength.
 * @param {object} params
 * @param {string} params.summaryHeader - Comment header and table headings
 * @param {string[]} params.summaryRows - Table rows, each ending with a newline
 * @param {Array<{tfPath: string, content: string, fence: string}>} params.details
 * @param {string} params.detailsLabel - <details> summary label
 * @param {string} params.linkFooter - Footer linking to the full output (may be '')
 * @param {number} params.maxCommentLength
 * @returns {string}
 */
function assembleComment({ summaryHeader, summaryRows, details, detailsLabel, linkFooter, maxCommentLength }) {
  const summary = summaryHeader + summaryRows.join('');

  // 1. Prefer the full, untruncated output with no extra footer — this keeps
  //    the output identical to the previous behavior whenever it fits.
  const fullBlocks = details.map(d => buildDetailBlock(d.tfPath, d.content, d.fence));
  const full = summary + wrapDetails(fullBlocks, detailsLabel);
  if (full.length <= maxCommentLength) {
    return full;
  }

  // 2. Too large: drop inline details entirely and add the link.
  const note = '\n> ⚠️ Inline details were omitted because they exceed the comment size limit. See the workflow run summary for the full output.\n';
  const summaryOnly = summary + linkFooter + note;
  if (summaryOnly.length <= maxCommentLength) {
    return summaryOnly;
  }

  // 3. Reserve room for the omission row before retaining each summary row.
  const omissionRow = omitted => `| … | | ${omitted} more paths omitted — see the workflow run summary |\n`;
  let retained = '';
  let kept = 0;
  for (const row of summaryRows) {
    const length = summaryHeader.length + retained.length + row.length +
      omissionRow(summaryRows.length - kept - 1).length + linkFooter.length + note.length;
    if (length > maxCommentLength) break;
    retained += row;
    kept++;
  }
  return summaryHeader + retained + omissionRow(summaryRows.length - kept) + linkFooter + note;
}

export class PlanCommentBuilder {
  static get COMMENT_HEADER() {
    return '## 📋 Terraform Plan Summary';
  }

  constructor() {
    this.results = [];
  }

  /**
   * Add a plan result
   * @param {string} tfPath - Path to the Terraform configuration
   * @param {string} planContent - String content of the plan output
   * @param {string} [outcome='success'] - Plan step outcome
   */
  addResult(tfPath, planContent, outcome = 'success') {
    this.results.push({
      tfPath,
      planContent,
      outcome
    });
  }

  /**
   * Build the comment body. The full inline output is kept whenever it fits
   * GitHub's comment size limit; oversized output becomes summary-only with
   * a link to the full output in the run summary. Summary rows are truncated
   * only if needed. See assembleComment for the graded fallback.
   * @param {object} [options]
   * @param {string|null} [options.runUrl] - URL of the workflow run holding the full output
   * @param {number} [options.maxCommentLength]
   * @returns {string} Comment body ('' when there are no results)
   */
  buildComment({ runUrl = null, maxCommentLength = DEFAULT_MAX_COMMENT_LENGTH } = {}) {
    if (this.results.length === 0) return '';

    this.results.sort((a, b) => a.tfPath.localeCompare(b.tfPath));

    const summaryHeader = `${PlanCommentBuilder.COMMENT_HEADER}\n\n| Path | Result | Change Detail |\n| :--- | :---: | :--- |\n`;
    const summaryRows = [];
    const details = [];

    for (const { tfPath, planContent, outcome } of this.results) {
      const stats = this._parseStats(planContent, outcome);
      summaryRows.push(`| \`${tfPath}\` | ${stats.icon} | ${stats.summary} |\n`);
      if (stats.hasChanges) {
        details.push({ tfPath, content: planContent, fence: 'hcl' });
      }
    }

    const linkFooter = runUrl
      ? `\n> 📄 Full plan output is available in the [workflow run summary](${runUrl}).\n`
      : '';

    return assembleComment({
      summaryHeader,
      summaryRows,
      details,
      detailsLabel: 'Show Detailed Plans',
      linkFooter,
      maxCommentLength
    });
  }

  /**
   * Extract statistics from Plan output
   * @param {string} content
   * @param {string} [outcome='success'] - Plan step outcome
   * @returns {{icon: string, summary: string, hasChanges: boolean}}
   */
  _parseStats(content, outcome = 'success') {
    // Plan: 1 to add, 0 to change, 0 to destroy.
    // No changes.

    if (outcome !== 'success') {
      return { icon: '❌', summary: 'Plan Failed', hasChanges: true };
    }

    let imported = 0, add = 0, change = 0, destroy = 0;

    // Try standard format. Plans that include config-driven import blocks
    // (Terraform 1.5+) prefix the summary with "N to import, " — capture it
    // optionally so those plans aren't misread as "no changes".
    const stdMatch = content.match(/Plan:\s*(?:(\d+) to import, )?(\d+) to add, (\d+) to change, (\d+) to destroy/);
    const outputsChanged = content.includes('Changes to Outputs:');
    if (!stdMatch && !outputsChanged && /^No changes\./m.test(content)) {
      return { icon: '✅', summary: 'No changes', hasChanges: false };
    }
    if (stdMatch) {
      imported = stdMatch[1] ? parseInt(stdMatch[1], 10) : 0;
      add = parseInt(stdMatch[2], 10);
      change = parseInt(stdMatch[3], 10);
      destroy = parseInt(stdMatch[4], 10);
    } else {
      // Fallback or error case
      if (content.includes('Error:')) {
        return { icon: '❌', summary: 'Plan Failed', hasChanges: true };
      }
    }

    const parts = [];
    if (imported > 0) parts.push(`↩${imported} import`);
    if (add > 0) parts.push(`+${add} add`);
    if (change > 0) parts.push(`~${change} change`);
    if (destroy > 0) parts.push(`-${destroy} destroy`);

    if (outputsChanged) parts.push('outputs changed');

    const hasChanges = (imported + add + change + destroy) > 0 || outputsChanged;

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
   * Build the comment body. The full inline output is kept whenever it fits
   * GitHub's comment size limit; oversized output becomes summary-only with
   * a link to the full output in the run summary. Summary rows are truncated
   * only if needed. See assembleComment for the graded fallback.
   * @param {object} [options]
   * @param {string|null} [options.runUrl] - URL of the workflow run holding the full output
   * @param {number} [options.maxCommentLength]
   * @returns {string} Comment body ('' when there are no results)
   */
  buildComment({ runUrl = null, maxCommentLength = DEFAULT_MAX_COMMENT_LENGTH } = {}) {
    if (this.results.length === 0) return '';

    this.results.sort((a, b) => a.tfPath.localeCompare(b.tfPath));

    const summaryHeader = `${ApplyCommentBuilder.COMMENT_HEADER}\n\n| Path | Outcome | Changes |\n| :--- | :---: | :--- |\n`;
    const summaryRows = [];
    const details = [];

    for (const { tfPath, output, outcome } of this.results) {
      const stats = this._parseStats(output);
      const icon = outcome === 'success' ? '✅' : '❌';
      summaryRows.push(`| \`${tfPath}\` | ${icon} | ${stats} |\n`);
      details.push({ tfPath, content: output, fence: 'text' });
    }

    const linkFooter = runUrl
      ? `\n> 📄 Full apply output is available in the [workflow run summary](${runUrl}).\n`
      : '';

    return assembleComment({
      summaryHeader,
      summaryRows,
      details,
      detailsLabel: 'Show Output Details',
      linkFooter,
      maxCommentLength
    });
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
