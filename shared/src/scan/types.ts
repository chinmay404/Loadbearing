// What a scanned repository turns into.
//
// The scanner's whole job is to replace guesswork with citable fact, so every
// shape here carries its evidence: the file and line it came from, and a short
// snippet of what was actually there. A finding nobody can check is just a
// confident opinion, and the app already has a model for those.
//
// `confidence` is the other half of that contract. 'observed' means the file
// says so — a Next.js route directory, an import, a declared dependency.
// 'inferred' means the scanner joined two dots and could be wrong. The grader is
// told which is which, and the UI shows the difference, because a scan that
// presents its guesses in the same voice as its facts teaches people to distrust
// all of it.

import type { ArchNodeType, Flow, FlowKind } from '../types.js';

export interface Evidence {
  /** Repo-relative, forward slashes, no leading './'. */
  file: string;
  /** 1-indexed. 0 when the finding is about the file as a whole. */
  line: number;
  /** At most a few lines of what was there. Never a whole file. */
  snippet: string;
}

export type ScanConfidence = 'observed' | 'inferred';

/**
 * One thing the repository contains, already speaking the canvas's language.
 *
 * `nodeType` is the point: the scanner does not emit its own vocabulary that
 * something else has to translate. It emits catalogue types, so an inventory row
 * becomes a component on the sheet by copying three fields.
 */
export interface Detected {
  id: string;
  nodeType: ArchNodeType;
  /** What to call it on the canvas, e.g. 'Supabase Postgres'. */
  label: string;
  /**
   * The annotation the component arrives with. Mechanism, not category — the
   * grader scores a box labelled "Cache" with no strategy at nothing, and a
   * component dragged out of the inventory should not start life failing that.
   */
  mechanism: string;
  confidence: ScanConfidence;
  evidence: Evidence[];
}

export type DeployableKind =
  | 'next_app'
  | 'node_service'
  | 'python_service'
  | 'static_site'
  | 'worker'
  | 'container'
  | 'unknown';

/** One thing that gets deployed somewhere. The unit the monolith question is about. */
export interface Deployable {
  id: string;
  name: string;
  kind: DeployableKind;
  runtime: 'node' | 'python' | 'other' | 'unknown';
  /** Directory it lives in, '' for the repo root. */
  root: string;
  evidence: Evidence[];
}

export type AuthGuard = 'found' | 'none' | 'unknown';

/** An HTTP surface the app answers on. */
export interface ScanEndpoint {
  id: string;
  /** Upper-case verb, or 'ANY' when the framework does not say. */
  method: string;
  path: string;
  /** Deployable id this belongs to. */
  deployable: string;
  framework: string;
  authGuard: AuthGuard;
  /** Ids of Detected things this handler reaches. Always inferred. */
  touches: string[];
  confidence: ScanConfidence;
  evidence: Evidence;
}

export type ExposureSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Something that stands between this repo and being safely reachable from the
 * internet.
 *
 * `source` names who found it. Loadbearing's own rules are deterministic and
 * cheap; Semgrep and CodeQL findings arrive as SARIF that somebody else's tool
 * produced on the user's own machine. They are normalised into one list because
 * the person reading it does not care which program noticed.
 */
export interface Exposure {
  id: string;
  /** Stable machine id, e.g. 'secret-reaches-client'. */
  rule: string;
  severity: ExposureSeverity;
  title: string;
  detail: string;
  fix: string;
  source: 'loadbearing' | 'semgrep' | 'codeql' | string;
  confidence: ScanConfidence;
  evidence: Evidence[];
  /**
   * The import chain that proves reachability, when the rule is a reachability
   * rule. This is what turns "your key might be exposed" into something the user
   * cannot argue with, so a reachability rule that cannot produce one is
   * downgraded to a question rather than shipped as a finding.
   */
  path?: string[];
}

