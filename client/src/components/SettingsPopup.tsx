import { useAiProvider } from "@/hooks/useAiProvider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Settings, Bot, Star, TrendingUp, Search, Globe, Database } from "lucide-react";
import { Link } from "wouter";
import { useState, useEffect } from "react";

export function SettingsPopup() {
  const { aiProvider, setAiProvider } = useAiProvider();
  const [newsProvider, setNewsProvider] = useState<'exa'>('exa');

  // Load news provider from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('newsProvider');
    if (saved && saved === 'exa') {
      setNewsProvider('exa');
    } else {
      // Clean up old Google Search references
      localStorage.setItem('newsProvider', 'exa');
    }
  }, []);

  // Save news provider to localStorage
  const handleNewsProviderChange = (provider: 'exa') => {
    setNewsProvider(provider);
    localStorage.setItem('newsProvider', provider);
  };

  // Helper function to get AI provider icon
  const getAIProviderIcon = (provider: string) => {
    switch (provider) {
      case 'openai':
        return <Bot className="w-3 h-3" />;
      default:
        return <Bot className="w-3 h-3" />;
    }
  };

  // Helper function to get news provider icon
  const getNewsProviderIcon = (provider: string) => {
    return <Database className="w-3 h-3" />;
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm">
          <Settings className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Quick Settings</h4>
          </div>

          {/* AI Provider Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="font-medium text-sm">AI Provider</h5>
              <div className="flex items-center space-x-1">
                {getAIProviderIcon(aiProvider)}
                <span className="text-xs text-slate-600 capitalize">{aiProvider}</span>
              </div>
            </div>
            <Select value={aiProvider} onValueChange={setAiProvider}>
              <SelectTrigger className="w-full h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">
                  <div className="flex items-center space-x-2">
                    <Bot className="w-3 h-3" />
                    <span>OpenAI</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* News Provider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="font-medium text-sm">News Provider</h5>
              <div className="flex items-center space-x-1">
                {getNewsProviderIcon(newsProvider)}
              </div>
            </div>
            <div className="p-2 border rounded-lg bg-gray-50">
              <div className="flex items-center space-x-2">
                <Database className="w-3 h-3" />
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Historical Bitcoin news with advanced neural search capabilities
              </p>
            </div>
          </div>

          <Separator />

          {/* See More Settings Button */}
          <Link href="/settings">
            <Button variant="outline" size="sm" className="w-full">
              <Settings className="w-3 h-3 mr-2" />
              See more settings
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}