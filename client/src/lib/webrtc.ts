import { apiPost } from "./api";

export type OpenCall = {
  pc: RTCPeerConnection;
  micStream: MediaStream;
  remoteStream: MediaStream | null;
  close: () => void;
};

// ICE_GATHER_TIMEOUT evita que a chamada fique em "Conectando…" para sempre
// quando a coleta ICE trava (rede hostil, sem STUN disponível).
const ICE_GATHER_TIMEOUT_MS = 10_000;

const waitIceComplete = (pc: RTCPeerConnection): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const onState = () => {
      if (pc.iceGatheringState === "complete") {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout na coleta ICE"));
    }, ICE_GATHER_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onState);
    };
    pc.addEventListener("icegatheringstatechange", onState);
  });

export const openCall = async (
  sid: string,
  callId: string,
  micDeviceId: string | null,
): Promise<OpenCall> => {
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
  });
  const pc = new RTCPeerConnection({ iceServers: [] });
  // Em qualquer falha depois de abrir o mic, liberamos tudo (LED do microfone
  // não pode ficar aceso numa chamada que nem chegou a iniciar).
  try {
    const tracks = micStream.getAudioTracks();
    if (tracks.length > 0) {
      tracks.forEach((t) => pc.addTrack(t, micStream));
    } else {
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    const remoteHolder: { stream: MediaStream | null } = { stream: null };
    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        remoteHolder.stream = ev.streams[0];
      } else if (ev.track) {
        const stream = new MediaStream();
        stream.addTrack(ev.track);
        remoteHolder.stream = stream;
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    const { sdp_answer } = await apiPost<{ sdp_answer: string }>(
      `/api/sessions/${sid}/calls/${callId}/webrtc`,
      { sdp_offer: pc.localDescription!.sdp },
    );
    await pc.setRemoteDescription({ type: "answer", sdp: sdp_answer });
    return {
      pc,
      micStream,
      get remoteStream() {
        return remoteHolder.stream;
      },
      close: () => {
        try {
          micStream.getTracks().forEach((t) => t.stop());
        } catch {}
        try {
          pc.close();
        } catch {}
      },
    } as OpenCall;
  } catch (err) {
    try {
      micStream.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      pc.close();
    } catch {}
    throw err;
  }
};
