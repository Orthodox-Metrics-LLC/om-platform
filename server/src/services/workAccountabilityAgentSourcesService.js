/**
 * Work Accountability Agent Sources — read-only scan of Cursor agent transcripts
 * and archived Claude conversation exports under /home/next on each OM platform host.
 */

const fs = require('fs');
const path = require('path');

const REPO_PATH_HINTS = [
  { prefix: '/var/www/orthodoxmetrics', repo_target: 'orthodoxmetrics' },
  { prefix: '/var/www/omai', repo_target: 'omai' },
  { prefix: '/var/omai-ops', repo_target: 'omai-ops' },
  { prefix: '/var/www/omstudio', repo_target: 'omstudio' },
  { prefix: '/var/www/om-workshop', repo_target: 'om-workshop' },
];

const PLATFORM_SOURCES = {
  orthodoxmetrics: {
    platform: 'orthodoxmetrics',
    label: 'OM',
    sources: [
      {
        type: 'cursor_transcripts',
        path: '/home/next/.cursor/projects/var-www/agent-transcripts',
        repo_target: 'orthodoxmetrics',
      },
      {
        type: 'cursor_transcripts',
        path: '/home/next/.cursor/projects/var-www-orthodoxmetrics-prod/agent-transcripts',
        repo_target: 'orthodoxmetrics',
      },
    ],
  },
  omai: {
    platform: 'omai',
    label: 'OMAI',
    sources: [
      {
        type: 'cursor_transcripts',
        path: '/home/next/.cursor/projects/var-www-omai/agent-transcripts',
        repo_target: 'omai',
      },
      {
        type: 'claude_md',
        path: '/home/next/claude-conversations/omserver/omai',
        repo_target: 'omai',
      },
    ],
  },
  omstudio: {
    platform: 'omstudio',
    label: 'OMStudio',
    sources: [
      {
        type: 'cursor_transcripts',
        path: '/home/next/.cursor/projects/var-www-omstudio/agent-transcripts',
        repo_target: 'omstudio',
      },
      {
        type: 'claude_md',
        path: '/home/next/claude-conversations/omstudio-server/omstudio',
        repo_target: 'omstudio',
      },
      {
        type: 'claude_md',
        path: '/home/next/claude-conversations/omstudio-server/orthodoxmetrics-prod',
        repo_target: 'orthodoxmetrics',
      },
    ],
  },
  'om-workshop': {
    platform: 'om-workshop',
    label: 'OM Workshop',
    sources: [
      {
        type: 'cursor_transcripts',
        path: '/home/next/.cursor/projects/var-www-om-workshop/agent-transcripts',
        repo_target: 'om-workshop',
      },
      {
        type: 'cursor_transcripts',
        path: '/home/next/.cursor/projects/var-www-omworkshop/agent-transcripts',
        repo_target: 'om-workshop',
      },
      {
        type: 'claude_md',
        path: '/home/next/claude-conversations/omstudio-server/orthodoxmetrics-staging',
        repo_target: 'orthodoxmetrics',
      },
    ],
  },
};

function envOverridePath(platform) {
  const key = `WORK_ACCOUNTABILITY_AGENT_${platform.toUpperCase()}_DIR`;
  const val = process.env[key];
  return val && val.trim() ? val.trim() : null;
}

function resolvePlatformSources() {
  const resolved = {};
  for (const [platform, cfg] of Object.entries(PLATFORM_SOURCES)) {
    const override = envOverridePath(platform);
    const sources = cfg.sources.map((s, idx) => {
      if (idx === 0 && override) return { ...s, path: override };
      return { ...s };
    });
    resolved[platform] = { ...cfg, sources };
  }
  return resolved;
}

function parseWindow(options = {}) {
  const since = options.since || options.sqlFrom
    ? new Date(options.since || options.sqlFrom)
    : new Date(Date.now() - (Number(options.hours) || 24) * 3600 * 1000);
  const until = options.until || options.sqlTo
    ? new Date(options.until || options.sqlTo)
    : new Date();
  return { since, until };
}

function inWindow(ts, since, until) {
  const t = new Date(ts).getTime();
  return t >= since.getTime() && t <= until.getTime();
}

function overlapsWindow(startAt, endAt, since, until) {
  const s = new Date(startAt).getTime();
  const e = new Date(endAt).getTime();
  return s <= until.getTime() && e >= since.getTime();
}

function extractUserQueryTitle(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/<user_query>\s*([\s\S]*?)(?:<\/user_query>|$)/i);
  const raw = (m ? m[1] : text).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  return raw.slice(0, 200);
}

