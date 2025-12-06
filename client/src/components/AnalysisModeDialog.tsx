import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Bot, 
  Sparkles, 
  ArrowRight, 
  Zap, 
  CheckCircle2,
  Clock,
  DollarSign,
  Shield,
  Layers
} from "lucide-react";

interface AnalysisModeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectMode: (mode: 'old' | 'new') => void;
  isAnalyzing?: boolean;
}

export function AnalysisModeDialog({
  open,
  onOpenChange,
  onSelectMode,
  isAnalyzing = false
}: AnalysisModeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-2xl font-bold">Choose Analysis Method</DialogTitle>
          <DialogDescription className="text-base">
            Select how you want to analyze this date. Each method uses different AI models and strategies.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-6 py-4">
          {/* OLD WAY */}
          <div
            onClick={() => !isAnalyzing && onSelectMode('old')}
            className={`
              relative flex flex-col p-6 rounded-xl border-2 transition-all cursor-pointer
              ${isAnalyzing 
                ? 'opacity-50 cursor-not-allowed border-slate-200 bg-slate-50' 
                : 'border-violet-200 bg-gradient-to-br from-violet-50 to-purple-50 hover:border-violet-300 hover:shadow-lg hover:scale-[1.02]'
              }
            `}
          >
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Layers className="w-8 h-8 text-white" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <h3 className="font-bold text-xl text-slate-900">OLD WAY</h3>
                    <Badge variant="outline" className="bg-violet-100 text-violet-700 border-violet-300 font-medium">
                      Sequential
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-4 text-xs text-slate-500">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>Faster</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <DollarSign className="w-3 h-3" />
                      <span>Lower Cost</span>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-slate-700 mb-4 leading-relaxed">
                  Sequential waterfall approach: checks Bitcoin tier first, then Crypto, then Macro. 
                  Uses OpenAI for validation. Stops at first significant finding.
                </p>
                <div className="space-y-2 mb-4">
                  <div className="flex items-start space-x-2 text-sm text-slate-600">
                    <ArrowRight className="w-4 h-4 mt-0.5 text-violet-600 flex-shrink-0" />
                    <span><strong className="text-slate-900">Step 1:</strong> Fetch Bitcoin tier → OpenAI validates → If significant, summarize and stop</span>
                  </div>
                  <div className="flex items-start space-x-2 text-sm text-slate-600">
                    <ArrowRight className="w-4 h-4 mt-0.5 text-violet-600 flex-shrink-0" />
                    <span><strong className="text-slate-900">Step 2:</strong> If nothing, fetch Crypto tier → OpenAI validates → If significant, summarize and stop</span>
                  </div>
                  <div className="flex items-start space-x-2 text-sm text-slate-600">
                    <ArrowRight className="w-4 h-4 mt-0.5 text-violet-600 flex-shrink-0" />
                    <span><strong className="text-slate-900">Step 3:</strong> If nothing, fetch Macro tier → OpenAI validates → If significant, <span className="italic">no summary</span> (macro wins)</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2 pt-3 border-t border-violet-200">
                  <Bot className="w-4 h-4 text-violet-600" />
                  <span className="text-xs text-slate-600">Uses: OpenAI only</span>
                </div>
              </div>
            </div>
            {!isAnalyzing && (
              <div className="absolute top-4 right-4">
                <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse"></div>
              </div>
            )}
          </div>

          {/* NEW WAY */}
          <div
            onClick={() => !isAnalyzing && onSelectMode('new')}
            className={`
              relative flex flex-col p-6 rounded-xl border-2 transition-all cursor-pointer
              ${isAnalyzing 
                ? 'opacity-50 cursor-not-allowed border-slate-200 bg-slate-50' 
                : 'border-blue-200 bg-gradient-to-br from-blue-50 to-cyan-50 hover:border-blue-300 hover:shadow-lg hover:scale-[1.02]'
              }
            `}
          >
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <h3 className="font-bold text-xl text-slate-900">NEW WAY</h3>
                    <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300 font-medium">
                      Parallel Battle
                    </Badge>
                    <Badge className="bg-green-100 text-green-700 border-green-300 font-medium">
                      <Shield className="w-3 h-3 mr-1" />
                      Auto-Verified
                    </Badge>
                  </div>
                  <div className="flex items-center space-x-4 text-xs text-slate-500">
                    <div className="flex items-center space-x-1">
                      <Zap className="w-3 h-3" />
                      <span>Thorough</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Verified</span>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-slate-700 mb-4 leading-relaxed">
                  Parallel battle approach: fetches all tiers simultaneously, then uses Gemini and Perplexity 
                  to independently verify articles. More thorough and automatically verified by both AI services.
                </p>
                <div className="space-y-2 mb-4">
                  <div className="flex items-start space-x-2 text-sm text-slate-600">
                    <ArrowRight className="w-4 h-4 mt-0.5 text-blue-600 flex-shrink-0" />
                    <span><strong className="text-slate-900">Step 1:</strong> Fetch all 3 tiers in parallel (Bitcoin, Crypto, Macro)</span>
                  </div>
                  <div className="flex items-start space-x-2 text-sm text-slate-600">
                    <ArrowRight className="w-4 h-4 mt-0.5 text-blue-600 flex-shrink-0" />
                    <span><strong className="text-slate-900">Step 2:</strong> Gemini and Perplexity verify articles independently (in parallel)</span>
                  </div>
                  <div className="flex items-start space-x-2 text-sm text-slate-600">
                    <ArrowRight className="w-4 h-4 mt-0.5 text-blue-600 flex-shrink-0" />
                    <span><strong className="text-slate-900">Step 3:</strong> Find intersection (articles approved by both) → OpenAI selects best → summarizes</span>
                  </div>
                </div>
                <div className="flex items-center space-x-4 pt-3 border-t border-blue-200">
                  <div className="flex items-center space-x-2">
                    <Bot className="w-4 h-4 text-blue-600" />
                    <span className="text-xs text-slate-600">Uses: Gemini + Perplexity + OpenAI</span>
                  </div>
                  <div className="flex items-center space-x-1 text-xs text-green-600 font-medium">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Automatically verified</span>
                  </div>
                </div>
              </div>
            </div>
            {!isAnalyzing && (
              <div className="absolute top-4 right-4">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)} 
            disabled={isAnalyzing}
            className="min-w-[100px]"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

