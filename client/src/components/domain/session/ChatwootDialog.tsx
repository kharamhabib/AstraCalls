import { useState } from "react";
import { MessageSquare } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChatwootForm } from "./ChatwootForm";

export const ChatwootDialog = ({ sid }: { sid: string }) => {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={enabled ? "default" : "outline"} size="sm">
          <MessageSquare className="h-4 w-4" />
          Chatwoot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Integração com Chatwoot</DialogTitle>
          <DialogDescription>
            Conecte esta sessão a uma caixa de entrada (inbox do tipo <b>API</b>) do Chatwoot.
          </DialogDescription>
        </DialogHeader>

        <ChatwootForm sid={sid} onEnabledChange={setEnabled} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
};
