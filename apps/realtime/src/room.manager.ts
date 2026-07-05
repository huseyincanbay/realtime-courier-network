import { Injectable } from '@nestjs/common';

interface Client {
  userId: string;
  role: string;
  lastEmitAt: number;
}

const MIN_EMIT_INTERVAL_MS = 50;

@Injectable()
export class RoomManager {
  private readonly clients = new Map<string, Client>();
  private readonly userSockets = new Map<string, Set<string>>();

  add(socketId: string, userId: string, role: string): void {
    this.clients.set(socketId, { userId, role, lastEmitAt: 0 });
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId)!.add(socketId);
  }

  remove(socketId: string): void {
    const c = this.clients.get(socketId);
    if (!c) return;
    this.clients.delete(socketId);
    const set = this.userSockets.get(c.userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) this.userSockets.delete(c.userId);
    }
  }

  socketsOf(userId: string): string[] {
    const set = this.userSockets.get(userId);
    return set ? Array.from(set) : [];
  }

  canEmit(socketId: string): boolean {
    const c = this.clients.get(socketId);
    if (!c) return false;
    const now = Date.now();
    if (now - c.lastEmitAt < MIN_EMIT_INTERVAL_MS) return false;
    c.lastEmitAt = now;
    return true;
  }

  count(): number {
    return this.clients.size;
  }
}
