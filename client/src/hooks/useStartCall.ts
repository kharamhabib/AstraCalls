import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { openCall } from "@/lib/webrtc";
import { startCall } from "@/services/calls";
import { registerOwnConnection } from "@/stores/calls";
import { getAIConfig } from "@/services/ai";

export const useStartCall = (sid: string, micId: string | null) =>
  useMutation({
    mutationFn: async (vars: { phone: string; record: boolean; ai?: boolean; prompt?: string; greeting?: string }) => {
      const { call } = await startCall(sid, vars.phone, vars.record, vars.ai, vars.prompt, vars.greeting);
      
      const { enabled, aiConfig } = await getAIConfig(sid);
      const isServerAI = vars.ai && enabled && aiConfig && aiConfig.serverSideAI;

      if (!isServerAI) {
        const conn = await openCall(sid, call.callId, micId);
        registerOwnConnection(call.callId, conn);
      }
      return call.callId;
    },
    onError: (e: Error) => {
      const m = e.message;
      if (m.includes("429")) toast.error("Limit reached: max concurrent calls.");
      else if (m.includes("503")) toast.error("WhatsApp not paired.");
      else toast.error(m);
    },
  });
