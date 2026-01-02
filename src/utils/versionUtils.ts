import { readFileSync } from 'fs';
import path from 'path';
import axios from 'axios';

interface VersionInfo {
  version: string;
  gitCommitHash: string;
  gitCommitDate: string;
  gitBranch: string;
  buildDate: string;
  isDirty: boolean;
}

let cachedVersionInfo: VersionInfo | null = null;

export async function getVersionInfo(): Promise<VersionInfo> {
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }

  try {
    // Get package.json version
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version || 'unknown';

    // Get git information from environment variables (set at build time) or files
    let gitCommitHash = process.env.GIT_COMMIT_HASH;
    let gitBranch = process.env.GIT_BRANCH;
    
    // If not in env vars, try reading from files (set during container build)
    if (!gitCommitHash || gitCommitHash === 'unknown') {
      try {
        gitCommitHash = readFileSync('/tmp/git_commit_hash', 'utf8').trim() || 'unknown';
      } catch {
        gitCommitHash = 'unknown';
      }
    }
    
    if (!gitBranch || gitBranch === 'unknown') {
      try {
        gitBranch = readFileSync('/tmp/git_branch', 'utf8').trim() || 'unknown';
      } catch {
        gitBranch = 'unknown';
      }
    }
    
    let gitCommitDate = 'unknown';
    let isDirty = false;

    // If we have a commit hash, try to get details from GitHub API
    if (gitCommitHash !== 'unknown') {
      try {
        const repoOwner = process.env.GITHUB_REPO_OWNER || 'Panmoni';
        const repoName = process.env.GITHUB_REPO_NAME || 'yapbay-api';
        const githubToken = process.env.GITHUB_TOKEN; // Optional, for rate limits

        const headers: Record<string, string> = {
          'Accept': 'application/vnd.github.v3+json',
        };
        if (githubToken) {
          headers['Authorization'] = `token ${githubToken}`;
        }

        // Query GitHub API for commit details
        const response = await axios.get(
          `https://api.github.com/repos/${repoOwner}/${repoName}/commits/${gitCommitHash}`,
          { headers, timeout: 5000 }
        );

        if (response.data) {
          gitCommitDate = response.data.commit.committer.date;
          // If branch wasn't set, we can't determine it from a single commit
          // but we can use the commit message or other info if needed
        }
      } catch (apiError) {
        // GitHub API call failed, use fallback values
        console.warn('Could not retrieve git information from GitHub API:', (apiError as Error).message);
      }
    }

    cachedVersionInfo = {
      version,
      gitCommitHash,
      gitCommitDate,
      gitBranch,
      buildDate: new Date().toISOString(),
      isDirty
    };

    return cachedVersionInfo;

  } catch (error) {
    console.error('Error getting version info:', error);
    
    // Return fallback version info
    return {
      version: 'unknown',
      gitCommitHash: 'unknown',
      gitCommitDate: 'unknown',
      gitBranch: 'unknown',
      buildDate: new Date().toISOString(),
      isDirty: false
    };
  }
}

export async function getVersionString(): Promise<string> {
  const info = await getVersionInfo();
  const dirtyIndicator = info.isDirty ? '-dirty' : '';
  return `${info.version}+${info.gitCommitHash}${dirtyIndicator}`;
}