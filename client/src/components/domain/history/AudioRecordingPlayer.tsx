import { useState, useRef } from "react";
import { Play, Pause, Download, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const AudioRecordingPlayer = ({ recordingUrl }: { recordingUrl: string }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-2.5">
      <audio
        ref={audioRef}
        src={recordingUrl}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={() => setIsPlaying(false)}
      />

      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        className="h-8 w-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
      </Button>

      <div className="flex-1 space-y-1 min-w-0">
        <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
          <div className="flex items-center gap-1">
            <Volume2 className="h-3 w-3 text-primary" />
            <span>Gravação do Servidor</span>
          </div>
          <span>
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setCurrentTime(val);
            if (audioRef.current) audioRef.current.currentTime = val;
          }}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted-foreground/30 accent-primary"
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        asChild
        className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
        title="Baixar áudio"
      >
        <a href={recordingUrl} download>
          <Download className="h-4 w-4" />
        </a>
      </Button>
    </div>
  );
};
