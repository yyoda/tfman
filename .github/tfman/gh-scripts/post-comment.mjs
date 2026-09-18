import * as _fs from 'fs';
import * as _path from 'path';
import { PlanCommentBuilder, ApplyCommentBuilder } from '../lib/comment-builder.mjs';

/**
 * GitHub Actions script for posting terraform plan/apply comments.
 * 
 * @param {object} params 
 * @param {object} params.github 
 * @param {object} params.context 
 * @param {object} params.core 
 * @param {object} params.glob 
 * @param {object} options - Configuration object e.g. { mode: 'plan', deletePreviousComments: true }
 * @param {object} deps - Dependencies object (fs, path) for testing
 */
export default async ({ github, context, core, glob }, options = {}, deps = {}) => {
  const { fs = _fs, path = _path } = deps;
  const config = {
      mode: options.mode || 'plan',
      deletePreviousComments: options.deletePreviousComments === true,
      cleanupOnly: options.cleanupOnly === true,
      expectedPaths: options.expectedPaths || []
  };

  // Link to the current workflow run, where the full (untruncated) plan/apply
  // output is written to the Job Summary. Oversized inline comment detail is omitted,
  // so this link is how reviewers reach the complete output.
  const runUrl = context.runId
    ? `${context.serverUrl || 'https://github.com'}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
    : null;

  const behaviors = {
    plan: {
      logFile: 'plan.txt',
      artifactPattern: 'plans/**/info.json',
      Builder: PlanCommentBuilder
    },
    apply: {
      logFile: 'apply.txt',
      artifactPattern: 'applies/**/info.json',
      Builder: ApplyCommentBuilder
    }
  };

  const behavior = Object.hasOwn(behaviors, config.mode) ? behaviors[config.mode] : null;
  if (!behavior) {
    if (core) core.setFailed(`Unsupported mode: ${config.mode}`);
    return;
  }

  const builder = new behavior.Builder();
  const COMMENT_HEADER = behavior.Builder.COMMENT_HEADER;

  const cleanupPreviousComments = async () => {
    if (!config.deletePreviousComments) return;
    try {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        per_page: 100,
      });

      const botComments = comments.filter(comment => 
        comment.user.type === 'Bot' && 
        comment.body.includes(COMMENT_HEADER)
      );

      for (const comment of botComments) {
        await github.rest.issues.deleteComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: comment.id,
        });
      }
    } catch (error) {
      if (core) core.warning(`Failed to cleanup comments: ${error.message}`);
    }
  };

  if (config.cleanupOnly) {
    await cleanupPreviousComments();
    if (core) core.info(`Removed previous ${config.mode} comments (cleanup only).`);
    return;
  }

  // 1. Collect result artifacts
  const globber = await glob.create(behavior.artifactPattern);
  const infoFiles = await globber.glob();

  if (infoFiles.length === 0 && config.expectedPaths.length === 0) {
    await cleanupPreviousComments();
    if (core) core.info(`No ${config.mode} results found.`);
    const message = `${COMMENT_HEADER}\n\nNo ${config.mode} results were produced for this run. The ${config.mode} jobs may have failed before producing any output — check the workflow run for details.` +
      (runUrl ? `\n\n> 📄 [Workflow run](${runUrl})` : '');
    await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: message
    });
    return;
  }

  // 2. Cleanup previous comments (Controlled by flag)
  await cleanupPreviousComments();

  // 3. Add results to Builder
  const resultPaths = new Set();
  for (const infoFile of infoFiles) {
    try {
      const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      const dir = path.dirname(infoFile);
      const logPath = path.join(dir, behavior.logFile);
      
      const logExists = fs.existsSync(logPath);
      const content = logExists ? fs.readFileSync(logPath, 'utf8') : '(Log file not found)';
      const outcome = logExists ? (info.outcome ?? 'success') : 'failure';
      
      builder.addResult(info.path, content, outcome);
      resultPaths.add(info.path);

    } catch (error) {
      if (core) core.error(`Error processing ${infoFile}: ${error.message}`);
    }
  }

  for (const expectedPath of new Set(config.expectedPaths)) {
    if (!resultPaths.has(expectedPath)) {
      builder.addResult(expectedPath, '(No result artifact was produced for this path — the job may have been cancelled or failed before uploading)', 'failure');
    }
  }

  // 4. Generate the comment body and post
  const body = builder.buildComment({ runUrl });

  try {
    if (body) {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body
      });
    }
    if (core) core.info(`${config.mode} comments posted successfully.`);
  } catch (error) {
    if (core) core.setFailed(`Failed to post comments: ${error.message}`);
  }
};