function inferRepoFromText(text) {
  if (!text) return null;
  for (const hint of REPO_PATH_HINTS) {
    if (text.includes(hint.prefix)) return hint.repo_target;
  }
  return null;
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
}

function parseCursorJsonlSummary(filePath, { maxLines = 400 } = {}) {
  let promptCount = 0;
  let assistantCount = 0;
  let toolCallCount = 0;
  const tools = new Set();
  let title = null;
  let repoHint = null;
  let linesRead = 0;

  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const bufSize = 256 * 1024;
    const buf = Buffer.alloc(bufSize);
    let leftover = '';
    let done = false;

    while (!done && linesRead < maxLines) {
      const bytes = fs.readSync(fd, buf, 0, bufSize, null);
      if (bytes <= 0) break;
      const chunk = leftover + buf.toString('utf8', 0, bytes);
      const parts = chunk.split('\n');
      leftover = bytes === bufSize ? parts.pop() || '' : '';
      if (bytes < bufSize) done = true;

      for (const line of parts) {
        if (!line.trim()) continue;
        linesRead += 1;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (row.role === 'user') {
          promptCount += 1;
          if (!title) {
            const texts = (row.message?.content || [])
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text);
            title = extractUserQueryTitle(texts.join('\n'));
          }
        } else if (row.role === 'assistant') {
          assistantCount += 1;
          for (const part of row.message?.content || []) {
            if (part.type === 'tool_use' && part.name) {
              toolCallCount += 1;
              tools.add(part.name);
              if (!repoHint && part.input) {
                repoHint = inferRepoFromText(JSON.stringify(part.input));
              }
            }
          }
        }
        if (linesRead >= maxLines) break;
      }
    }
  } catch {
    // unreadable transcript
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }

  return {
    prompt_count: promptCount,
    assistant_count: assistantCount,
    tool_call_count: toolCallCount,
    tools: [...tools],
    title,
    repo_hint: repoHint,
    truncated: linesRead >= maxLines,
  };
}

function countToolUsesInFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    const matches = data.match(/"type":"tool_use"/g);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

function scanCursorTranscripts(source, platformCfg, since, until) {
  const sessions = [];
  const dir = source.path;
  if (!fs.existsSync(dir)) {
    return { sessions, available: false, path: dir, reason: 'path_missing' };
  }

  const entries = safeReadDir(dir);
  if (!entries) return { sessions, available: false, path: dir, reason: 'not_readable' };

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionId = entry.name;
    const mainFile = path.join(dir, sessionId, `${sessionId}.jsonl`);
    const mainStat = safeStat(mainFile);
    if (!mainStat) continue;

    const subDir = path.join(dir, sessionId, 'subagents');
    const subFiles = safeReadDir(subDir) || [];
    const transcriptFiles = [mainFile];
    for (const sub of subFiles) {
      if (sub.isFile() && sub.name.endsWith('.jsonl')) {
        transcriptFiles.push(path.join(subDir, sub.name));
      }
    }

    let startedAt = mainStat.birthtime || mainStat.mtime;
    let endedAt = mainStat.mtime;
    for (const tf of transcriptFiles) {
      const st = safeStat(tf);
      if (!st) continue;
      const start = st.birthtime || st.mtime;
      if (start < startedAt) startedAt = start;
      if (st.mtime > endedAt) endedAt = st.mtime;
    }

    if (!overlapsWindow(startedAt, endedAt, since, until)) continue;

    const summary = parseCursorJsonlSummary(mainFile);
    let toolCallCount = summary.tool_call_count;
    if (summary.truncated) {
      toolCallCount = countToolUsesInFile(mainFile);
      for (const tf of transcriptFiles.slice(1)) {
        toolCallCount += countToolUsesInFile(tf);
      }
    } else {
      for (const tf of transcriptFiles.slice(1)) {
        const sub = parseCursorJsonlSummary(tf, { maxLines: 80 });
        toolCallCount += sub.tool_call_count;
        for (const t of sub.tools) summary.tools.push(t);
      }
    }

    const repoTarget = summary.repo_hint || source.repo_target || platformCfg.platform;
    sessions.push({
      session_id: sessionId,
      platform: platformCfg.platform,
      platform_label: platformCfg.label,
      source_type: 'cursor_transcripts',
      source_path: mainFile,
      repo_target: repoTarget,
      title: summary.title || `Cursor agent session ${sessionId.slice(0, 8)}`,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      prompt_count: summary.prompt_count,
      assistant_count: summary.assistant_count,
      tool_call_count: toolCallCount,
      tools: [...new Set(summary.tools)].slice(0, 30),
      subagent_count: Math.max(0, transcriptFiles.length - 1),
      is_subagent: false,
    });
  }

  return { sessions, available: true, path: dir };
}

