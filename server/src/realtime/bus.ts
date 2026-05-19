import { EventEmitter } from 'node:events';
import type { Server as IOServer } from 'socket.io';

export type BusEvent =
  | { type: 'cargo:created'; cargoId: string }
  | { type: 'cargo:updated'; cargoId: string }
  | { type: 'cargo:moved'; cargoId: string; fromSlot: string | null; toSlot: string | null }
  | { type: 'cargo:photo'; cargoId: string; photoId: string }
  | { type: 'cargo:report'; cargoId: string; reportId: string }
  | { type: 'config:updated' };

class Bus extends EventEmitter {
  emitEvent(evt: BusEvent) {
    this.emit('event', evt);
  }
}

export const bus = new Bus();

export function wireBusToSocket(io: IOServer) {
  bus.on('event', (evt: BusEvent) => {
    io.emit(evt.type, evt);
  });
}
