import { apiPost } from "./api";

export type OpenCall = {
  pc: RTCPeerConnection;
  micStream: MediaStream;
  remoteStream: MediaStream | null;
  close: () => void;
};

export const openCall = async (
  sid: string,
  callId: string,
  micDeviceId: string | null,
): Promise<OpenCall> => {
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
  });
  const pc = new RTCPeerConnection({ iceServers: [] });
  micStream.getAudioTracks().forEach((t) => {
    const sender = pc.addTrack(t, micStream);
    const transceiver = pc.getTransceivers().find((tr) => tr.sender === sender);
    if (transceiver) {
      transceiver.direction = "sendrecv";
    }
  });
  const remoteHolder: { stream: MediaStream | null } = { stream: null };
  pc.ontrack = (ev) => {
    if (ev.streams[0]) {
      remoteHolder.stream = ev.streams[0];
    } else {
      if (!remoteHolder.stream) {
        remoteHolder.stream = new MediaStream();
      }
      remoteHolder.stream.addTrack(ev.track);
    }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") resolve();
    else
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") resolve();
      });
  });
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
};
