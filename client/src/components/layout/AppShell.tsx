import { useState, type ReactNode } from "react";
import { Menu, PhoneCall, BookOpen, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAuthed, clearAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import { ThemeToggle } from "./ThemeToggle";

export const AppShell = ({ children }: { children: ReactNode }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/80 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-2.5">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden" aria-label="Accounts">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="px-3 pt-3">Accounts</SheetTitle>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <PhoneCall className="h-4 w-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">RockCall</span>
        </div>
        <div className="flex items-center gap-1.5">
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
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r bg-card/30 md:block">
          <Sidebar />
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="py-6">{children}</div>
        </main>
      </div>
    </div>
  );
};
