import type { Server } from "socket.io";

let io: Server | null = null;
export function setIo(server: Server) {
  io = server;
}

/** Emit to a room ("wish:<id>", "campaign:<id>", or "board") and log it. */
export function emit(rooms: string | string[], event: string, payload: unknown) {
  if (!io) return;
  let target = io.to(rooms);
  target.emit(event, payload);
}
