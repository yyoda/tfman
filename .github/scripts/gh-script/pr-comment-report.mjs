import { ReportCommentBuilder } from '../lib/comment-builder.mjs';

/**
 * GitHub Actions script entry point for posting report comments.
 * 
 * @param {object} params - The context parameters provided by actions/github-script.
 * @param {object} params.github - The Octokit client instance.
 * @param {object} params.context - The generic GitHub context.
 * @param {object} params.core - The actions core library.
 * @param {object} params.config - Custom configuration object.
 */
export default async ({ github, context, core, config }) => {
  const { result_message, command } = config;
  const COMMENT_HEADER = ReportCommentBuilder.COMMENT_HEADER;
  
  // 1. Initialize Builder with Preamble
  const builder = new ReportCommentBuilder(command);
  if (result_message) {
    builder.addMessage(result_message);
  }

  // 2. Fetch Job Statuses
  let applyJobs = [];
  try {
    const jobs = await github.paginate(
      github.rest.actions.listJobsForWorkflowRun,
      {
        owner: context.repo.owner,
        repo: context.repo.repo,
        run_id: context.runId
      }
    );
    
    if (jobs) {
        // Filter for matrix jobs named "apply on {path}"
        applyJobs = jobs.filter(j => j.name.startsWith('apply on '));
    }
  } catch (error) {
    if (core) core.warning(`Failed to fetch jobs: ${error.message}`);
    else console.error(`Failed to fetch jobs: ${error.message}`);
  }

  // 3. Add Jobs to Builder
  if (applyJobs.length > 0) {
    for (const job of applyJobs) {
      // Extract clean target name: "apply on dev/app (matrix-1)" -> "dev/app"
      let target = job.name.replace('apply on ', '');
      target = target.split(' (')[0]; 
      
      builder.addResult(target, job.conclusion, job.html_url);
    }

    // Add Workflow Run Link
    const repoUrl = context.payload?.repository?.html_url;
    if (repoUrl) {
      const runUrl = `${repoUrl}/actions/runs/${context.runId}`;
      builder.setWorkflowRunUrl(runUrl);
    }

    // --- Commit Status Update Logic ---
    const headSha = process.env.HEAD_SHA;
    if (headSha) {
      const allSuccess = applyJobs.every(job => job.conclusion === 'success');
      const state = allSuccess ? 'success' : 'failure';
      const contextName = `terraform/${command || 'apply'}`; 
      const failedCount = applyJobs.filter(j => j.conclusion !== 'success').length;
      const description = allSuccess 
        ? 'All Terraform jobs passed' 
        : `${failedCount} job(s) failed or cancelled`;

      try {
        await github.rest.repos.createCommitStatus({
          owner: context.repo.owner,
          repo: context.repo.repo,
          sha: headSha,
          state: state,
          context: contextName,
          description: description,
          target_url: `${context.payload.repository.html_url}/actions/runs/${context.runId}`
        });
        if (core) core.info(`Commit status updated: ${state} (${contextName})`);
      } catch (error) {
        const msg = `Failed to update commit status: ${error.message}`;
        if (core) core.warning(msg);
        else console.error(msg);
      }
    }
  } else {
    // Info log if no jobs found, helpful for debugging
    if (core) core.info('No apply jobs found to report.');
  }

  // 4. Build Report
  const reportBody = builder.build();

  if (!reportBody) {
    if (core) core.info('Report body is empty. Skipping comment creation.');
    return;
  }

  // 5. Post Comment
  try {
    await github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: reportBody
    });
    if (core) core.info('Report comment posted successfully.');
    else console.log('Report comment posted successfully.');
  } catch (error) {
    const msg = `Failed to post comment: ${error.message}`;
    if (core) core.setFailed(msg);
    else console.error(msg);
  }
};
