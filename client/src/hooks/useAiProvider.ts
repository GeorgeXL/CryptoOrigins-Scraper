import { useState, useEffect } from 'react';

export type AiProvider = 'openai';

const AI_PROVIDER_KEY = 'bitcoin-news-ai-provider';

export function useAiProvider() {
  const [aiProvider, setAiProviderState] = useState<AiProvider>(() => {
    // Load from localStorage on initialization
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(AI_PROVIDER_KEY);
      if (saved && ['openai'].includes(saved)) {
        return saved as AiProvider;
      }
    }
    return 'openai'; // Default
  });

  const setAiProvider = (provider: AiProvider) => {
    setAiProviderState(provider);
    // Save to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(AI_PROVIDER_KEY, provider);
    }
  };

  useEffect(() => {
    // Sync with localStorage when component mounts
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(AI_PROVIDER_KEY);
      if (saved && ['openai'].includes(saved) && saved !== aiProvider) {
        setAiProviderState(saved as AiProvider);
      }
    }
  }, [aiProvider]);

  return {
    aiProvider,
    setAiProvider
  };
}