/** An environment variable the code reads, and what the scanner knows about it. */
export interface EnvVar {
  name: string;
  /** From a redacted .env line, e.g. 'jwt'. Absent when only a read was seen. */
  shape?: string;
  /** Files that read it. */
  readIn: string[];
  /** True when at least one reader is reachable from the browser bundle. */
  clientReachable: boolean;
  /** Name looks like it holds a credential. */
  secretish: boolean;
}

export type SystemShape = 'monolith' | 'services' | 'static+functions' | 'unknown';

/**
 * What the scan could and could not see.
 *
 * Reported rather than assumed. A partial scan reads exactly like a complete one
 * unless it says otherwise, which is how a missing finding becomes a wrong answer.
 */
export interface ScanCoverage {
  /** Files in the repo before filtering, as reported by the sender. */
  filesSeen: number;
  /** Files the scanner actually read. */
  filesRead: number;
  partial: boolean;
  truncated: string[];
  skipped: string[];
  dropped: string[];
  languages: string[];
  /** External analyzers whose SARIF was folded in. */
  analyzers: string[];
  /** Plain-language remarks for the user, e.g. 'no HTTP surface found'. */
  notes: string[];
}

export interface RepoScan {
  version: 1;
  projectName: string;
  /** ISO 8601, stamped by the server on receipt. */
  scannedAt: string;
  shape: {
    verdict: SystemShape;
    /** One sentence a human can read. */
    why: string;
    evidence: Evidence[];
  };
  deployables: Deployable[];
  endpoints: ScanEndpoint[];
  datastores: Detected[];
  externals: Detected[];
  ai: Detected[];
  exposures: Exposure[];
  env: EnvVar[];
  coverage: ScanCoverage;
}

// ----------------------------------------------------------------- bindings ---

/**
 * "This drawn component IS that piece of code."
 *
 * The primitive the whole feature turns on. Once a node is bound, three things
 * that were impossible become arithmetic: the simulator can use a measured
 * service time instead of a catalogue default, the checks can compare the
 * drawing against what the code actually does, and the grader can be handed the
 * correspondence as a fact rather than an assumption.
 */
export interface Binding {
  /**
   * What in the code. An endpoint id, a Detected id, or an observed trace
   * component name — all of which are stable strings the scan already emitted.
   */
  codeRef: string;
  /** Node id on the canvas. */
  nodeId: string;
  source: 'static' | 'trace';
}

// ------------------------------------------------------------------- traces ---

/**
 * One span as an OpenTelemetry exporter emits it, reduced to the fields that
 * matter here.
 *
 * Deliberately not the full OTLP shape: accepting a narrow subset means a console
 * exporter, a file exporter and an OTLP JSON body can all be normalised into the
 * same thing, and the parser has one job rather than three.
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** SERVER, CLIENT, INTERNAL, PRODUCER, CONSUMER. */
  kind?: string;
  durationMs: number;
  attributes?: Record<string, string | number | boolean>;
}

/** A component the trace saw, with what it actually cost. */
export interface ObservedComponent {
  /** Stable ref used in bindings, e.g. 'http:api.anthropic.com' or 'db:postgres'. */
  ref: string;
  label: string;
  nodeType: ArchNodeType;
  /** Times this appeared across all traces. */
  calls: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/** A request path the trace actually walked, with real numbers. */
export interface ObservedFlow {
  id: string;
  name: string;
  kind: FlowKind;
  /** Refs in call order. First is the entry endpoint. */
  steps: string[];
  /** How many traces walked this exact path. */
  samples: number;
  p50Ms: number;
  p95Ms: number;
}

export interface TraceSummary {
  traces: number;
  spans: number;
  components: ObservedComponent[];
  flows: ObservedFlow[];
  /** Plain-language remarks, e.g. 'every trace was a single span'. */
  notes: string[];
}

/** A flow suggestion the user has not accepted yet. Never auto-declared. */
export interface CandidateFlow extends Omit<Flow, 'id'> {
  id: string;
  /** Where the suggestion came from, so the UI can say. */
  origin: 'static' | 'trace';
  /** Refs, parallel to `steps`, before they are mapped onto node ids. */
  refs: string[];
}
