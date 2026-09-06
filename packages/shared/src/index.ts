/**
 * Shared domain types and the real-time (Socket.IO) event contract for Sigunu.
 * Imported by both @sigunu/web and @sigunu/server so the wire protocol stays in sync.
 */

// ---------------------------------------------------------------------------
// Roles & audio/video state
// ---------------------------------------------------------------------------

export type Role = 'quizmaster' | 'player';

/**
 * Audio has three MUTUALLY EXCLUSIVE states (Section 5).
 * - team_only: audible only to the player's own teammates. NEVER to the quiz master
 *   or any other team. Enforced server-side via LiveKit track subscription permissions.
 * - open: audible to everyone in the session.
 * - mute: not broadcasting audio.
 *
 * Solo players may use only `open` | `mute` (no team => no team_only).
 * The quiz master may use only `open` | `mute`.
 */
export type AudioState = 'team_only' | 'open' | 'mute';

/** Video has only two states (Section 5). There is NO team-only video. */
export type VideoState = 'on' | 'off';

export function allowedAudioStates(role: Role, hasTeam: boolean): AudioState[] {
  if (role === 'quizmaster') return ['open', 'mute'];
  return hasTeam ? ['team_only', 'open', 'mute'] : ['open', 'mute'];
}

// ---------------------------------------------------------------------------
// Session / participants / teams
// ---------------------------------------------------------------------------

export type SessionPhase = 'lobby' | 'question_open' | 'question_locked' | 'revealed' | 'ended';

export interface ParticipantView {
  id: string;
  displayName: string;
  role: Role;
  /** null => solo player (or the quiz master). */
  teamId: string | null;
  connected: boolean;
}

export interface TeamView {
  id: string;
  name: string;
  memberIds: string[];
}

// ---------------------------------------------------------------------------
// Quiz content (the AI extracts EXISTING content; it never invents any)
// ---------------------------------------------------------------------------

export interface QuizOption {
  id: string;
  /** Verbatim text as found in the source document. */
  text: string;
}

export type MediaKind = 'image' | 'video' | 'audio';

/**
 * Layout transform for a collage IMAGE, normalized to a fixed-aspect stage so the
 * arrangement renders identically on every player's screen (Addendum §1).
 * Positions/sizes are percentages of the stage; rotation is any angle in degrees.
 */
export interface MediaTransform {
  xPct: number; // 0–100, top-left x within the stage
  yPct: number; // 0–100, top-left y within the stage
  widthPct: number; // 0–100, width as % of stage width (height follows natural ratio)
  rotationDeg: number; // free rotation, any angle
  z: number; // stacking order within the collage
}

/**
 * Media attached to a question. Manual questions can carry multiple images and/or
 * audio clips and at most one video (Addendum §1). `url` is served by the API's
 * static uploads route; `posterUrl` is an optional still frame for a video.
 * `transform` is present for collage images; video/audio use simple fixed placement.
 */
export interface QuestionMedia {
  id: string;
  kind: MediaKind;
  url: string;
  posterUrl?: string;
  caption?: string;
  transform?: MediaTransform;
}

/** At most one video per question (Addendum §1). */
export function validateQuestionMedia(media: QuestionMedia[]): string | null {
  if (media.filter((m) => m.kind === 'video').length > 1) {
    return 'A question can have at most one video.';
  }
  return null;
}

export interface QuizQuestion {
  id: string;
  order: number;
  text: string;
  /** Ordered media shown with the question. Empty for text-only questions. */
  media: QuestionMedia[];
  options: QuizOption[];
  /**
   * Option id of the correct answer, or null when it was not discoverable in the
   * document. The AI must leave this null rather than guess (Section 8).
   */
  correctOptionId: string | null;
  /** Per-question scoring override; falls back to the quiz defaults when null. */
  scoring: ScoringConfig | null;
  /** Seconds allowed to answer; null => host reveals manually with no timer. */
  timeLimitSec: number | null;
}

// ---------------------------------------------------------------------------
// Scoring (Section 9)
// ---------------------------------------------------------------------------

export interface ScoringConfig {
  /** Points for a correct answer. MUST be > 0 (validated in UI and server-side). */
  correctPoints: number;
  /**
   * Points DEDUCTED for a wrong answer. >= 0. Stored as a magnitude: 5 means -5.
   * Never negative (a wrong answer must never be rewarded).
   */
  wrongPenalty: number;
}

/** How an unanswered question scores when time runs out (quiz-master configurable). */
export type UnansweredPolicy = 'zero' | 'penalty';

export interface QuizConfig {
  defaultScoring: ScoringConfig;
  unansweredPolicy: UnansweredPolicy;
}

