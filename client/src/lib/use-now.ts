import { useSyncExternalStore } from "react";

// Relógio global compartilhado (1 intervalo para o app inteiro): substitui os
// vários setInterval(() => force(), 1000) que re-renderizavam árvores inteiras.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

const getSnapshot = (): number => now;

// useNow re-renderiza o componente a cada segundo, compartilhando um único
// timer entre todos os consumidores (cronômetros de chamada, countdowns etc).
export const useNow = (): number => useSyncExternalStore(subscribe, getSnapshot);
