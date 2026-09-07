import type { AudioState, SessionSnapshot } from '@sigunu/shared';
import { allowedAudioStates } from '@sigunu/shared';
import type { Socket } from 'socket.io';
import { prisma } from '../db/client.js';
import { roomFor, teamRoomFor, type SigunuServer, type SocketData } from './io.js';
import { Orchestrator } from '../game/orchestrator.js';
import { lockAnswer, getLockedAnswer, LockError } from '../game/locking.js';
import { rosterOf } from '../game/sessions.js';
import { toQuizQuestion, toPublicQuestion } from '../game/questions.js';
import { computeLeaderboard } from '../leaderboard/leaderboard.js';
import { applyAdjustment, undoAdjustment } from '../game/adjustments.js';
import { computeAudioDirective } from '../livekit/permissions.js';
import { addChat, recentChat } from '../game/chat.js';
import { createInvite, getInvite, setInviteStatus, removeInvite } from '../game/invites.js';
import { leaveTeam, joinExistingTeam, createTeamAndJoin, MembershipError } from '../game/membership.js';
import { revealHint, HintError } from '../game/hints.js';
import { env } from '../env.js';

export function registerSocketHandlers(io: SigunuServer) {
  const orchestrator = new Orchestrator(io);
  // participantId -> latest socket, so membership changes can re-sync a specific client.
  const socketsByParticipant = new Map<string, Socket<any, any, any, SocketData>>();
  // Media readiness per question: `${sessionId}|${questionId}` -> set of ready participantIds.
  const mediaReadiness = new Map<string, Set<string>>();

  const broadcastReadyCount = async (sessionId: string, questionId: string) => {
    // Total = players actually connected/in the meeting (not stale disconnected records).
    const total = await prisma.participant.count({
      where: { sessionId, role: 'player', status: { not: 'left' }, connected: true },
    });
    const readySet = mediaReadiness.get(`${sessionId}|${questionId}`);
    const ready = readySet ? Math.min(readySet.size, total) : 0;
    io.to(roomFor(sessionId)).emit('media:ready-count', { questionId, ready, total });
  };

  const broadcastRoster = async (sessionId: string) => {
    const roster = await rosterOf(sessionId);
    io.to(roomFor(sessionId)).emit('participants:update', roster);
  };
  const broadcastLeaderboard = async (sessionId: string) => {
    io.to(roomFor(sessionId)).emit('leaderboard:update', await computeLeaderboard(sessionId));
  };

  // After a membership change, re-sync a client: fix its team room + re-emit its audio
  // directive (team-only allow-lists depend on team membership).
  const resyncParticipant = async (sessionId: string, participantId: string) => {
    const s = socketsByParticipant.get(participantId);
    if (!s) return;
    const p = await prisma.participant.findUnique({
      where: { id: participantId },
      select: { teamId: true, audioState: true, role: true },
    });
    if (!p) return;
    s.data.teamId = p.teamId;
    for (const room of [...s.rooms]) {
      if (room.startsWith(`team:${sessionId}:`)) await s.leave(room);
    }
    if (p.teamId) await s.join(teamRoomFor(sessionId, p.teamId));

    let state = p.audioState as AudioState;
    const allowed = allowedAudioStates(p.role as 'quizmaster' | 'player', !!p.teamId);
    if (!allowed.includes(state)) {
      state = 'mute';
      await prisma.participant.update({ where: { id: participantId }, data: { audioState: 'mute' } });
    }
    const directive = await computeAudioDirective(participantId, state);
    s.emit('audio:directive', { state, ...directive });
  };

  // Resync the given participants plus every current member of the given teams (their
  // team-only permissions changed), then broadcast the fresh roster + leaderboard.
  const applyMembershipChange = async (
    sessionId: string,
    participantIds: string[],
    teamIds: (string | null)[]
  ) => {
    const ids = new Set(participantIds);
    for (const tId of teamIds) {
      if (!tId) continue;
      const members = await prisma.participant.findMany({ where: { teamId: tId }, select: { id: true } });
      for (const m of members) ids.add(m.id);
    }
    for (const id of ids) await resyncParticipant(sessionId, id);
    await broadcastRoster(sessionId);
    await broadcastLeaderboard(sessionId);
  };

  io.on('connection', (socket) => {
    // -- Join the game-state room; authenticate by token. --
    socket.on('session:join', async ({ sessionId, participantId, token }, ack) => {
      try {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { id: true, hostToken: true, phase: true, roomName: true, currentQuestionId: true, startedAt: true, joinCode: true },
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
        socketsByParticipant.set(participantId, socket as unknown as Socket<any, any, any, SocketData>);
        await prisma.participant.update({
          where: { id: participantId },
          data: { connected: true, status: 'active' },
        });

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
          started: !!session.startedAt,
          self,
          participants,
          teams,
          currentQuestion,
          yourLockedAnswer,
          leaderboard,
          recentChat: recentChat(sessionId),
          joinCode: session.joinCode,
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
        // Clear media readiness from prior questions in this session.
        for (const k of mediaReadiness.keys()) {
          if (k.startsWith(`${socket.data.sessionId}|`)) mediaReadiness.delete(k);
        }
        const q = await orchestrator.pushQuestion(socket.data.sessionId, questionId);
        ack({ ok: true, data: q });
        await broadcastReadyCount(socket.data.sessionId, questionId);
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

    socket.on('host:start', async (_p, ack) => {
      if (!requireHost(ack)) return;
      try {
        await orchestrator.start(socket.data.sessionId);
        ack({ ok: true, data: null });
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

    // -- Global chat (Round 2 §chat): everyone in the session sees it. --
    socket.on('chat:send', async ({ text }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      const clean = (text ?? '').trim();
      if (!clean) return ack({ ok: false, error: 'Empty message.' });
      const p = await prisma.participant.findUnique({
        where: { id: d.participantId },
        select: { displayName: true, role: true },
      });
      if (!p) return ack({ ok: false, error: 'Not found.' });
      const msg = addChat(
        d.sessionId,
        { participantId: d.participantId, name: p.displayName, role: p.role as 'quizmaster' | 'player' },
        clean
      );
      io.to(roomFor(d.sessionId)).emit('chat:message', msg);
      ack({ ok: true, data: null });
    });

    // -- Reveal a question's hint (Round 2 §hint); charges the subject the hintCost. --
    socket.on('hint:reveal', async ({ questionId }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      try {
        const { hint, teamId } = await revealHint(d.sessionId, d.participantId, questionId);
        ack({ ok: true, data: { hint } });
        // Share the hint (and the charge) with teammates; solo just gets it themselves.
        if (teamId) io.to(teamRoomFor(d.sessionId, teamId)).emit('hint:revealed', { questionId, hint });
        else socket.emit('hint:revealed', { questionId, hint });
        await broadcastLeaderboard(d.sessionId);
      } catch (e) {
        if (e instanceof HintError) return ack({ ok: false, error: e.message });
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Device auto-acknowledges it's ready to play the current media (no button). --
    socket.on('media:ready', async ({ questionId }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      const key = `${d.sessionId}|${questionId}`;
      let set = mediaReadiness.get(key);
      if (!set) mediaReadiness.set(key, (set = new Set()));
      set.add(d.participantId);
      ack({ ok: true, data: null });
      await broadcastReadyCount(d.sessionId, questionId);
    });

    // -- Leave the quiz entirely (Round 2 §6). --
    socket.on('quiz:leave', async (_p, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      await prisma.participant
        .update({ where: { id: d.participantId }, data: { status: 'left', connected: false } })
        .catch(() => {});
      socketsByParticipant.delete(d.participantId);
      ack({ ok: true, data: null });
      await broadcastRoster(d.sessionId);
      await broadcastLeaderboard(d.sessionId);
      // The client disconnects from LiveKit on its side after this ack.
    });

    // -- Leave team -> become solo (Round 2 §5), carrying own points. --
    socket.on('team:leave', async (_p, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      try {
        const oldTeamId = d.teamId;
        const res = await leaveTeam(d.participantId);
        ack({ ok: true, data: null });
        if (res) await applyMembershipChange(res.sessionId, [d.participantId], [oldTeamId]);
      } catch (e) {
        if (e instanceof MembershipError) return ack({ ok: false, error: e.message });
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Invite a solo participant to your team (Round 2 §4). --
    socket.on('team:invite', async ({ toParticipantId }, ack) => {
      const d = socket.data;
      if (!d?.participantId || d.role !== 'player') return ack({ ok: false, error: 'Only players can invite.' });
      if (toParticipantId === d.participantId) return ack({ ok: false, error: "You can't invite yourself." });
      const invitee = await prisma.participant.findUnique({
        where: { id: toParticipantId },
        select: { sessionId: true, role: true, teamId: true, status: true, displayName: true },
      });
      if (!invitee || invitee.sessionId !== d.sessionId || invitee.role !== 'player') {
        return ack({ ok: false, error: 'Player not found.' });
      }
      if (invitee.status === 'left') return ack({ ok: false, error: 'That player has left.' });
      // Confirmed rule: can't invite someone already on a team.
      if (invitee.teamId) return ack({ ok: false, error: `${invitee.displayName} is already on a team.` });

      const me = await prisma.participant.findUnique({
        where: { id: d.participantId },
        select: { displayName: true },
      });
      const invite = createInvite(d.sessionId, d.participantId, toParticipantId);
      const target = socketsByParticipant.get(toParticipantId);
      if (!target) {
        removeInvite(invite.id);
        return ack({ ok: false, error: 'That player is not connected.' });
      }
      target.emit('team:invite-received', { inviteId: invite.id, fromName: me?.displayName ?? 'A player' });
      ack({ ok: true, data: { inviteId: invite.id } });
    });

    // -- Invitee responds to an invite. --
    socket.on('team:invite-respond', async ({ inviteId, accept }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      const invite = getInvite(inviteId);
      if (!invite || invite.toParticipantId !== d.participantId) {
        return ack({ ok: false, error: 'Invite not found.' });
      }
      const requesterSocket = socketsByParticipant.get(invite.fromParticipantId);
      if (!accept) {
        removeInvite(inviteId);
        requesterSocket?.emit('team:invite-result', { accepted: false, message: 'Invite declined.' });
        return ack({ ok: true, data: { needsName: false } });
      }
      try {
        const [requester, invitee] = await Promise.all([
          prisma.participant.findUnique({ where: { id: invite.fromParticipantId }, select: { teamId: true, displayName: true } }),
          prisma.participant.findUnique({ where: { id: d.participantId }, select: { teamId: true, displayName: true } }),
        ]);
        if (!requester || !invitee) throw new MembershipError('Not found.', 'not_found');
        if (invitee.teamId) throw new MembershipError('You are already on a team.', 'busy');

        if (requester.teamId) {
          // Requester has a team → invitee joins it directly.
          await joinExistingTeam(d.participantId, requester.teamId);
          removeInvite(inviteId);
          ack({ ok: true, data: { needsName: false } });
          requesterSocket?.emit('team:invite-result', { accepted: true, message: `${invitee.displayName} joined your team.` });
          await applyMembershipChange(d.sessionId, [d.participantId, invite.fromParticipantId], [requester.teamId]);
        } else {
          // Both solo → requester must name the new team.
          setInviteStatus(inviteId, 'awaiting_name');
          ack({ ok: true, data: { needsName: true } });
          requesterSocket?.emit('team:name-needed', { inviteId, inviteeName: invitee.displayName });
        }
      } catch (e) {
        if (e instanceof MembershipError) return ack({ ok: false, error: e.message });
        ack({ ok: false, error: errMsg(e) });
      }
    });

    // -- Requester names the new team (solo+solo case). --
    socket.on('team:name-new', async ({ inviteId, name }, ack) => {
      const d = socket.data;
      if (!d?.participantId) return ack({ ok: false, error: 'Not joined.' });
      const invite = getInvite(inviteId);
      if (!invite || invite.fromParticipantId !== d.participantId || invite.status !== 'awaiting_name') {
        return ack({ ok: false, error: 'Invite not found.' });
      }
      try {
        const { teamId } = await createTeamAndJoin(d.sessionId, name, invite.fromParticipantId, invite.toParticipantId);
        removeInvite(inviteId);
        ack({ ok: true, data: null });
        const inviteeSocket = socketsByParticipant.get(invite.toParticipantId);
        inviteeSocket?.emit('team:invite-result', { accepted: true, message: 'Team created!' });
        await applyMembershipChange(d.sessionId, [invite.fromParticipantId, invite.toParticipantId], [teamId]);
      } catch (e) {
        if (e instanceof MembershipError) return ack({ ok: false, error: e.message });
        ack({ ok: false, error: errMsg(e) });
      }
    });

    socket.on('disconnect', async () => {
      const d = socket.data;
      if (d?.participantId) {
        // Only clear the registry if this is still the active socket for the participant.
        if (socketsByParticipant.get(d.participantId) === (socket as unknown as Socket<any, any, any, SocketData>)) {
          socketsByParticipant.delete(d.participantId);
        }
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
