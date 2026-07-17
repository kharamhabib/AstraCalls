import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";

type Props = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
};

export const EmptyState = ({ icon, title, description }: Props) => (
  <Card className="border-dashed border-primary/20 bg-muted/5 shadow-none animate-fade-in rounded-xl">
    <CardContent className="flex flex-col items-center justify-center gap-3.5 py-12 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary border border-primary/10 animate-fade-in-fast">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="font-semibold text-sm text-foreground">{title}</p>
        {description && (
          <p className="max-w-xs text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </CardContent>
  </Card>
);
