import fs from 'fs';
import path from 'path';
import { PlanCommentBuilder } from '../../lib/comment-builder.mjs';

/**
 * GitHub Actions script entry point for posting plan review comments.
 * 
 * @param {object} params - The context parameters provided by actions/github-script.
 * @param {object} params.github - The Octokit client instance.
 * @param {object} params.context - The generic GitHub context.
 * @param {object} params.core - The actions core library.
 * @param {object} params.glob - The actions glob library.
 */
export default async ({ github, context, core, glob }) => {
  const COMMENT_HEADER = PlanCommentBuilder.COMMENT_HEADER;
  const CONTINUED_HEADER = PlanCommentBuilder.CONTINUED_HEADER;

  // 1. Cleanup previous Plan comments
  try {
    const { data: comments } = await github.rest.issues.listComments({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
    });

    const botComments = comments.filter(comment => 
      comment.user.type === 'Bot' && 
      (comment.body.includes(COMMENT_HEADER) || comment.body.includes(CONTINUED_HEADER))
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

  // 2. Collect plan result artifacts
  const globber = await glob.create('plans/**/info.json');
  const infoFiles = await globber.glob();
  if (infoFiles.length === 0) {
    if (core) core.info('No plans found to post.');
    return;
  }

  // 3. Add results to Builder
  const builder = new PlanCommentBuilder();
  for (const infoFile of infoFiles) {
    try {
      const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      const planFile = path.join(path.dirname(infoFile), 'plan.txt');
      
      if (fs.existsSync(planFile)) {
        const content = fs.readFileSync(planFile, 'utf8');
        builder.addResult(info.path, content);
      }
    } catch (error) {
      if (core) core.error(`Error processing ${infoFile}: ${error.message}`);
    }
  }

  // 4. Generate comments and post
  const chunks = builder.buildChunks();
  try {
    for (const chunk of chunks) {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body: chunk
      });
    }
    if (core) core.info('Plan comments posted successfully.');
  } catch (error) {
    if (core) core.setFailed(`Failed to post comments: ${error.message}`);
  }
};
