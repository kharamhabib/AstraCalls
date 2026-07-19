import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ChatwootForm } from "@/components/domain/session/ChatwootForm";

export const ChatwootSettingsPane = ({ sid }: { sid: string }) => {
  const [enabled, setEnabled] = useState(false);

  return (
    <div className="space-y-5 animate-fade-in relative">
      {/* Status indicator */}
      <div className="flex items-center gap-2 px-1">
        <MessageSquare className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-medium">Integração com Chatwoot</span>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
          enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
        }`}>
          {enabled ? "Conectado" : "Desconectado"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground px-1">
        Conecte esta sessão a uma caixa de entrada (inbox do tipo <b>API</b>) do Chatwoot.
      </p>

      <Card className="card-premium">
        <CardContent className="p-4">
          <ChatwootForm sid={sid} onEnabledChange={setEnabled} />
        </CardContent>
      </Card>
    </div>
  );
};
