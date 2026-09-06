import { nanoid } from 'nanoid';

/**
 * Pending team invites (Round 2 §4), kept in memory (ephemeral). Flow:
 *  - 'pending': invitee hasn't responded.
 *  - 'awaiting_name': a solo+solo invite was accepted; the requester must name the new
 *    team before it's created.
 */
export interface Invite {
  id: string;
  sessionId: string;
  fromParticipantId: string;
  toParticipantId: string;
  status: 'pending' | 'awaiting_name';
  createdAt: number;
}

const invites = new Map<string, Invite>();

export function createInvite(sessionId: string, fromId: string, toId: string): Invite {
  const inv: Invite = {
    id: nanoid(12),
    sessionId,
    fromParticipantId: fromId,
    toParticipantId: toId,
    status: 'pending',
    createdAt: Date.now(),
  };
  invites.set(inv.id, inv);
  return inv;
}

export function getInvite(id: string): Invite | undefined {
  return invites.get(id);
}

export function setInviteStatus(id: string, status: Invite['status']): void {
  const inv = invites.get(id);
  if (inv) inv.status = status;
}

export function removeInvite(id: string): void {
  invites.delete(id);
}
