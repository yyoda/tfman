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
      deletePreviousComments: options.deletePreviousComments === true
  };

  const behaviors = {
    plan: {
      logFile: 'plan.txt',
      artifactPattern: 'plans/**/info.json',
      builder: {
        factory: () => new PlanCommentBuilder(),
        add: (builder, path, content, _) => builder.addResult(path, content),
        build: (builder) => builder.buildChunks()
      }
    },
    apply: {
      logFile: 'apply.txt',
      artifactPattern: 'applies/**/info.json',
      builder: {
        factory: () => new ApplyCommentBuilder(),
        add: (builder, path, content, info) => builder.addResult(path, content, info.outcome),
        build: (builder) => {
          const body = builder.build();
          return body ? [body] : [];
        }
      }
    }
  };

  const behavior = behaviors[config.mode];
  if (!behavior) {
    if (core) core.setFailed(`Unsupported mode: ${config.mode}`);
    return;
  }

  // Use the builder factory to get an instance
  const builder = behavior.builder.factory();
  // Retrieve content headers from the instance's constructor
  const COMMENT_HEADER = builder.constructor.COMMENT_HEADER;
  const CONTINUED_HEADER = builder.constructor.CONTINUED_HEADER || null;

  // 1. Cleanup previous comments (Controlled by flag)
  if (config.deletePreviousComments) {
    try {
      const { data: comments } = await github.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
      });

      const botComments = comments.filter(comment => 
        comment.user.type === 'Bot' && 
        (comment.body.includes(COMMENT_HEADER) || (CONTINUED_HEADER && comment.body.includes(CONTINUED_HEADER)))
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
  }

  // 2. Collect result artifacts
  const globber = await glob.create(behavior.artifactPattern);
  const infoFiles = await globber.glob();
  if (infoFiles.length === 0) {
    if (core) core.info(`No ${config.mode} results found to post.`);
    return;
  }

  // 3. Add results to Builder
  for (const infoFile of infoFiles) {
    try {
      const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      const dir = path.dirname(infoFile);
      const logPath = path.join(dir, behavior.logFile);
      
      const content = fs.existsSync(logPath) 
        ? fs.readFileSync(logPath, 'utf8') 
        : '(Log file not found)';
      
      // Use the builder definition add method
      behavior.builder.add(builder, info.path, content, info);

    } catch (error) {
      if (core) core.error(`Error processing ${infoFile}: ${error.message}`);
    }
  }

  // 4. Generate comments and post
  const commentsToPost = behavior.builder.build(builder);

  try {
    for (const body of commentsToPost) {
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
