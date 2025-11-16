import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface AnalysisProgress {
  id: string;
  type: 'year' | 'month' | 'batch';
  label: string;
  completed: number;
  total: number;
  currentDate?: string;
  year?: number;
  month?: number;
  abortController: AbortController;
  startTime: number;
}

interface GlobalAnalysisContextType {
  activeAnalyses: Map<string, AnalysisProgress>;
  startAnalysis: (progress: Omit<AnalysisProgress, 'startTime'>) => void;
  updateProgress: (id: string, completed: number, currentDate?: string) => void;
  stopAnalysis: (id: string) => void;
  completeAnalysis: (id: string) => void;
  getAnalysisById: (id: string) => AnalysisProgress | undefined;
  hasActiveAnalyses: boolean;
}

const GlobalAnalysisContext = createContext<GlobalAnalysisContextType | undefined>(undefined);

export function GlobalAnalysisProvider({ children }: { children: ReactNode }) {
  const [activeAnalyses, setActiveAnalyses] = useState<Map<string, AnalysisProgress>>(new Map());

  const startAnalysis = useCallback((progress: Omit<AnalysisProgress, 'startTime'>) => {
    setActiveAnalyses(prev => {
      const newMap = new Map(prev);
      newMap.set(progress.id, {
        ...progress,
        startTime: Date.now()
      });
      return newMap;
    });
  }, []);

  const updateProgress = useCallback((id: string, completed: number, currentDate?: string) => {
    setActiveAnalyses(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(id);
      if (existing) {
        newMap.set(id, {
          ...existing,
          completed,
          currentDate
        });
      }
      return newMap;
    });
  }, []);

  const stopAnalysis = useCallback((id: string) => {
    setActiveAnalyses(prev => {
      const newMap = new Map(prev);
      const analysis = newMap.get(id);
      if (analysis) {
        analysis.abortController.abort();
        newMap.delete(id);
      }
      return newMap;
    });
  }, []);

  const completeAnalysis = useCallback((id: string) => {
    setActiveAnalyses(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  }, []);

  const getAnalysisById = useCallback((id: string) => {
    return activeAnalyses.get(id);
  }, [activeAnalyses]);

  const hasActiveAnalyses = activeAnalyses.size > 0;

  return (
    <GlobalAnalysisContext.Provider value={{
      activeAnalyses,
      startAnalysis,
      updateProgress,
      stopAnalysis,
      completeAnalysis,
      getAnalysisById,
      hasActiveAnalyses
    }}>
      {children}
    </GlobalAnalysisContext.Provider>
  );
}

export function useGlobalAnalysis() {
  const context = useContext(GlobalAnalysisContext);
  if (!context) {
    throw new Error('useGlobalAnalysis must be used within GlobalAnalysisProvider');
  }
  return context;
}