import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioControl,
  AudioDirective,
  AudioState,
  ChatMessage,
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

export interface IncomingInvite {
  inviteId: string;
  fromName: string;
}
export interface NamePrompt {
  inviteId: string;
  inviteeName: string;
}

export interface SessionState {
  ready: boolean;
  error: string | null;
  phase: SessionPhase;
  started: boolean;
  joinCode: string;
  self: ParticipantView | null;
  participants: ParticipantView[];
  teams: TeamView[];
  currentQuestion: PublicQuestion | null;
  lockedAnswer: LockedAnswer | null;
  lastResult: QuestionResult | null;
  leaderboard: Leaderboard;
  audioControl: AudioControl | null;
  // chat
  chat: ChatMessage[];
  sendChat: (text: string) => Promise<void>;
  // hints (questionId -> revealed hint text)
  revealedHints: Record<string, string>;
  revealHint: (questionId: string) => Promise<void>;
  // media readiness (host sees how many devices are ready to play the current media)
  mediaReady: { questionId: string; ready: number; total: number } | null;
  markReady: (questionId: string) => void;
  // membership
  incomingInvite: IncomingInvite | null;
  namePrompt: NamePrompt | null;
  toast: string | null;
  clearToast: () => void;
  invite: (toParticipantId: string) => Promise<void>;
  respondInvite: (inviteId: string, accept: boolean) => Promise<void>;
  nameTeam: (inviteId: string, name: string) => Promise<void>;
  leaveTeam: () => Promise<void>;
  leaveQuiz: () => Promise<void>;
  // ended
  endedLeaderboard: Leaderboard | null;
  // core actions
  lockAnswer: (questionId: string, optionId: string) => Promise<void>;
  setAudioState: (state: AudioState) => Promise<void>;
  host: {
    start: () => Promise<void>;
    pushQuestion: (questionId: string) => Promise<void>;
    lockQuestion: (questionId: string) => Promise<void>;
    reveal: (questionId: string) => Promise<void>;
    next: () => Promise<void>;
    end: () => Promise<void>;
    adjustScore: (subjectKey: string, delta: number, reason?: string) => Promise<void>;
    undoAdjustment: (adjustmentId: string) => Promise<void>;
    audioControl: (questionId: string, mediaId: string, action: 'play' | 'pause', positionSec: number) => Promise<void>;
  };
}

