import { useEffect, useState } from "react";
import { Star, ThumbsUp, Minus, ThumbsDown } from "lucide-react";
import { getNPSSummary, getNPSRatings } from "@/services/ai";
import type { NPSSummary, CallRating } from "@/types/ai";
import { cn } from "@/lib/utils";

export const NPSDashboard = ({ sid }: { sid: string }) => {
  const [summary, setSummary] = useState<NPSSummary | null>(null);
  const [ratings, setRatings] = useState<CallRating[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sid) return;
    setLoading(true);
    Promise.all([getNPSSummary(sid), getNPSRatings(sid)])
      .then(([sRes, rRes]) => {
        setSummary(sRes.summary);
        setRatings(rRes.ratings);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sid]);

  if (loading) {
    return <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">Carregando dados de NPS...</div>;
  }

  const score = summary ? Math.round(summary.npsScore) : 0;
  const scoreColor =
    score >= 50
      ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10"
      : score >= 0
      ? "text-amber-500 border-amber-500/30 bg-amber-500/10"
      : "text-red-500 border-red-500/30 bg-red-500/10";

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {/* Main Score Card */}
        <div className={cn("rounded-2xl border p-5 text-center flex flex-col items-center justify-center", scoreColor)}>
          <span className="text-xs font-bold uppercase tracking-wider">NPS Score</span>
          <p className="mt-2 text-4xl font-black">{summary && summary.total > 0 ? `${score}` : "N/A"}</p>
          <p className="mt-1 text-[11px] opacity-80">
            {score >= 50 ? "Excelente" : score >= 0 ? "Razoável" : "Crítico"}
          </p>
        </div>

        {/* Promoters */}
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between text-emerald-500">
            <span className="text-xs font-semibold text-muted-foreground">Promotores (9-10)</span>
            <ThumbsUp className="h-4 w-4" />
          </div>
          <p className="mt-3 text-2xl font-bold">{summary?.promoters || 0}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {summary && summary.total > 0 ? `${Math.round((summary.promoters / summary.total) * 100)}%` : "0%"}
          </p>
        </div>

        {/* Neutrals */}
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between text-amber-500">
            <span className="text-xs font-semibold text-muted-foreground">Neutros (7-8)</span>
            <Minus className="h-4 w-4" />
          </div>
          <p className="mt-3 text-2xl font-bold">{summary?.neutrals || 0}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {summary && summary.total > 0 ? `${Math.round((summary.neutrals / summary.total) * 100)}%` : "0%"}
          </p>
        </div>

        {/* Detractors */}
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between text-red-500">
            <span className="text-xs font-semibold text-muted-foreground">Detratores (0-6)</span>
            <ThumbsDown className="h-4 w-4" />
          </div>
          <p className="mt-3 text-2xl font-bold text-red-500">{summary?.detractors || 0}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {summary && summary.total > 0 ? `${Math.round((summary.detractors / summary.total) * 100)}%` : "0%"}
          </p>
        </div>
      </div>

      {/* Ratings History List */}
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          <span>Avaliações Recebidas ({ratings.length})</span>
        </h3>

        <div className="space-y-2.5">
          {ratings.map((r) => {
            const badgeClass =
              r.score >= 9
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : r.score >= 7
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400";
            return (
              <div key={r.id} className="flex items-center justify-between rounded-xl border bg-muted/20 p-3.5">
                <div className="flex items-center gap-3">
                  <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl font-black text-sm", badgeClass)}>
                    {r.score}
                  </span>
                  <div>
                    <p className="text-xs font-semibold">+{r.phone}</p>
                    <p className="text-[11px] text-muted-foreground">Chamada ID: {r.callId}</p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>
            );
          })}

          {ratings.length === 0 && (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhuma avaliação NPS registrada até o momento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
