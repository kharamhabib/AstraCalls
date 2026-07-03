import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { openCall } from "@/lib/webrtc";
import { acceptCall, endCall } from "@/services/calls";
import { registerOwnConnection, clearIncoming } from "@/stores/calls";
import { getAIConfig } from "@/services/ai";

export const useAcceptCall = (micId: string | null) =>
  useMutation({
    mutationFn: async (vars: { sid: string; callId: string; ai?: boolean }) => {
      const res = await acceptCall(vars.sid, vars.callId, vars.ai);
      
      const { enabled, aiConfig } = await getAIConfig(vars.sid);
      const isServerAI = vars.ai && enabled && aiConfig && aiConfig.serverSideAI;

      if (!isServerAI) {
        try {
          const conn = await openCall(vars.sid, res.call.callId, micId);
          registerOwnConnection(res.call.callId, conn);
        } catch (wrtcErr) {
          try {
            await endCall(vars.sid, res.call.callId);
          } catch {}
          throw wrtcErr;
        }
      }
      clearIncoming();
      return res.call.callId;
    },
    onError: (e: Error) => {
      if (e.message.includes("409")) {
        clearIncoming();
        return;
      }
      toast.error(e.message);
    },
  });
