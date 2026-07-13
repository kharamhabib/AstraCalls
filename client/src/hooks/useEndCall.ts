import { useMutation } from "@tanstack/react-query";
import { endCall } from "@/services/calls";
import { toast } from "sonner";

export const useEndCall = () =>
  useMutation({
    mutationFn: (vars: { sid: string; callId: string }) => endCall(vars.sid, vars.callId),
    onError: (err: any) => {
      console.error("[useEndCall] Erro ao encerrar chamada:", err);
      toast.error(`Falha ao encerrar chamada: ${err.message || err}`);
    },
  });
