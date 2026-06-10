import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, PenLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TopicBadgeEditor } from "@/components/TopicBadgeEditor";
import { useToast } from "@/hooks/use-toast";
import { saveManualDayEntry } from "@/lib/manualDayEntry";

type ManualDayEntryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  initialSummary?: string;
  initialSourceUrl?: string;
  initialTopic?: string | null;
  onSaved?: () => void;
};

export function ManualDayEntryDialog({
  open,
  onOpenChange,
  date,
  initialSummary = "",
  initialSourceUrl = "",
  initialTopic = null,
  onSaved,
}: ManualDayEntryDialogProps) {
  const { toast } = useToast();
  const [summary, setSummary] = useState(initialSummary);
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl);
  const [topic, setTopic] = useState<string | null>(initialTopic);

  useEffect(() => {
    if (!open) return;
    setSummary(initialSummary);
    setSourceUrl(initialSourceUrl);
    setTopic(initialTopic);
  }, [open, initialSummary, initialSourceUrl, initialTopic]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveManualDayEntry({
        date,
        summary: summary.trim(),
        sourceUrl: sourceUrl.trim(),
        topic,
      }),
    onSuccess: () => {
      toast({
        title: "Manual entry saved",
        description: `${date} now uses your manual summary and source URL.`,
      });
      onOpenChange(false);
      onSaved?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Manual entry failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const summaryLength = summary.trim().length;
  const canSave = summary.trim().length >= 20 && sourceUrl.trim().length > 0 && Boolean(topic);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            Manual entry
          </DialogTitle>
          <DialogDescription>
            Set a manual summary, storyline tag, and source URL for {date}. This skips Exa article
            picking and marks the day as a manual entry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="manual-summary">Summary</Label>
            <Textarea
              id="manual-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="Write the homepage summary for this day…"
              className="min-h-[120px]"
            />
            <p className="text-xs text-muted-foreground">
              {summaryLength.toLocaleString()} characters · aim for about 100–110
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-source-url">Source URL</Label>
            <Input
              id="manual-source-url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://example.com/article"
            />
          </div>

          <div className="space-y-2">
            <Label>Storyline tag</Label>
            <TopicBadgeEditor topic={topic} onTopicChange={setTopic} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!canSave || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save manual entry"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
