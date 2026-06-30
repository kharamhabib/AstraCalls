import { Mic, Volume2, Sun, Moon, Monitor } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAudioDevices } from "@/hooks/useAudioDevices";
import { useDevices } from "@/stores/devices";
import { useTheme } from "@/stores/theme";

const selectClass = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
  "transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
);

type ThemeMode = "light" | "dark" | "system";

export const GeneralSettingsPane = () => {
  const { mics, outs } = useAudioDevices();
  const micId = useDevices((s) => s.micId);
  const outId = useDevices((s) => s.outId);
  const setMic = useDevices((s) => s.setMic);
  const setOut = useDevices((s) => s.setOut);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Claro", icon: Sun },
    { value: "dark", label: "Escuro", icon: Moon },
    { value: "system", label: "Sistema", icon: Monitor },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Audio Devices */}
      <div className="px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Dispositivos de Áudio
        </p>
      </div>

      <Card className="card-premium">
        <CardContent className="p-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 text-sm">
              <Mic className="h-4 w-4 text-muted-foreground" />
              Microfone
            </Label>
            <select value={micId ?? ""} onChange={(e) => setMic(e.target.value)} className={selectClass}>
              <option value="">Microfone padrão</option>
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 text-sm">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              Alto-falante
            </Label>
            <select value={outId ?? ""} onChange={(e) => setOut(e.target.value)} className={selectClass}>
              <option value="">Alto-falante padrão</option>
              {outs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Theme */}
      <div className="px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Aparência
        </p>
      </div>

      <Card className="card-premium">
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((opt) => {
              const Icon = opt.icon;
              const isActive = theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Language (placeholder for future i18n) */}
      <div className="px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Idioma da Interface
        </p>
      </div>

      <Card className="card-premium">
        <CardContent className="p-4">
          <select className={selectClass} defaultValue="pt-BR">
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US" disabled>English (em breve)</option>
            <option value="es-ES" disabled>Español (em breve)</option>
          </select>
        </CardContent>
      </Card>
    </div>
  );
};
