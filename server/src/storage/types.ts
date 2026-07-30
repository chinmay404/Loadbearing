// The storage contract. Two implementations stand behind it: SQLite for local,
// zero-setup use, and Postgres (Supabase) for deployment — routes only ever see
// this interface, so neither dialect leaks upward. Everything is async because
// the Postgres side has no choice, and the SQLite side can afford to pretend.

export interface UserRow {
  id: string;
  username: string;
  passHash: string;
  createdAt: string;
}

export interface AttemptRow {
  id: number;
  problemId: string;
  round: number;
  graphJson: string;
  scoreJson: string;
  overall: number;
  twistText: string | null;
  createdAt: string;
}

export interface MasteryRow {
  concept: string;
  emaScore: number;
  attempts: number;
  lastSeen: string | null;
}

export interface ReviewQueueRow extends MasteryRow {
  /** Days since last_seen, fractional. */
  daysSince: number;
}

export interface StatsAgg {
  attempts: number;
  avgOverall: number | null;
}

export interface Storage {
  /** Which backend answered — surfaced on /api/health so deploys are checkable. */
  readonly kind: 'sqlite' | 'postgres';

  /** Creates tables when missing and prunes expired cache rows. Idempotent. */
  init(): Promise<void>;

  // ---- users ----
  createUser(username: string, passHash: string): Promise<UserRow>;
  getUserByUsername(username: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  countUsers(): Promise<number>;
  /**
   * Hands rows written before accounts existed to `userId`, returning how many
   * moved. Only the local SQLite file can have any; Postgres returns 0.
   */
  claimLegacyData(userId: string): Promise<number>;

  // ---- attempts (all scoped to a user) ----
  insertAttempt(
    userId: string,
    a: { problemId: string; round: number; graphJson: string; scoreJson: string; overall: number; twistText: string | null },
  ): Promise<number>;
  listAttempts(userId: string, problemId?: string, limit?: number): Promise<AttemptRow[]>;
  getAttempt(userId: string, id: number): Promise<AttemptRow | null>;
  /** Newest attempt's graph for a problem, for round-to-round diffing. */
  latestAttemptGraph(userId: string, problemId: string): Promise<string | null>;

  // ---- mastery ----
  /** ema = 0.7*old + 0.3*new (first sample: the sample), attempts += 1, last_seen = now. */
  upsertMastery(userId: string, concept: string, score: number): Promise<void>;
  listMastery(userId: string): Promise<MasteryRow[]>;
  reviewQueue(userId: string): Promise<ReviewQueueRow[]>;
  statsAgg(userId: string): Promise<StatsAgg>;
  /** Newest-first (date, overall) pairs, capped. */
  statsTrend(userId: string, limit: number): Promise<{ date: string; overall: number }[]>;
  /** Distinct YYYY-MM-DD days with attempts, newest first. */
  statsDays(userId: string): Promise<string[]>;

  // ---- custom problems ----
  insertCustomProblem(userId: string, id: string, json: string): Promise<void>;
  listCustomProblems(userId: string): Promise<string[]>;
  deleteCustomProblem(userId: string, id: string): Promise<void>;

  // ---- per-user settings (LLM provider config lives here) ----
  getSetting(userId: string, key: string): Promise<string | null>;
  setSetting(userId: string, key: string, value: string): Promise<void>;

  // ---- canvas designs ----
  getDesign(userId: string, problemId: string): Promise<{ graphJson: string; updatedAt: string } | null>;
  putDesign(userId: string, problemId: string, graphJson: string): Promise<void>;

  // ---- reference designs (shared across users — the reference is per problem) ----
  getReference(problemId: string): Promise<string | null>;
  putReference(problemId: string, graphJson: string): Promise<void>;

  // ---- LLM response cache (shared; keyed by prompt hash which includes the key's model) ----
  cacheGet(key: string): Promise<string | null>;
  cachePut(key: string, response: string): Promise<void>;
  cacheDelete(key: string): Promise<void>;
}