const EMPTY_LB: Leaderboard = { entries: [], updatedAt: new Date().toISOString() };

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
  const [started, setStarted] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [self, setSelf] = useState<ParticipantView | null>(null);
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [teams, setTeams] = useState<TeamView[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<PublicQuestion | null>(null);
  const [lockedAnswer, setLockedAnswer] = useState<LockedAnswer | null>(null);
  const [lastResult, setLastResult] = useState<QuestionResult | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard>(EMPTY_LB);
  const [audioControl, setAudioControl] = useState<AudioControl | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [revealedHints, setRevealedHints] = useState<Record<string, string>>({});
  const [mediaReady, setMediaReady] = useState<{ questionId: string; ready: number; total: number } | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<IncomingInvite | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [endedLeaderboard, setEndedLeaderboard] = useState<Leaderboard | null>(null);

  const directiveCb = useRef(onAudioDirective);
  directiveCb.current = onAudioDirective;
  // The question this device has marked itself ready for. Persists across a transient
  // socket reconnect (so we re-ack) but NOT across a full page reload (fresh mount = null,
  // so a reloaded device is correctly "not ready" until it taps "Get ready" again).
  const readyForRef = useRef<string | null>(null);

  useEffect(() => {
    // Don't connect until we have an identity (host's participantId resolves async).
    if (!sessionId || !participantId || !token) return;
    const socket = connectSocket();
    socketRef.current = socket;

    socket.on('connect', async () => {
      try {
        const s = await emitAck<SessionSnapshot>(socket, 'session:join', { sessionId, participantId, token });
        setError(null);
        setPhase(s.phase);
        setStarted(s.started);
        setJoinCode(s.joinCode);
        setSelf(s.self);
        setParticipants(s.participants);
        setTeams(s.teams);
        setCurrentQuestion(s.currentQuestion);
        setLockedAnswer(s.yourLockedAnswer);
        setLeaderboard(s.leaderboard);
        setChat(s.recentChat);
        setReady(true);
        // Re-ack readiness after a transient reconnect (server drops readiness on the
        // disconnect). Only fires if this same page had already marked ready for the
        // still-current question — a full reload starts with readyForRef=null.
        if (readyForRef.current && readyForRef.current === s.currentQuestion?.id) {
          socket.emit('media:ready', { questionId: readyForRef.current }, () => {});
        } else {
          readyForRef.current = null;
        }
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
      setMediaReady(null);
      readyForRef.current = null; // new question → this device must tap "Get ready" again
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
      setSelf((prev) => (prev ? participants.find((p) => p.id === prev.id) ?? prev : prev));
    });
    socket.on('audio:directive', (d) => directiveCb.current?.(d));
    socket.on('audio:control', (c) => setAudioControl(c));
    socket.on('media:ready-count', (p) => setMediaReady(p));
    socket.on('chat:message', (m) => setChat((prev) => [...prev.slice(-99), m]));
    socket.on('hint:revealed', ({ questionId, hint }) =>
      setRevealedHints((prev) => ({ ...prev, [questionId]: hint }))
    );
    socket.on('team:invite-received', ({ inviteId, fromName }) => setIncomingInvite({ inviteId, fromName }));
    socket.on('team:name-needed', ({ inviteId, inviteeName }) => setNamePrompt({ inviteId, inviteeName }));
    socket.on('team:invite-result', ({ message }) => setToast(message));
    socket.on('session:ended', ({ leaderboard }) => {
      setEndedLeaderboard(leaderboard);
      setPhase('ended');
    });
    socket.on('error', ({ message }) => message && setError(message));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, participantId, token]);

  const call = <T = null,>(event: string, payload: unknown) =>
    emitAck<T>(socketRef.current!, event as never, payload);

  const lockAnswer = useCallback(async (questionId: string, optionId: string) => {
    const a = await emitAck<LockedAnswer>(socketRef.current!, 'answer:lock', { questionId, optionId });
    setLockedAnswer(a);
  }, []);
  const setAudioState = useCallback(async (state: AudioState) => {
    await call('audio:set-state', { state });
  }, []);
  const sendChat = useCallback(async (text: string) => {
    await call('chat:send', { text });
  }, []);
  const revealHint = useCallback(async (questionId: string) => {
    const { hint } = await emitAck<{ hint: string }>(socketRef.current!, 'hint:reveal', { questionId });
    setRevealedHints((prev) => ({ ...prev, [questionId]: hint }));
  }, []);
  const markReady = useCallback((questionId: string) => {
    readyForRef.current = questionId; // remember, so we can re-ack after a transient reconnect
    socketRef.current?.emit('media:ready', { questionId }, () => {});
  }, []);
  const invite = useCallback(async (toParticipantId: string) => {
    await call('team:invite', { toParticipantId });
    setToast('Invite sent.');
  }, []);
  const respondInvite = useCallback(async (inviteId: string, accept: boolean) => {
    await call('team:invite-respond', { inviteId, accept });
    setIncomingInvite(null);
  }, []);
  const nameTeam = useCallback(async (inviteId: string, name: string) => {
    await call('team:name-new', { inviteId, name });
    setNamePrompt(null);
  }, []);
  const leaveTeam = useCallback(async () => {
    await call('team:leave', {});
  }, []);
  const leaveQuiz = useCallback(async () => {
    await call('quiz:leave', {});
  }, []);
  const clearToast = useCallback(() => setToast(null), []);

  const host = {
    start: useCallback(async () => { await call('host:start', {}); }, []),
    pushQuestion: useCallback(async (questionId: string) => { await call('host:push-question', { questionId }); }, []),
    lockQuestion: useCallback(async (questionId: string) => { await call('host:lock-question', { questionId }); }, []),
    reveal: useCallback(async (questionId: string) => { await call('host:reveal', { questionId }); }, []),
    next: useCallback(async () => { await call('host:next', {}); }, []),
    end: useCallback(async () => { await call('host:end', {}); }, []),
    adjustScore: useCallback(async (subjectKey: string, delta: number, reason?: string) => {
      await call('host:adjust-score', { subjectKey, delta, reason });
    }, []),
    undoAdjustment: useCallback(async (adjustmentId: string) => {
      await call('host:undo-adjustment', { adjustmentId });
    }, []),
    audioControl: useCallback(async (questionId: string, mediaId: string, action: 'play' | 'pause', positionSec: number) => {
      await call('host:audio-control', { questionId, mediaId, action, positionSec });
    }, []),
  };

  return {
    ready, error, phase, started, joinCode, self, participants, teams, currentQuestion,
    lockedAnswer, lastResult, leaderboard, audioControl,
    chat, sendChat, revealedHints, revealHint, mediaReady, markReady,
    incomingInvite, namePrompt, toast, clearToast, invite, respondInvite, nameTeam, leaveTeam, leaveQuiz,
    endedLeaderboard, lockAnswer, setAudioState, host,
  };
}
