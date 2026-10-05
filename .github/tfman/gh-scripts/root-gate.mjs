/** Check every exact root against the allowlist on the repository's default branch. */
export default async ({ github, context, core }, { roots, configPath }) => {
  try {
    if (!Array.isArray(roots) || roots.length === 0 || !roots.every(root => typeof root === 'string' && root.length > 0)) {
      throw new Error('roots must be a non-empty array of non-empty strings');
    }
    const defaultBranch = context.payload.repository?.default_branch;
    if (!defaultBranch) throw new Error('Missing default_branch');
    const { data: reference } = await github.rest.git.getRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `heads/${defaultBranch}`,
    });
    const sha = reference?.object?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid default-branch commit SHA');
    const { data } = await github.rest.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: configPath,
      ref: sha,
    });
    if (data?.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new Error('Config must be a base64-encoded file');
    }
    const config = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    if (!Array.isArray(config?.enabledRoots) || !config.enabledRoots.every(value => typeof value === 'string')) {
      throw new Error('enabledRoots must be an array of strings');
    }
    const rejected = roots.filter(root => !config.enabledRoots.includes(root));
    if (rejected.length) throw new Error(`Roots are not enabled: ${rejected.join(', ')}`);
  } catch (error) {
    core.setFailed(`Root allowlist gate rejected ${JSON.stringify(roots)}: ${error.message}`);
  }
};
