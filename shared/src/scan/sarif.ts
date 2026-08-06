// Findings from analyzers Loadbearing does not run.
//
// Semgrep and CodeQL both emit SARIF, and both are executed on the user's own
// machine under the user's own licence — Loadbearing ships no analyzer binary,
// redistributes no rule pack, and runs neither on its servers. What arrives here
// is a result array somebody else's tool produced, and the only job is to fold it
// into the same Exposure list the built-in rules produce, because the person
// reading it does not care which program noticed.
//
// The licence distinction is load-bearing, not pedantry. CodeQL's free terms cover
// open-source codebases and academic research, so running it over a private repo
// as part of a hosted product would need a commercial licence; Semgrep's engine is
// LGPL but its maintained rule packs are licensed against exactly this use. Both
// problems disappear when the tool runs where the code already is.

import type { Exposure, ExposureSeverity } from './types.js';
import { normalisePath } from './source.js';

/** One analyzer's contribution, as the collecting agent sends it. */
export interface SarifAttachment {
  tool: string;
  version?: string;
  /** SARIF `runs[].results`, not the whole document. */
  results: unknown[];
}

interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: {
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number; snippet?: { text?: string } };
    };
  }[];
  properties?: { 'security-severity'?: string | number; severity?: string };
}

/** Rule ids whose subject matter outranks whatever level the tool assigned. */
const CRITICAL_SUBJECTS =
  /(hardcoded|secret|credential|private-key|api-key|sql-injection|sqli|command-injection|rce|deserial|ssrf|path-traversal|xxe)/i;
const HIGH_SUBJECTS = /(xss|csrf|cors|auth|jwt|open-redirect|weak-crypto|md5|sha1|insecure-random|tls)/i;

/**
 * Turn SARIF results into exposures.
 *
 * Capped and sorted, because a `--config auto` run over a busy repository can
 * return thousands of results and a wall of lint noise buries the four findings
 * that would actually have got somebody hacked.
 */
export function exposuresFromSarif(attachments: SarifAttachment[], limit = 60): Exposure[] {
  const out: Exposure[] = [];
  let n = 0;

  for (const attachment of attachments ?? []) {
    const tool = String(attachment?.tool ?? 'analyzer').toLowerCase();
    const results = Array.isArray(attachment?.results) ? attachment.results : [];
    for (const raw of results) {
      const r = raw as SarifResult;
      const ruleId = String(r.ruleId ?? 'unknown');
      const message = r.message?.text?.trim();
      if (!message) continue;

      const loc = r.locations?.[0]?.physicalLocation;
      const file = normalisePath(loc?.artifactLocation?.uri ?? '');
      const line = Number(loc?.region?.startLine ?? 0) || 0;
      const snippet = (loc?.region?.snippet?.text ?? '').trim().slice(0, 300);

      out.push({
        id: `sarif-${(n += 1)}`,
        rule: ruleId,
        severity: severityOf(r, ruleId),
        title: titleOf(ruleId, message),
        detail: message,
        // The analyzer's own fix guidance is not in the result body often enough to
        // rely on, and inventing one would put words in its mouth.
        fix: `Open the rule (${ruleId}) in ${attachment.tool} for the recommended change.`,
        source: tool.includes('codeql') ? 'codeql' : tool.includes('semgrep') ? 'semgrep' : tool,
        // Somebody else's static analysis is a strong signal but still static
        // analysis: it does not know which paths are reachable in production.
        confidence: 'inferred',
        evidence: file ? [{ file, line, snippet: snippet || ruleId }] : [],
      });
    }
  }

  return dedupe(out).slice(0, limit);
}

function severityOf(r: SarifResult, ruleId: string): ExposureSeverity {
  const numeric = Number(r.properties?.['security-severity']);
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return 'critical';
    if (numeric >= 7) return 'high';
    if (numeric >= 4) return 'medium';
    return 'low';
  }
  if (CRITICAL_SUBJECTS.test(ruleId)) return 'critical';
  if (HIGH_SUBJECTS.test(ruleId)) return 'high';
  const level = String(r.level ?? r.properties?.severity ?? '').toLowerCase();
  if (level === 'error') return 'high';
  if (level === 'warning') return 'medium';
  return 'low';
}

/** `javascript.express.security.audit.xss` -> `Xss` is useless; the last two segments read better. */
function titleOf(ruleId: string, message: string): string {
  const short = (message.split(/[.\n]/)[0] ?? message).trim();
  if (short.length > 8 && short.length <= 110) return short;
  const segments = ruleId.split(/[./]/).filter(Boolean);
  const tail = segments.slice(-2).join(' ').replace(/[-_]/g, ' ');
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : ruleId;
}

/**
 * The same weakness found twice is one finding.
 *
 * Semgrep and CodeQL overlap heavily on the obvious things, and a list that shows
 * the same hardcoded key twice reads as a tool that cannot count.
 */
function dedupe(list: Exposure[]): Exposure[] {
  const seen = new Set<string>();
  const kept: Exposure[] = [];
  for (const e of list) {
    const loc = e.evidence[0];
    const key = `${loc?.file ?? ''}:${loc?.line ?? 0}:${e.severity}:${e.title.slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(e);
  }
  return kept;
}
