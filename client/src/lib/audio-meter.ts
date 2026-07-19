// AudioContext compartilhado: o Chrome limita ~6 contextos simultâneos por
// origem — com um contexto por medidor (mic + peer + IA por chamada), poucas
// chamadas ativas estouravam o limite e os medidores falhavam silenciosamente.
let sharedCtx: AudioContext | null = null;
let refCount = 0;

const acquireContext = (): AudioContext => {
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new AudioContext();
    refCount = 0;
  }
  refCount += 1;
  if (sharedCtx.state === "suspended") {
    void sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
};

const releaseContext = (): void => {
  refCount -= 1;
  if (refCount <= 0 && sharedCtx) {
    refCount = 0;
    void sharedCtx.close().catch(() => {});
    sharedCtx = null;
  }
};

export const attachMeter = (stream: MediaStream, onDb: (db: number) => void): (() => void) => {
  const ctx = acquireContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const db = rms > 0 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
    onDb(db);
    requestAnimationFrame(tick);
  };
  tick();
  return () => {
    stopped = true;
    try {
      src.disconnect();
      analyser.disconnect();
    } catch {}
    releaseContext();
  };
};
