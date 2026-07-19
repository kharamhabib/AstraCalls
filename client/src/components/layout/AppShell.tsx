import { useState, type ReactNode } from "react";
import { Menu, BookOpen, LogOut, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAuthed, clearAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { useSessions, setActiveSession } from "@/stores/sessions";
import { useNavigation } from "@/stores/navigation";
import { cn } from "@/lib/utils";

const sectionTitles: Record<string, string> = {
  dashboard: "Painel do Agente",
  connections: "Conexões WhatsApp",
  calls: "Central de Chamadas & Webphone",
  schedules: "Agendamentos de Ligações IA",
  settings: "Ajustes & IA",
};

export const AppShell = ({ children }: { children: ReactNode }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { activeSection } = useNavigation();
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const activeSession = sessions.find((s) => s.id === activeId);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop Sidebar (Left Fixo) */}
      <aside className="hidden w-64 shrink-0 border-r bg-card/40 md:block">
        <Sidebar />
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="md:hidden" aria-label="Menu">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <SheetTitle className="sr-only">Navegação Principal</SheetTitle>
                <Sidebar onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <h2 className="text-base font-bold tracking-tight text-foreground">
              {sectionTitles[activeSection] || "AstraCall"}
            </h2>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2">
            {/* Account Switcher Dropdown */}
            {sessions.length > 0 && (
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="h-9 gap-2 rounded-xl bg-card/60 px-3 text-xs font-semibold"
                >
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      activeSession?.state === "open"
                        ? "bg-emerald-500"
                        : activeSession?.state === "qr"
                        ? "bg-amber-500"
                        : "bg-red-500",
                    )}
                  />
                  <span className="max-w-[120px] truncate">{activeSession?.name || "Selecione Conta"}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>

                {dropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                    <div className="absolute right-0 top-11 z-50 w-56 rounded-xl border bg-popover p-1.5 shadow-xl animate-in fade-in-80">
                      <p className="px-2 py-1 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        Contas WhatsApp
                      </p>
                      <div className="space-y-0.5">
                        {sessions.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => {
                              setActiveSession(s.id);
                              setDropdownOpen(false);
                            }}
                            className={cn(
                              "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors",
                              s.id === activeId ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/60",
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full shrink-0",
                                  s.state === "open" ? "bg-emerald-500" : s.state === "qr" ? "bg-amber-500" : "bg-red-500",
                                )}
                              />
                              <span className="truncate">{s.name}</span>
                            </div>
                            {s.id === activeId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
              <a href="/api-docs.html" target="_blank" rel="noopener noreferrer" aria-label="API documentation">
                <BookOpen className="h-4 w-4" />
                <span className="hidden sm:inline">API</span>
              </a>
            </Button>
            <ThemeToggle />
            {isAuthed() && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Sair"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  clearAuth();
                  location.reload();
                }}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>

        {/* Scrollable Page Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
          {children}
        </main>
      </div>
    </div>
  );
};
