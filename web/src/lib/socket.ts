import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { EVENTS } from "@wishit/shared";

let socket: Socket | null = null;
const rooms = new Map<string, number>();

export function getSocket(): Socket {
  if (!socket) {
    socket = io({ transports: ["websocket", "polling"] });
    socket.on("connect", () => rooms.forEach((_n, room) => socket!.emit(EVENTS.join, room)));
  }
  return socket;
}

/** Join a room for the component's lifetime (rejoins automatically after reconnects). */
export function useRoom(room: string | null | undefined) {
  useEffect(() => {
    if (!room) return;
    const s = getSocket();
    rooms.set(room, (rooms.get(room) ?? 0) + 1);
    s.emit(EVENTS.join, room);
    return () => {
      const n = (rooms.get(room) ?? 1) - 1;
      if (n <= 0) rooms.delete(room);
      else rooms.set(room, n);
    };
  }, [room]);
}

export function useSocketEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event]);
}