export function validateScoringConfig(c: ScoringConfig): string | null {
  if (!Number.isFinite(c.correctPoints) || c.correctPoints <= 0) {
    return 'Correct-answer points must be a positive, non-zero number.';
  }
  if (!Number.isFinite(c.wrongPenalty) || c.wrongPenalty < 0) {
    return 'Wrong-answer penalty must be zero or a positive number (it is subtracted).';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Answers & leaderboard
// ---------------------------------------------------------------------------

export interface LockedAnswer {
  questionId: string;
  optionId: string;
  /** id of the participant who actually locked it (for a team, the first submitter). */
  lockedByParticipantId: string;
  /** null for solo answers; set for team answers. */
  teamId: string | null;
  lockedAt: string; // ISO
}

export interface LeaderboardEntry {
  /** Stable key: `team:<id>` or `solo:<participantId>`. */
  key: string;
  kind: 'team' | 'solo';
  name: string;
  score: number;
  rank: number;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  updatedAt: string; // ISO
}

/**
 * A manual score override applied by the quiz master (Addendum §2), independent of
 * automatic correct/incorrect scoring. `delta` may be any integer (positive or
 * negative — the "award positive / penalty non-negative" rule applies ONLY to
 * automatic scoring). `subjectKey` matches a leaderboard key: `team:<id>`/`solo:<id>`.
 * Reversed entries stay in the log (active=false) for the host-only audit trail.
 */
export interface ScoreAdjustment {
  id: string;
  subjectKey: string;
  subjectName: string;
  delta: number;
  reason: string | null;
  active: boolean;
  createdAt: string; // ISO
}

// ---------------------------------------------------------------------------
// Socket.IO event contract (server is authoritative)
// ---------------------------------------------------------------------------

/** Client -> Server events. */
export interface ClientToServerEvents {
  /** Join the game-state room after obtaining a session + participant identity via REST. */
  'session:join': (
    p: { sessionId: string; participantId: string; token: string },
    ack: (res: Ack<SessionSnapshot>) => void
  ) => void;

  /** Player locks an answer. Server enforces first-write-wins for the whole team. */
  'answer:lock': (
    p: { questionId: string; optionId: string },
    ack: (res: Ack<LockedAnswer>) => void
  ) => void;

  /** Player switches audio state; server re-applies LiveKit track permissions. */
  'audio:set-state': (
    p: { state: AudioState },
    ack: (res: Ack<{ state: AudioState }>) => void
  ) => void;

  // --- Quiz-master only (server verifies host token) ---
  'host:push-question': (p: { questionId: string }, ack: (res: Ack<QuizQuestion>) => void) => void;
  'host:lock-question': (p: { questionId: string }, ack: (res: Ack<null>) => void) => void;
  'host:reveal': (p: { questionId: string }, ack: (res: Ack<QuestionResult>) => void) => void;
  'host:next': (p: Record<string, never>, ack: (res: Ack<null>) => void) => void;
  'host:end': (p: Record<string, never>, ack: (res: Ack<null>) => void) => void;

  /** Manual score override (Addendum §2). Returns the created adjustment + fresh board. */
  'host:adjust-score': (
    p: { subjectKey: string; delta: number; reason?: string },
    ack: (res: Ack<{ adjustment: ScoreAdjustment; leaderboard: Leaderboard }>) => void
  ) => void;
  /** Undo a prior adjustment (marks it inactive; leaderboard recomputed). */
  'host:undo-adjustment': (
    p: { adjustmentId: string },
    ack: (res: Ack<{ leaderboard: Leaderboard }>) => void
  ) => void;

  /** Quiz-master-synchronized audio playback for a question's audio clip (Addendum §1). */
  'host:audio-control': (
    p: { questionId: string; mediaId: string; action: 'play' | 'pause'; positionSec: number },
    ack: (res: Ack<null>) => void
  ) => void;
}

/** Broadcast so every client plays/pauses the same question audio in sync. */
export interface AudioControl {
  questionId: string;
  mediaId: string;
  action: 'play' | 'pause';
  positionSec: number;
  atServerTime: number; // Date.now() on the server when issued, for drift correction
}

/**
 * Authoritative LiveKit audio subscription directive computed by the server when a
 * participant changes audio state. The client APPLIES this via
 * localParticipant.setTrackSubscriptionPermissions — it never decides the allow-list
 * itself. Team-only never lists the quiz master, so the SFU refuses to forward it.
 */
export interface AudioDirective {
  state: AudioState;
  allowAll: boolean;
  allowedIdentities: string[];
  publishing: boolean;
}

/** Server -> Client events (broadcast to the session room; fan-out to up to 100). */
export interface ServerToClientEvents {
  'session:phase': (p: { phase: SessionPhase }) => void;
  'question:pushed': (q: PublicQuestion) => void;
  'question:locked-for-you': (p: LockedAnswer) => void;
  'question:revealed': (r: QuestionResult) => void;
  'leaderboard:update': (l: Leaderboard) => void;
  'participants:update': (p: { participants: ParticipantView[]; teams: TeamView[] }) => void;
  'audio:directive': (d: AudioDirective) => void;
  'audio:control': (c: AudioControl) => void;
  'error': (p: { message: string }) => void;
}

/** Question as sent to players — correct answer is withheld until reveal. */
export type PublicQuestion = Omit<QuizQuestion, 'correctOptionId'>;

export interface QuestionResult {
  questionId: string;
  correctOptionId: string | null;
  /** Per-entry deltas applied for this question. */
  deltas: { key: string; delta: number }[];
  leaderboard: Leaderboard;
}

export interface SessionSnapshot {
  sessionId: string;
  phase: SessionPhase;
  self: ParticipantView;
  participants: ParticipantView[];
  teams: TeamView[];
  currentQuestion: PublicQuestion | null;
  yourLockedAnswer: LockedAnswer | null;
  leaderboard: Leaderboard;
  livekit: { url: string; token: string; roomName: string };
}

/** Standard ack envelope for request/response socket calls. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// REST DTOs
// ---------------------------------------------------------------------------

export interface CreateSessionResponse {
  sessionId: string;
  joinCode: string;
  /** Host control token — required to call any `host:*` action. Keep secret. */
  hostToken: string;
}

export interface JoinSessionRequest {
  joinCode: string;
  displayName: string;
  /** Create/join a team by name, or omit/empty to play solo. */
  teamName?: string;
}

export interface JoinSessionResponse {
  sessionId: string;
  participantId: string;
  /** Participant auth token for socket + LiveKit. */
  token: string;
  livekit: { url: string; token: string; roomName: string };
}
