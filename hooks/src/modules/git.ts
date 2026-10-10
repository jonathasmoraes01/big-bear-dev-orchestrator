import type { BigBearGit } from '../../../types'

/** Parses `git status --porcelain=v1 --branch`. */
export function parseStatus(stdout: string, at: number): BigBearGit {
  const git: BigBearGit = {
    at,
    isRepo: true,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
    lastCommit: null,
    merging: false,
  }
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      const noCommits = /^No commits yet on (\S+)/.exec(head)
      if (noCommits !== null) {
        git.branch = noCommits[1]!
        continue
      }
      if (head.startsWith('HEAD (no branch)')) continue
      const bracketAt = head.indexOf(' [')
      const refs = bracketAt === -1 ? head : head.slice(0, bracketAt)
      const counts = bracketAt === -1 ? '' : head.slice(bracketAt)
      const [branch, upstream] = refs.split('...')
      git.branch = branch ?? null
      git.upstream = upstream ?? null
      const ahead = /ahead (\d+)/.exec(counts)
      const behind = /behind (\d+)/.exec(counts)
      git.ahead = ahead ? Number(ahead[1]) : 0
      git.behind = behind ? Number(behind[1]) : 0
      continue
    }
    if (line.length < 3) continue
    const x = line[0]!
    const y = line[1]!
    if (x === '?' && y === '?') git.untracked++
    else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) git.conflicts++
    else {
      if (x !== ' ') git.staged++
      if (y !== ' ') git.modified++
    }
  }
  return git
}

export function notARepo(at: number): BigBearGit {
  return { ...parseStatus('', at), isRepo: false }
}

export function pendingChanges(git: BigBearGit): number {
  return git.staged + git.modified + git.untracked + git.conflicts
}
