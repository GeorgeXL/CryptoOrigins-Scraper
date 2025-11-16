export interface HistoricalPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
  searchOrder: string[];
  keywords: {
    boost: string[];
    penalty: string[];
  };
  contextPrompt: string;
  credibilityBoosts: Record<string, number>;
}

export const HISTORICAL_PERIODS: HistoricalPeriod[] = [
  {
    id: 'global-financial-crisis',
    name: 'Global Financial Crisis & Bitcoin Birth',
    startDate: '2008-01-01',
    endDate: '2009-12-31',
    description: 'Institutional failure and stimulus responses, environment that led to Bitcoin\'s creation',
    searchOrder: ['finance', 'bitcoin', 'crypto'],
    keywords: {
      boost: ['crisis', 'bailout', 'stimulus', 'monetary policy', 'banking crisis', 'recession', 'fed', 'financial system'],
      penalty: ['merger', 'entertainment', 'celebrity', 'sports']
    },
    contextPrompt: 'During the Global Financial Crisis and Bitcoin\'s birth period, prioritize macroeconomic significance, institutional failures, and monetary policy responses that created the environment for Bitcoin\'s creation.',
    credibilityBoosts: {
      'reuters.com': 0.15,
      'bloomberg.com': 0.15,
      'wsj.com': 0.15,
      'ft.com': 0.15,
      'federalreserve.gov': 0.2
    }
  },
  {
    id: 'eurozone-debt-crisis',
    name: 'Eurozone Debt Crisis & Regulatory',
    startDate: '2010-01-01',
    endDate: '2012-12-31',
    description: 'Sovereign debt crises, regulatory overhauls, early Bitcoin adoption and Mt.Gox era',
    searchOrder: ['finance', 'bitcoin', 'crypto'],
    keywords: {
      boost: ['debt crisis', 'eurozone', 'basel iii', 'dodd-frank', 'mt.gox', 'mtgox', 'early adoption', 'regulatory'],
      penalty: ['merger', 'entertainment', 'celebrity']
    },
    contextPrompt: 'During the Eurozone Debt Crisis period, focus on sovereign debt issues, regulatory responses, and early Bitcoin adoption milestones including Mt.Gox developments.',
    credibilityBoosts: {
      'reuters.com': 0.12,
      'bloomberg.com': 0.12,
      'ecb.europa.eu': 0.18,
      'bitcoinmagazine.com': 0.1
    }
  },
  {
    id: 'early-altcoin-era',
    name: 'Early Altcoin & Smart Contract Era',
    startDate: '2013-01-01',
    endDate: '2016-12-31',
    description: 'Ethereum launch, programmable blockchains, rise of alternative cryptocurrencies',
    searchOrder: ['crypto', 'bitcoin', 'finance'],
    keywords: {
      boost: ['ethereum', 'altcoin', 'smart contract', 'blockchain', 'vitalik', 'programmable', 'decentralized'],
      penalty: ['merger', 'entertainment']
    },
    contextPrompt: 'During the Early Altcoin & Smart Contract Era, prioritize blockchain innovation, Ethereum development, and the emergence of cryptocurrency ecosystem beyond Bitcoin.',
    credibilityBoosts: {
      'coindesk.com': 0.15,
      'bitcoinmagazine.com': 0.12,
      'ethereum.org': 0.15,
      'cointelegraph.com': 0.1
    }
  },
  {
    id: 'ico-boom',
    name: 'ICO Boom & Mainstream Attention',
    startDate: '2017-01-01',
    endDate: '2018-12-31',
    description: '600+ token launches, speculative wave, first major cryptocurrency mainstream adoption',
    searchOrder: ['crypto', 'bitcoin', 'finance'],
    keywords: {
      boost: ['ico', 'initial coin offering', 'token launch', 'speculative', 'mainstream', 'bubble', 'crypto winter'],
      penalty: ['merger', 'entertainment']
    },
    contextPrompt: 'During the ICO Boom period, focus on token launches, speculative activity, mainstream attention, and the subsequent market correction.',
    credibilityBoosts: {
      'coindesk.com': 0.15,
      'cointelegraph.com': 0.12,
      'theblock.co': 0.12,
      'cnbc.com': 0.1
    }
  },
  {
    id: 'defi-nft-institutional',
    name: 'DeFi/NFT Wave & Institutional Entry',
    startDate: '2020-01-01',
    endDate: '2021-12-31',
    description: 'Traditional finance meets blockchain, institutional Bitcoin adoption, DeFi protocols explosion',
    searchOrder: ['crypto', 'bitcoin', 'finance'],
    keywords: {
      boost: ['defi', 'nft', 'institutional', 'microstrategy', 'tesla', 'paypal', 'grayscale', 'etf', 'corporate treasury'],
      penalty: ['merger', 'entertainment']
    },
    contextPrompt: 'During the DeFi/NFT Wave & Institutional Entry period, prioritize institutional adoption, corporate Bitcoin strategies, DeFi innovation, and NFT market developments.',
    credibilityBoosts: {
      'coindesk.com': 0.15,
      'theblock.co': 0.15,
      'decrypt.co': 0.12,
      'bloomberg.com': 0.12,
      'wsj.com': 0.12
    }
  },
  {
    id: 'contemporary-era',
    name: 'Contemporary Era',
    startDate: '2022-01-01',
    endDate: '2030-12-31',
    description: 'Current cryptocurrency landscape, modern regulatory environment, mature institutional adoption',
    searchOrder: ['bitcoin', 'crypto', 'finance'],
    keywords: {
      boost: ['spot etf', 'bitcoin etf', 'regulatory clarity', 'cbdc', 'lightning network', 'taproot', 'ordinals'],
      penalty: ['merger', 'entertainment']
    },
    contextPrompt: 'In the Contemporary Era, focus on current regulatory developments, ETF approvals, technological improvements, and mature institutional adoption patterns.',
    credibilityBoosts: {
      'coindesk.com': 0.15,
      'theblock.co': 0.15,
      'bloomberg.com': 0.12,
      'reuters.com': 0.12,
      'wsj.com': 0.12
    }
  }
];

export class PeriodDetector {
  detectPeriod(date: string): HistoricalPeriod {
    const targetDate = new Date(date);
    
    for (const period of HISTORICAL_PERIODS) {
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      
      if (targetDate >= startDate && targetDate <= endDate) {
        return period;
      }
    }
    
    // Default to contemporary era if no match
    return HISTORICAL_PERIODS[HISTORICAL_PERIODS.length - 1];
  }
  
  getPeriodContext(date: string): {
    period: HistoricalPeriod;
    isHistorical: boolean;
    contextualKeywords: string[];
  } {
    const period = this.detectPeriod(date);
    const targetDate = new Date(date);
    const currentDate = new Date();
    const isHistorical = targetDate < new Date(currentDate.getFullYear() - 1, 0, 1);
    
    // Generate contextual keywords based on period and proximity to major events
    const contextualKeywords = [...period.keywords.boost];
    
    return {
      period,
      isHistorical,
      contextualKeywords
    };
  }
  
  getSearchStrategy(date: string): {
    searchOrder: string[];
    primaryKeywords: string[];
    secondaryKeywords: string[];
    timeWindow: number; // hours
  } {
    const { period } = this.getPeriodContext(date);
    
    return {
      searchOrder: period.searchOrder,
      primaryKeywords: period.keywords.boost,
      secondaryKeywords: ['bitcoin', 'cryptocurrency', 'blockchain'],
      timeWindow: 168 // Standard 1 week window for all dates
    };
  }
}

export const periodDetector = new PeriodDetector();