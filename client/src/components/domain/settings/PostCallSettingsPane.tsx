import { Heart, HelpCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AIConfig } from "@/types/ai";
import { Switch } from "@/components/ui/Switch";

interface PostCallSettingsPaneProps {
  config: AIConfig;
  onChange: (cfg: AIConfig) => void;
}

export const PostCallSettingsPane = ({ config, onChange }: PostCallSettingsPaneProps) => {
  const p = config.postCall || {
    summaryEnabled: false,
    sendAdmin: false,
    adminNumber: "",
    sendClient: false,
    webhookEnabled: false,
    webhookUrl: ""
  };

  const update = (key: keyof typeof p, val: any) => {
    onChange({
      ...config,
      postCall: {
        ...p,
        [key]: val
      }
    });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary Enable Toggle */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium cursor-pointer" htmlFor="summaryEnabled">Habilitar Ações Pós-Chamada (Resumos)</Label>
        </div>
        <Switch
          id="summaryEnabled"
          checked={p.summaryEnabled}
          onChange={(v) => update("summaryEnabled", v)}
        />
      </div>

      {p.summaryEnabled && (
        <div className="space-y-4 animate-fade-in">
          <p className="text-sm text-muted-foreground px-1">
            Quando a ligação terminar, a IA analisará a conversa para gerar um resumo executivo. Configure abaixo as ações automáticas pós-chamada.
          </p>

          <Card className="card-premium">
            <CardContent className="p-4 space-y-4.5">
              {/* Send to Admin */}
              <div className="space-y-3 border-b pb-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-sm font-semibold cursor-pointer" htmlFor="sendAdmin">
                        Enviar Resumo ao Administrador
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>Envia o resumo da conversa via WhatsApp para o operador ou gerente.</TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-muted-foreground">Notifica a gerência com o resultado da chamada.</p>
                  </div>
                  <Switch
                    id="sendAdmin"
                    checked={p.sendAdmin}
                    onChange={(v) => update("sendAdmin", v)}
                  />
                </div>

                {p.sendAdmin && (
                  <div className="space-y-1.5 pl-1 animate-fade-in-fast">
                    <Label className="text-xs" htmlFor="adminNumber">Número do Administrador (WhatsApp com DDI)</Label>
                    <Input
                      id="adminNumber"
                      placeholder="Ex: 5511999999999"
                      value={p.adminNumber || ""}
                      onChange={(e) => update("adminNumber", e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Send to Client */}
              <div className="flex items-center justify-between border-b pb-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold cursor-pointer" htmlFor="sendClient">
                      Enviar Resumo ao Cliente
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Envia o resumo dos pontos tratados para o próprio cliente via WhatsApp.</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">Garante transparência enviando o que foi acordado ao cliente.</p>
                </div>
                <Switch
                  id="sendClient"
                  checked={p.sendClient}
                  onChange={(v) => update("sendClient", v)}
                />
              </div>

              {/* Trigger Webhook */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-sm font-semibold cursor-pointer" htmlFor="webhookEnabled">
                        Disparar Webhook Pós-Chamada
                      </Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>Envia um payload POST contendo resumo, transcrição e metadados da chamada.</TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-muted-foreground">Integre com seu CRM (HubSpot, Make, n8n) para atualizar o lead.</p>
                  </div>
                  <Switch
                    id="webhookEnabled"
                    checked={p.webhookEnabled}
                    onChange={(v) => update("webhookEnabled", v)}
                  />
                </div>

                {p.webhookEnabled && (
                  <div className="space-y-1.5 pl-1 animate-fade-in-fast">
                    <Label className="text-xs" htmlFor="webhookUrl">URL do Webhook (POST)</Label>
                    <Input
                      id="webhookUrl"
                      placeholder="https://n8n.meusistema.com/webhook/rockcall"
                      value={p.webhookUrl || ""}
                      onChange={(e) => update("webhookUrl", e.target.value)}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
