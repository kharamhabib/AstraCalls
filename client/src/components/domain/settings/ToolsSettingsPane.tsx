import { useState } from "react";
import { Sparkles, Trash2, Plus, HelpCircle, Code } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import type { AIConfig, CustomTool, ToolParam } from "@/types/ai";

/** Switch component */
const Switch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`switch-track relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent focus:outline-none focus:ring-2 focus:ring-primary ${
      checked ? "bg-primary" : "bg-muted"
    }`}
  >
    <span
      className={`switch-thumb pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow ${
        checked ? "translate-x-5" : "translate-x-0"
      }`}
    />
  </button>
);

interface ToolsSettingsPaneProps {
  config: AIConfig;
  onChange: (cfg: AIConfig) => void;
}

export const ToolsSettingsPane = ({ config, onChange }: ToolsSettingsPaneProps) => {
  const [showAddTool, setShowAddTool] = useState(false);
  
  // States for new custom tool
  const [toolName, setToolName] = useState("");
  const [toolDesc, setToolDesc] = useState("");
  const [toolUrl, setToolUrl] = useState("");
  const [toolParams, setToolParams] = useState<ToolParam[]>([]);

  // States for new parameter
  const [paramName, setParamName] = useState("");
  const [paramType, setParamType] = useState("string");
  const [paramDesc, setParamDesc] = useState("");
  const [paramReq, setParamReq] = useState(false);

  const toggleTool = (tool: string) => {
    const active = config.predefinedTools || [];
    const next = active.includes(tool)
      ? active.filter((t) => t !== tool)
      : [...active, tool];
    onChange({ ...config, predefinedTools: next });
  };

  const handleAddParam = () => {
    const trimmed = paramName.trim().replace(/[^a-zA-Z0-9_]/g, "");
    if (!trimmed) return;
    setToolParams([
      ...toolParams,
      { name: trimmed, type: paramType, description: paramDesc.trim(), required: paramReq }
    ]);
    setParamName("");
    setParamDesc("");
    setParamReq(false);
  };

  const handleRemoveParam = (index: number) => {
    setToolParams(toolParams.filter((_, i) => i !== index));
  };

  const handleAddTool = () => {
    const nameTrimmed = toolName.trim().replace(/[^a-zA-Z0-9_]/g, "");
    if (!nameTrimmed || !toolUrl.trim()) return;

    const newTool: CustomTool = {
      name: nameTrimmed,
      description: toolDesc.trim(),
      webhookUrl: toolUrl.trim(),
      parameters: toolParams
    };

    const nextCustomTools = [...(config.customTools || []), newTool];
    onChange({ ...config, customTools: nextCustomTools });

    // Reset form
    setToolName("");
    setToolDesc("");
    setToolUrl("");
    setToolParams([]);
    setShowAddTool(false);
  };

  const handleRemoveTool = (name: string) => {
    const nextCustomTools = (config.customTools || []).filter((t) => t.name !== name);
    onChange({ ...config, customTools: nextCustomTools });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Feature Toggle */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Habilitar Chamada de Funções (Tools)</span>
        </div>
        <Switch
          checked={config.toolsEnabled}
          onChange={(v) => onChange({ ...config, toolsEnabled: v })}
        />
      </div>

      {config.toolsEnabled && (
        <>
          {/* Predefined Tools */}
          <div className="px-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Ferramentas Pré-definidas do Sistema
            </p>
          </div>

          <Card className="card-premium">
            <CardContent className="p-4 space-y-4">
              {/* Hangup */}
              <div className="flex items-center justify-between border-b pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold cursor-pointer" htmlFor="tool-hangup">
                      Desligar Chamada (hangup)
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Permite que a IA encerre a ligação quando o assunto for concluído.</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">Desliga o telefone e encerra a conexão.</p>
                </div>
                <Switch
                  checked={config.predefinedTools?.includes("hangup") || false}
                  onChange={() => toggleTool("hangup")}
                />
              </div>

              {/* Human Transfer */}
              <div className="flex items-center justify-between border-b pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold cursor-pointer" htmlFor="tool-transfer">
                      Transferir para Humano (human_transfer)
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Desconecta a IA, toca um alerta e devolve o áudio para o microfone do operador.</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">Transfere o controle da ligação para você.</p>
                </div>
                <Switch
                  checked={config.predefinedTools?.includes("human_transfer") || false}
                  onChange={() => toggleTool("human_transfer")}
                />
              </div>

              {/* Send Message */}
              <div className="flex items-center justify-between border-b pb-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold cursor-pointer" htmlFor="tool-message">
                      Enviar Mensagem de Texto (send_message)
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Permite que a IA envie mensagens de confirmação ou dados por texto no WhatsApp do cliente.</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">Envia mensagem via WhatsApp durante a chamada.</p>
                </div>
                <Switch
                  checked={config.predefinedTools?.includes("send_message") || false}
                  onChange={() => toggleTool("send_message")}
                />
              </div>

              {/* Schedule Call */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold cursor-pointer" htmlFor="tool-schedule">
                      Agendar/Reagendar Ligação (schedule_call)
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>Permite que a IA agende uma ligação futura ou reagende a ligação caso o cliente peça para retornar depois.</TooltipContent>
                    </Tooltip>
                  </div>
                  <p className="text-xs text-muted-foreground">Cria uma ligação programada nas tarefas da IA.</p>
                </div>
                <Switch
                  checked={config.predefinedTools?.includes("schedule_call") || false}
                  onChange={() => toggleTool("schedule_call")}
                />
              </div>
            </CardContent>
          </Card>

          {/* Custom Webhook Tools */}
          <div className="flex items-center justify-between px-1 mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ferramentas Customizadas (Webhooks HTTP)
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddTool((v) => !v)}
              className="gap-1 h-7 text-xs"
            >
              <Plus className="h-3 w-3" /> Add Webhook Tool
            </Button>
          </div>

          {/* Add custom tool form */}
          {showAddTool && (
            <Card className="card-premium border-primary/20 animate-slide-up">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Code className="h-4 w-4" /> Nova Ferramenta Webhook
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Identificador da Função (Apenas letras/números/_)</Label>
                    <Input
                      placeholder="ex: consultar_saldo"
                      value={toolName}
                      onChange={(e) => setToolName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">URL do Webhook (POST)</Label>
                    <Input
                      placeholder="https://api.meusistema.com/webhook"
                      value={toolUrl}
                      onChange={(e) => setToolUrl(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Descrição para o Agente IA (Quando usar esta ferramenta)</Label>
                  <Input
                    placeholder="ex: Use esta ferramenta quando o cliente perguntar o saldo atual da sua conta."
                    value={toolDesc}
                    onChange={(e) => setToolDesc(e.target.value)}
                  />
                </div>

                {/* Sub-form: Tool Parameters */}
                <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
                  <p className="text-xs font-bold text-muted-foreground">Parâmetros de Entrada</p>
                  
                  <div className="grid grid-cols-4 gap-2 items-end">
                    <div className="space-y-1 col-span-1">
                      <Label className="text-[10px]">Nome</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="ex: cpf"
                        value={paramName}
                        onChange={(e) => setParamName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 col-span-1">
                      <Label className="text-[10px]">Tipo</Label>
                      <select
                        className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={paramType}
                        onChange={(e) => setParamType(e.target.value)}
                      >
                        <option value="string">Texto (string)</option>
                        <option value="number">Número (number)</option>
                        <option value="boolean">Sim/Não (boolean)</option>
                      </select>
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-[10px]">Descrição do Parâmetro</Label>
                      <div className="flex gap-2">
                        <Input
                          className="h-8 text-xs flex-1"
                          placeholder="ex: CPF para consulta"
                          value={paramDesc}
                          onChange={(e) => setParamDesc(e.target.value)}
                        />
                        <div className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            id="p-req"
                            checked={paramReq}
                            onChange={(e) => setParamReq(e.target.checked)}
                          />
                          <Label htmlFor="p-req" className="text-[10px] cursor-pointer">Obrigatório</Label>
                        </div>
                        <Button size="sm" className="h-8 px-2" onClick={handleAddParam}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Param list */}
                  {toolParams.length > 0 && (
                    <div className="space-y-1.5 pt-2">
                      {toolParams.map((p, idx) => (
                        <div key={idx} className="flex items-center justify-between text-xs bg-background border rounded px-2.5 py-1">
                          <span className="font-semibold text-primary">{p.name} <span className="text-[10px] text-muted-foreground">({p.type}) {p.required && "*"}:</span> {p.description}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveParam(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setShowAddTool(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleAddTool} disabled={!toolName || !toolUrl}>
                    Salvar Ferramenta
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tool List */}
          <div className="space-y-2.5">
            {config.customTools && config.customTools.length > 0 ? (
              config.customTools.map((t) => (
                <Card key={t.name} className="card-premium">
                  <CardContent className="p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="font-mono text-xs text-primary">
                          {t.name}
                        </Badge>
                        <span className="truncate text-xs text-muted-foreground font-mono">
                          {t.webhookUrl}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t.description}</p>
                      {t.parameters && t.parameters.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase">Args:</span>
                          {t.parameters.map((p) => (
                            <span key={p.name} className="text-[10px] bg-muted px-1.5 py-0.5 rounded border border-border/50 font-mono">
                              {p.name}{p.required ? "*" : ""} ({p.type})
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => handleRemoveTool(t.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))
            ) : (
              !showAddTool && (
                <p className="text-sm text-center text-muted-foreground py-8 border border-dashed rounded-lg">
                  Nenhuma ferramenta de webhook cadastrada.
                </p>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
};