function parseClaudeMdFilename(name) {
  const m = name.match(/claude-conversation-(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  return `${m[1]}T12:00:00.000Z`;
}

function scanClaudeMarkdown(source, platformCfg, since, until) {
  const sessions = [];
  const dir = source.path;
  if (!fs.existsSync(dir)) {
    return { sessions, available: false, path: dir, reason: 'path_missing' };
  }

  const entries = safeReadDir(dir);
  if (!entries) return { sessions, available: false, path: dir, reason: 'not_readable' };

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = path.join(dir, entry.name);
    const st = safeStat(filePath);
    if (!st) continue;

    const fromName = parseClaudeMdFilename(entry.name);
    const startedAt = fromName ? new Date(fromName) : (st.birthtime || st.mtime);
    const endedAt = st.mtime;

    if (!overlapsWindow(startedAt, endedAt, since, until)) continue;

    let title = entry.name.replace(/^claude-conversation-/, '').replace(/\.md$/, '');
    try {
      const head = fs.readFileSync(filePath, 'utf8').slice(0, 2000);
      const h1 = head.match(/^#\s+(.+)$/m);
      if (h1) title = h1[1].trim().slice(0, 200);
      else {
        const firstLine = head.split('\n').find((l) => l.trim() && !l.startsWith('#'));
        if (firstLine) title = firstLine.trim().slice(0, 200);
      }
    } catch {
      // keep filename-based title
    }

    sessions.push({
      session_id: entry.name.replace(/\.md$/, ''),
      platform: platformCfg.platform,
      platform_label: platformCfg.label,
      source_type: 'claude_md',
      source_path: filePath,
      repo_target: source.repo_target || platformCfg.platform,
      title,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      prompt_count: null,
      assistant_count: null,
      tool_call_count: null,
      tools: [],
      subagent_count: 0,
      is_subagent: false,
    });
  }

  return { sessions, available: true, path: dir };
}

/**
 * Scan all configured agent source directories for activity in a time window.
 */
function scanAgentActivity(options = {}) {
  const { since, until } = parseWindow(options);
  const platforms = resolvePlatformSources();
  const allSessions = [];
  const sourceStatus = [];

  for (const cfg of Object.values(platforms)) {
    for (const source of cfg.sources) {
      let result;
      if (source.type === 'claude_md') {
        result = scanClaudeMarkdown(source, cfg, since, until);
      } else {
        result = scanCursorTranscripts(source, cfg, since, until);
      }
      sourceStatus.push({
        platform: cfg.platform,
        type: source.type,
        path: source.path,
        available: result.available,
        reason: result.reason || null,
        sessions_found: result.sessions.length,
      });
      allSessions.push(...result.sessions);
    }
  }

  allSessions.sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at));

  const byPlatform = {};
  for (const s of allSessions) {
    if (!byPlatform[s.platform]) byPlatform[s.platform] = [];
    byPlatform[s.platform].push(s);
  }

  return {
    scanned_at: new Date().toISOString(),
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
    },
    totals: {
      sessions: allSessions.length,
      platforms_with_activity: Object.keys(byPlatform).length,
      tool_calls: allSessions.reduce((n, s) => n + (s.tool_call_count || 0), 0),
    },
    source_status: sourceStatus,
    sessions: allSessions,
    by_platform: byPlatform,
  };
}

/**
 * Find agent sessions overlapping a work_session time range (for backfill enrichment).
 */
function agentSessionsForWorkSession(session, agentScan) {
  const sessions = agentScan?.sessions || [];
  const end = session.ended_at
    ? new Date(session.ended_at)
    : new Date(new Date(session.started_at).getTime() + (Number(session.duration_seconds) || 3600) * 1000);
  const start = new Date(session.started_at);

  return sessions.filter((s) => overlapsWindow(s.started_at, s.ended_at, start, end));
}

function pickBestAgentTitle(matches) {
  if (!matches.length) return null;
  const sorted = [...matches].sort((a, b) => {
    const score = (s) => (s.tool_call_count || 0) + (s.prompt_count || 0) * 2;
    return score(b) - score(a);
  });
  return sorted[0].title || null;
}

module.exports = {
  PLATFORM_SOURCES,
  REPO_PATH_HINTS,
  scanAgentActivity,
  agentSessionsForWorkSession,
  pickBestAgentTitle,
  extractUserQueryTitle,
  inferRepoFromText,
};
