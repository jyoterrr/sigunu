import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioDirective,
  AudioState,
  Leaderboard,
  LockedAnswer,
  ParticipantView,
  PublicQuestion,
  QuestionResult,
  SessionPhase,
  SessionSnapshot,
  TeamView,
} from '@sigunu/shared';
import { connectSocket, emitAck, type SigunuSocket } from '../lib/socket';

export interface SessionState {
  ready: boolean;
  error: string | null;
  phase: SessionPhase;
  self: ParticipantView | null;
  participants: ParticipantView[];
  teams: TeamView[];
  currentQuestion: PublicQuestion | null;
  lockedAnswer: LockedAnswer | null;
  lastResult: QuestionResult | null;
  leaderboard: Leaderboard;
  // actions
  lockAnswer: (questionId: string, optionId: string) => Promise<void>;
  setAudioState: (state: AudioState) => Promise<void>;
  host: {
    pushQuestion: (questionId: string) => Promise<void>;
    lockQuestion: (questionId: string) => Promise<void>;
    reveal: (questionId: string) => Promise<void>;
    next: () => Promise<void>;
    end: () => Promise<void>;
  };
}

const EMPTY_LB: Leaderboard = { entries: [], updatedAt: new Date().toISOString() };

/**
 * Connects to the game-state socket and keeps a live view of the session. All
 * mutations go through the server (authoritative). `onAudioDirective` bridges to the
 * LiveKit layer so audio-state changes apply track permissions.
 */
export function useSession(params: {
  sessionId: string;
  participantId: string;
  token: string;
  onAudioDirective?: (d: AudioDirective) => void;
}): SessionState {
  const { sessionId, participantId, token, onAudioDirective } = params;
  const socketRef = useRef<SigunuSocket | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('lobby');
  const [self, setSelf] = useState<ParticipantView | null>(null);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<PublicQuestion | null>(null);
  const [lockedAnswer, setLockedAnswer] = useState<LockedAnswer | null>(null);
  const [lastResult, setLastResult] = useState<QuestionResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(EMPTY_LB);

  const directiveCb = useRef(onAudioDirective);
  directiveCb.current = onAudioDirective;

  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;

    const apply = (s: SessionSnapshot) => {
      setPhase(s.phase);
      setSelf(s.self);
      setParticipants(s.participants);
      setTeams(s.teams);
      setCurrentQuestion(s.currentQuestion);
      setLockedAnswer(s.yourLockedAnswer);
      setLeaderboard(s.leaderboard);
    };

    socket.on('connect', async () => {
      try {
        const snap = await emitAck<SessionSnapshot>(socket, 'session:join', {
          sessionId,
          participantId,
          token,
        });
        apply(snap);
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to join.');
      }
    });

    socket.on('session:phase', ({ phase }) => {
      setPhase(phase);
      if (phase === 'question_open') {
        setLockedAnswer(null);
        setLastResult(null);
      }
    });
    socket.on('question:pushed', (q) => {
      setCurrentQuestion(q);
      setLockedAnswer(null);
      setLastResult(null);
    });
    socket.on('question:locked-for-you', (a) => setLockedAnswer(a));
    socket.on('question:revealed', (r) => {
      setLastResult(r);
      setLeaderboard(r.leaderboard);
    });
    socket.on('leaderboard:update', (l) => setLeaderboard(l));
    socket.on('participants:update', ({ participants, teams }) => {
      setParticipants(participants);
      setTeams(teams);
    });
    socket.on('audio:directive', (d) => directiveCb.current?.(d));
    socket.on('error', ({ message }) => message && setError(message));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, participantId, token]);

  const lockAnswer = useCallback(async (questionId: string, optionId: string) => {
    if (!socketRef.current) return;
    const a = await emitAck<LockedAnswer>(socketRef.current, 'answer:lock', { questionId, optionId });
    setLockedAnswer(a);
  }, []);

  const setAudioState = useCallback(async (state: AudioState) => {
    if (!socketRef.current) return;
    await emitAck(socketRef.current, 'audio:set-state', { state });
  }, []);

  const host = {
    pushQuestion: useCallback(async (questionId: string) => {
      await emitAck(socketRef.current!, 'host:push-question', { questionId });
    }, []),
    lockQuestion: useCallback(async (questionId: string) => {
      await emitAck(socketRef.current!, 'host:lock-question', { questionId });
    }, []),
    reveal: useCallback(async (questionId: string) => {
      await emitAck(socketRef.current!, 'host:reveal', { questionId });
    }, []),
    next: useCallback(async () => {
      await emitAck(socketRef.current!, 'host:next', {});
    }, []),
    end: useCallback(async () => {
      await emitAck(socketRef.current!, 'host:end', {});
    }, []),
  };

  return {
    ready,
    error,
    phase,
    self,
    participants,
    teams,
    currentQuestion,
    lockedAnswer,
    lastResult,
    leaderboard,
    lockAnswer,
    setAudioState,
    host,
  };
}
