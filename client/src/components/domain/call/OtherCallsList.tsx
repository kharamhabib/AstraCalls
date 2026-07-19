import { Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCallDuration, formatPhoneNumber } from "@/utils/format";
import { useContactInfo } from "@/hooks/useContactInfo";
import type { CallSummary } from "@/types/call";

const OtherCallItem = ({ call }: { call: CallSummary }) => {
  const { data: contact } = useContactInfo(call.sessionId, call.peer);
  const displayPhone = formatPhoneNumber(contact?.phone || call.peer);
  const displayName = contact?.name && contact.name !== contact.phone ? contact.name : displayPhone;

  return (
    <Card className="opacity-90">
      <CardContent className="flex items-center gap-3 p-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground shrink-0">
          <Phone className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={displayName}>
            {displayName}
          </p>
          <p className="text-xs text-muted-foreground font-mono">{displayPhone}</p>
        </div>
        <Badge variant="muted">{formatCallDuration(call.startedAt, call.status)}</Badge>
      </CardContent>
    </Card>
  );
};

export const OtherCallsList = ({ calls }: { calls: CallSummary[] }) => {
  if (calls.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Outras chamadas ativas</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {calls.map((c) => (
          <OtherCallItem key={c.callId} call={c} />
        ))}
      </div>
    </section>
  );
};
