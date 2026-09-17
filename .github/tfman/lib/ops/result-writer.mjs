import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { appendGithubOutput, exists } from '../utils.mjs';

export function artifactSlug(path) {
  return `${path.replaceAll('/', '-')}-${createHash('sha256').update(path).digest('hex').slice(0, 8)}`;
}

export function renderSummary({ path, command, log }) {
  const bytes = Buffer.from(log.replaceAll('```', '~~~'));
  let end = Math.min(bytes.length, 900000);
  // Keep the byte cap without splitting a UTF-8 character.
  if (end < bytes.length) {
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  }
  const content = bytes.subarray(0, end).toString('utf8');
  const title = command === 'plan' ? 'Plan' : 'Apply';
  const fence = command === 'plan' ? 'hcl' : 'text';
  return `## 📄 Terraform ${title} — \`${path}\`\n\n\`\`\`${fence}\n${content}\n\`\`\`\n`;
}

export async function writeResult({ cwd, path, command, outcome, summaryFile, githubOutput }) {
  const cleanPath = artifactSlug(path);
  const artifactName = `${command}-${cleanPath}`;
  await fs.writeFile(join(cwd, 'info.json'), JSON.stringify({
    path,
    outcome: outcome === 'success' ? 'success' : 'failure',
  }) + '\n');

  const logPath = join(cwd, `${command}.txt`);
  if (await exists(logPath)) {
    const log = await fs.readFile(logPath, 'utf8');
    if (summaryFile) {
      await fs.appendFile(summaryFile, renderSummary({ path, command, log }));
    }
  }
  if (githubOutput) {
    await appendGithubOutput({ clean_path: cleanPath, artifact_name: artifactName }, githubOutput);
  }
  return { cleanPath, artifactName };
}
