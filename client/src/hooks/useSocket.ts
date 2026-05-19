import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';

let socket: Socket | null = null;

function getSocket() {
  if (!socket) {
    socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function useSocketBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const s = getSocket();
    const invalidateAll = () => {
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['cargo'] });
    };
    const onCargo = (evt: { cargoId?: string }) => {
      invalidateAll();
      if (evt.cargoId) qc.invalidateQueries({ queryKey: ['cargo', evt.cargoId] });
    };
    s.on('cargo:created', onCargo);
    s.on('cargo:updated', onCargo);
    s.on('cargo:moved', onCargo);
    s.on('cargo:photo', onCargo);
    s.on('cargo:report', onCargo);
    s.on('config:updated', invalidateAll);
    return () => {
      s.off('cargo:created', onCargo);
      s.off('cargo:updated', onCargo);
      s.off('cargo:moved', onCargo);
      s.off('cargo:photo', onCargo);
      s.off('cargo:report', onCargo);
      s.off('config:updated', invalidateAll);
    };
  }, [qc]);
}
