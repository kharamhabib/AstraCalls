import { useQuery } from "@tanstack/react-query";
import { getContactInfo } from "@/services/calls";

export const useContactInfo = (sid: string | null | undefined, jid: string | null | undefined) => {
  return useQuery({
    queryKey: ["contact-info", sid, jid],
    queryFn: () => getContactInfo(sid!, jid!),
    enabled: !!sid && !!jid,
    staleTime: 5 * 60 * 1000, // Cache de 5 minutos para evitar requisições redundantes
  });
};
