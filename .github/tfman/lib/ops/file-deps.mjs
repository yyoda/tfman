import { readFile as defaultReadFile } from 'node:fs/promises';
import { join } from 'node:path';

function assertValidPattern(value, allowTrailingSlash) {
  if (allowTrailingSlash && typeof value === 'string' && value.endsWith('/') && value.includes('*')) {
    throw new Error(`Invalid file dependency pattern: ${JSON.stringify(value)}; a directory prefix must be literal; use a glob such as dir/**`);
  }
  const path = allowTrailingSlash && typeof value === 'string' && value.endsWith('/')
    ? value.slice(0, -1) : value;
  const segments = typeof path === 'string' ? path.split('/') : [];
  if (segments.length > 64) {
    throw new Error('Invalid file dependency pattern: at most 64 path segments are allowed');
  }
  if (segments.some(segment => segment.length > 255)) {
    throw new Error('Invalid file dependency pattern: each segment must be at most 255 characters');
  }
  if (typeof path !== 'string' || !segments.every(segment =>
    segment === '**' || (/^[A-Za-z0-9*][A-Za-z0-9._*-]*$/.test(segment) && !segment.includes('**'))
  )) {
    throw new Error(`Invalid file dependency pattern: ${JSON.stringify(value)}`);
  }
}

export function assertValidFilePath(path) {
  assertValidPattern(path, true);
}

export function assertValidSelector(selector) {
  assertValidPattern(selector, false);
}

/** Validate declarations and return only the canonical fields. */
export function parseDeclarations(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('File declarations must be an object');
  }
  if (!Array.isArray(data.files)) throw new Error('File declarations files must be an array');
  const seen = new Set();
  return data.files.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('File declaration entry must be an object');
    }
    if (typeof entry.path !== 'string') throw new Error('File declaration path must be a string');
    assertValidFilePath(entry.path);
    if (seen.has(entry.path)) throw new Error(`Duplicate file declaration path: ${entry.path}`);
    seen.add(entry.path);
    if (!Array.isArray(entry.usedIn) || entry.usedIn.length === 0 ||
        !entry.usedIn.every(selector => typeof selector === 'string')) {
      throw new Error(`File declaration usedIn must be a non-empty array of strings: ${entry.path}`);
    }
    entry.usedIn.forEach(assertValidSelector);
    return { path: entry.path, usedIn: [...entry.usedIn] };
  });
}

function matchSegment(pattern, segment) {
  let i = 0;
  let j = 0;
  let star = -1;
  let starEnd = 0;
  while (j < segment.length) {
    if (pattern[i] === '*') {
      star = i++;
      starEnd = j;
    } else if (pattern[i] === segment[j]) {
      i++;
      j++;
    } else if (star !== -1) {
      // Retry only the most recent star, consuming one more character.
      i = star + 1;
      j = ++starEnd;
    } else {
      return false;
    }
  }
  while (pattern[i] === '*') i++;
  return i === pattern.length;
}

function matchGlob(pattern, path) {
  const patterns = pattern.split('/').filter((segment, index, segments) =>
    segment !== '**' || segments[index - 1] !== '**');
  const segments = path.split('/');
  let previous = new Uint8Array(segments.length + 1);
  let current = new Uint8Array(segments.length + 1);
  previous[0] = 1;
  for (const part of patterns) {
    // Each cell records whether the pattern prefix matches this many segments.
    current[0] = part === '**' ? previous[0] : 0;
    if (part === '**') {
      for (let j = 1; j <= segments.length; j++) {
        current[j] = previous[j] || current[j - 1];
      }
    } else {
      for (let j = 1; j <= segments.length; j++) {
        current[j] = previous[j - 1] && matchSegment(part, segments[j - 1]);
      }
    }
    [previous, current] = [current, previous];
  }
  return previous[segments.length] === 1;
}

/** Match changed paths without consulting the filesystem, including deleted files. */
export function matchFile(pattern, changedPath) {
  if (pattern.endsWith('/')) return changedPath.startsWith(pattern);
  return pattern.includes('*') ? matchGlob(pattern, changedPath) : pattern === changedPath;
}

export function expandSelector(selector, rootPaths) {
  return rootPaths.filter(path => selector === '*' || matchFile(selector, path));
}

export async function loadDeclarations(workspaceRoot, readFile = defaultReadFile) {
  let content;
  try {
    content = await readFile(join(workspaceRoot, '.tfdepsextra.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return parseDeclarations(JSON.parse(content));
}
