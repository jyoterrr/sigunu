import type { AudioState, SessionSnapshot } from '@sigunu/shared';
import { allowedAudioStates } from '@sigunu/shared';
import { prisma } from '../db/client.js';
import { roomFor, teamRoomFor, type SigunuServer } from './io.js';
import { Orchestrator } from '../game/orchestrator.js';
import { lockAnswer, getLockedAnswer, LockError } from '../game/locking.js';
import { rosterOf } from '../game/sessions.js';
import { toQuizQuestion, toPublicQuestion } from '../game/questions.js';
import { computeLeaderboard } from '../leaderboard/leaderboard.js';
import { applyAdjustment, undoAdjustment } from '../game/adjustments.js';
import { computeAudioDirective } from '../livekit/permissions.js';
import { env } from '../env.js';

export function registerSocketHandlers(io: SigunuServer) {
  const orchestrator = new Orchestrator(io);

  io.on('connection', (socket) => {
    // -- Join the game-state room; authenticate by token. --
    socket.on('session:join', async ({ sessionId, participantId, token }, ack) => {
      try {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { id: true, hostToken: true, phase: true, roomName: true, currentQuestionId: true },
        });
        if (!session) return ack({ ok: false, error: 'Session not found.' });

        const participant = await prisma.participant.findUnique({
          where: { id: participantId },
          select: { id: true, sessionId: true, role: true, teamId: true, authToken: true, displayName: true, connected: true },
        });
        if (!participant || participant.sessionId !== sessionId) {
          return ack({ ok: false, error: 'Participant not found.' });
        }

        // Host presents the session hostToken; players present their own authToken.
        const isHost = token === session.hostToken && participant.role === 'quizmaster';
        const isValidPlayer = token === participant.authToken;
        if (!isHost && !isValidPlayer) return ack({ ok: false, error: 'Bad token.' });

        socket.data = {
          sessionId,
          participantId,
          role: participant.role as 'quizmaster' | 'player',
          teamId: participant.teamId,
          isHost,
        };
        await socket.join(roomFor(sessionId));
        if (participant.teamId) await socket.join(teamRoomFor(sessionId, participant.teamId));
        await prisma.participant.update({ where: { id: participantId }, data: { connected: true } });

        const [{ participants, teams }, leaderboard] = await Promise.all([
          rosterOf(sessionId),
          computeLeaderboard(sessionId),
        ]);
        io.to(roomFor(sessionId)).emit('participants:update', { participants, teams });

        // Current question + any answer already locked for this subject.
        let currentQuestion = null;
        let yourLockedAnswer = null;
        if (session.currentQuestionId) {
          const q = await prisma.question.findUnique({ where: { id: session.currentQuestionId } });
          if (q) {
            currentQuestion = toPublicQuestion(toQuizQuestion(q));
            yourLockedAnswer = await getLockedAnswer(
              sessionId,
              session.currentQuestionId,
              participant.teamId,
              participant.id
            );
          }
        }

        const self = participants.find((p) => p.id === participantId)!;
        const snapshot: SessionSnapshot = {
          sessionId,
          phase: session.phase as SessionSnapshot['phase'],
          self,
          participants,
          teams,
          currentQuestion,
          yourLockedAnswer,
          leaderboard,
          livekit: { url: env.livekit.url, token: '', roomName: session.roomName },
        };
        ack({ ok: true, data: snapshot });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Player locks an answer (race-safe, first write wins). --
    socket.on('answer:lock', async ({ questionId, optionId }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      try {
        const { answer } = await lockAnswer({
          sessionId: d.sessionId,
          participantId: d.participantId,
          questionId,
          optionId,
        });
        ack({ ok: true, data: answer });

        // Notify the subject it's locked: the whole team (team room) or just this solo player.
        if (answer.teamId) {
          io.to(teamRoomFor(d.sessionId, answer.teamId)).emit('question:locked-for-you', answer);
        } else {
          socket.emit('question:locked-for-you', answer);
        }
      } catch (e) {
        if (e instanceof LockError) return ack({ ok: false, error: e.message });
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Audio state switch: server computes the authoritative subscription directive. --
    socket.on('audio:set-state', async ({ state }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });

      const allowed = allowedAudioStates(d.role, !!d.teamId);
      if (!allowed.includes(state)) {
        return ack({ ok: false, error: `Audio state "${state}" not available to you.` });
      }
      try {
        await prisma.participant.update({
          where: { id: d.participantId },
          data: { audioState: state },
        });
        const directive = await computeAudioDirective(d.participantId, state);
        ack({ ok: true, data: { state } });
        // The client applies this via LiveKit setTrackSubscriptionPermissions. Team-only
        // audio never lists the quiz master, so the SFU refuses to forward it to them.
        socket.emit('audio:directive', { state, ...directive });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // ----- Host-only actions (guarded by isHost) -----
    const requireHost = (ack: (r: { ok: false; error: string }) => void): boolean => {
      if (!socket.data?.isHost) {
        ack({ ok: false, error: 'Host token required.' });
        return false;
      }
      return true;
    };

    socket.on('host:push-question', async ({ questionId }, ack) => {
      if (!requireHost(ack)) return;
      try {
        const q = await orchestrator.pushQuestion(socket.data.sessionId, questionId);
        ack({ ok: true, data: q });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    socket.on('host:lock-question', async ({ questionId }, ack) => {
      if (!requireHost(ack)) return;
      try {
        await orchestrator.lockQuestion(socket.data.sessionId, questionId);
        ack({ ok: true, data: null });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    socket.on('host:reveal', async ({ questionId }, ack) => {
      if (!requireHost(ack)) return;
      try {
        const result = await orchestrator.reveal(socket.data.sessionId, questionId);
        ack({ ok: true, data: result });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    socket.on('host:next', async (_p, ack) => {
      if (!requireHost(ack)) return;
      try {
        await orchestrator.next(socket.data.sessionId);
        ack({ ok: true, data: null });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    socket.on('host:end', async (_p, ack) => {
      if (!requireHost(ack)) return;
      try {
        await orchestrator.end(socket.data.sessionId);
        ack({ ok: true, data: null });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Manual score override (Addendum §2): apply / undo, then broadcast board. --
    socket.on('host:adjust-score', async ({ subjectKey, delta, reason }, ack) => {
      if (!requireHost(ack)) return;
      try {
        const adjustment = await applyAdjustment({
          sessionId: socket.data.sessionId,
          subjectKey,
          delta,
          reason,
        });
        const leaderboard = await computeLeaderboard(socket.data.sessionId);
        io.to(roomFor(socket.data.sessionId)).emit('leaderboard:update', leaderboard);
        ack({ ok: true, data: { adjustment, leaderboard } });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    socket.on('host:undo-adjustment', async ({ adjustmentId }, ack) => {
      if (!requireHost(ack)) return;
      try {
        await undoAdjustment(socket.data.sessionId, adjustmentId);
        const leaderboard = await computeLeaderboard(socket.data.sessionId);
        io.to(roomFor(socket.data.sessionId)).emit('leaderboard:update', leaderboard);
        ack({ ok: true, data: { leaderboard } });
      } catch (e) {
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Quiz-master-synchronized audio playback (Addendum §1). --
    socket.on('host:audio-control', async ({ questionId, mediaId, action, positionSec }, ack) => {
      if (!requireHost(ack)) return;
      io.to(roomFor(socket.data.sessionId)).emit('audio:control', {
        questionId,
        mediaId,
        action,
        positionSec,
        atServerTime: Date.now(),
      });
      ack({ ok: true, data: null });
    });

    socket.on('disconnect', async () => {
      const d = socket.data;
      if (d?.participantId) {
        await prisma.participant
          .update({ where: { id: d.participantId }, data: { connected: false } })
          .catch(() => {});
        const roster = await rosterOf(d.sessionId).catch(() => null);
        if (roster) io.to(roomFor(d.sessionId)).emit('participants:update', roster);
      }
    });
  });
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Unexpected error.';
}
