import { useEffect, useState } from "react";

export type AudioDevice = { deviceId: string; label: string };

export const useAudioDevices = () => {
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [outs, setOuts] = useState<AudioDevice[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setMics(
        list
          .filter((d) => d.kind === "audioinput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Microfone padrão" })),
      );
      setOuts(
        list
          .filter((d) => d.kind === "audiooutput")
          .map((d) => ({ deviceId: d.deviceId, label: d.label || "Alto-falante padrão" })),
      );
    };

    (async () => {
      // Abre o mic só para liberar os labels dos dispositivos e já solta a trilha
      try {
        (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
      } catch {}
      await refresh();
    })();

    // Reenumera quando um dispositivo é plugado/removido (antes exigia reload)
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  return { mics, outs };
};

