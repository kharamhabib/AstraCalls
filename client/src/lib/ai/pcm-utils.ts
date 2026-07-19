// Utilitários de áudio PCM para a ponte Gemini Live (client-side).

export function base64ToFloat32(base64: string): Float32Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// PCMPlayer reproduz chunks PCM sequencialmente e sem cliques, agendando cada
// buffer logo após o anterior no relógio do AudioContext.
export class PCMPlayer {
  private audioCtx: AudioContext;
  private nextStartTime: number = 0;
  private destination: AudioNode;

  constructor(audioCtx: AudioContext, destination: AudioNode) {
    this.audioCtx = audioCtx;
    this.destination = destination;
    this.nextStartTime = this.audioCtx.currentTime;
  }

  playChunk(float32Array: Float32Array, sampleRate: number = 24000): void {
    if (float32Array.length === 0) return;
    const buffer = this.audioCtx.createBuffer(1, float32Array.length, sampleRate);
    // copyToChannel tipa Float32Array<ArrayBuffer> — o cast é seguro aqui porque
    // o buffer é criado pelo próprio AudioContext (ArrayBuffer comum).
    buffer.copyToChannel(float32Array as Float32Array<ArrayBuffer>, 0);

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);

    const now = this.audioCtx.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  isPlaying(): boolean {
    return this.nextStartTime > this.audioCtx.currentTime;
  }
}
