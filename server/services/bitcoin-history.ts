// Historical Bitcoin events database for when contemporary sources are unavailable
export interface BitcoinHistoricalEvent {
  date: string;
  title: string;
  description: string;
  significance: string;
  category: 'technical' | 'economic' | 'adoption' | 'regulatory' | 'cultural';
  sources: string[];
  alternativeNames: string[];
}

export const BITCOIN_HISTORICAL_EVENTS: BitcoinHistoricalEvent[] = [
  {
    date: '2008-10-31',
    title: 'Bitcoin Whitepaper Published',
    description: 'Satoshi Nakamoto published the Bitcoin whitepaper titled "Bitcoin: A Peer-to-Peer Electronic Cash System" on the cryptography mailing list.',
    significance: 'The foundational document that introduced Bitcoin to the world and outlined the technical architecture of the first successful cryptocurrency.',
    category: 'technical',
    sources: ['bitcoin.org/bitcoin.pdf', 'cryptography mailing list archives'],
    alternativeNames: ['Bitcoin whitepaper', 'Satoshi paper', 'peer-to-peer electronic cash paper']
  },
  {
    date: '2009-01-03',
    title: 'Bitcoin Genesis Block Mined',
    description: 'Satoshi Nakamoto mined the first Bitcoin block (Genesis Block) with the message "The Times 03/Jan/2009 Chancellor on brink of second bailout for banks" embedded in the coinbase transaction.',
    significance: 'The birth of the Bitcoin blockchain and the first proof-of-work consensus in a cryptocurrency. The embedded message referenced the UK bank bailouts during the financial crisis.',
    category: 'technical',
    sources: ['blockchain.info', 'bitcoin source code', 'The Times newspaper'],
    alternativeNames: ['Genesis block', 'block 0', 'first block', 'Bitcoin birth']
  },
  {
    date: '2009-01-12',
    title: 'First Bitcoin Transaction',
    description: 'Satoshi Nakamoto sent 10 bitcoins to Hal Finney in the first peer-to-peer Bitcoin transaction (block 170).',
    significance: 'The first transfer of Bitcoin between two different people, proving the peer-to-peer functionality worked as designed.',
    category: 'technical',
    sources: ['blockchain records', 'Hal Finney emails', 'bitcoin forums'],
    alternativeNames: ['first transaction', 'Hal Finney transaction', 'block 170']
  },
  {
    date: '2010-05-10',
    title: 'Bitcoin Pizza Day',
    description: 'Laszlo Hanyecz paid 10,000 BTC for two Papa John\'s pizzas, marking the first known commercial transaction using Bitcoin. This established the first real-world price for Bitcoin at approximately $0.0025 per coin.',
    significance: 'The first recorded commercial use of Bitcoin for a physical good, establishing Bitcoin\'s utility as a medium of exchange and providing the first market price discovery.',
    category: 'economic',
    sources: ['bitcointalk.org forum posts', 'Laszlo Hanyecz posts', 'Bitcoin community archives'],
    alternativeNames: ['Pizza Day', 'Bitcoin pizza transaction', 'Laszlo pizza', '10000 BTC pizza', 'Papa Johns Bitcoin']
  },
  {
    date: '2012-11-28',
    title: 'First Bitcoin Halving',
    description: 'Bitcoin block reward reduced from 50 BTC to 25 BTC per block at block height 210,000, implementing the first programmed monetary policy change.',
    significance: 'The first halving event demonstrated Bitcoin\'s deflationary monetary policy working as designed, reducing new supply issuance and potentially affecting price dynamics.',
    category: 'technical',
    sources: ['blockchain records', 'Bitcoin Core documentation', 'mining pool data'],
    alternativeNames: ['halving', 'halvening', 'reward halving', 'first halving']
  },
  {
    date: '2016-07-09',
    title: 'Second Bitcoin Halving',
    description: 'Bitcoin block reward reduced from 25 BTC to 12.5 BTC per block at block height 420,000, continuing the programmed scarcity mechanism.',
    significance: 'The second halving further reduced Bitcoin inflation rate and demonstrated the network\'s continued operation of its monetary policy, with increased mining difficulty and hash rate.',
    category: 'technical',
    sources: ['blockchain records', 'Bitcoin Core documentation', 'mining analytics'],
    alternativeNames: ['halving', 'halvening', 'second halving', '2016 halving']
  },
  {
    date: '2017-08-01',
    title: 'Bitcoin Cash Fork (SegWit2x Controversy)',
    description: 'Bitcoin underwent its first major contentious hard fork, creating Bitcoin Cash as miners and users disagreed on scaling solutions.',
    significance: 'This fork tested Bitcoin\'s governance model and demonstrated how the community resolves technical disagreements, while also creating the first major Bitcoin variant.',
    category: 'technical',
    sources: ['Bitcoin Core releases', 'mining pool announcements', 'exchange listings'],
    alternativeNames: ['Bitcoin Cash fork', 'BCH fork', 'scaling debate resolution', 'hard fork']
  },
  {
    date: '2020-05-11',
    title: 'Third Bitcoin Halving',
    description: 'Bitcoin block reward reduced from 12.5 BTC to 6.25 BTC per block at block height 630,000, occurring during global economic uncertainty.',
    significance: 'The third halving occurred during COVID-19 pandemic and global monetary expansion, positioning Bitcoin as a potential hedge against inflation and demonstrating its continued scarcity mechanism.',
    category: 'technical',
    sources: ['blockchain records', 'Bitcoin Core documentation', 'economic analysis'],
    alternativeNames: ['halving', 'halvening', 'third halving', '2020 halving']
  },
  {
    date: '2021-09-07',
    title: 'El Salvador Adopts Bitcoin as Legal Tender',
    description: 'El Salvador became the first country to adopt Bitcoin as legal tender alongside the US dollar, making Bitcoin acceptance mandatory for businesses.',
    significance: 'Historic milestone as the first nation-state to give Bitcoin equal legal status with fiat currency, potentially inspiring other countries and legitimizing Bitcoin globally.',
    category: 'adoption',
    sources: ['El Salvador government announcements', 'Bitcoin Law document', 'international news'],
    alternativeNames: ['El Salvador Bitcoin Law', 'Bitcoin legal tender', 'national Bitcoin adoption']
  },
  {
    date: '2021-11-14',
    title: 'Taproot Activation',
    description: 'Bitcoin\'s most significant protocol upgrade since SegWit activated at block height 709,632, introducing Schnorr signatures and improved smart contract capabilities.',
    significance: 'Major technical advancement enabling more private and efficient transactions, better smart contracts, and laying groundwork for future Lightning Network improvements.',
    category: 'technical',
    sources: ['Bitcoin Core releases', 'BIP documentation', 'developer communications'],
    alternativeNames: ['Taproot upgrade', 'Schnorr signatures', 'BIP 340/341/342', 'protocol upgrade']
  },
  {
    date: '2022-04-27',
    title: 'Central African Republic Adopts Bitcoin',
    description: 'Central African Republic became the second country to adopt Bitcoin as legal tender, following El Salvador\'s lead in national Bitcoin adoption.',
    significance: 'Demonstrated growing trend of developing nations considering Bitcoin as legal tender, expanding global Bitcoin legitimacy beyond El Salvador.',
    category: 'adoption',
    sources: ['CAR government announcements', 'African Union responses', 'international media'],
    alternativeNames: ['CAR Bitcoin adoption', 'Central African Republic legal tender', 'African Bitcoin adoption']
  },
  {
    date: '2020-08-11',
    title: 'MicroStrategy First Bitcoin Purchase',
    description: 'MicroStrategy became the first publicly traded company to adopt Bitcoin as primary treasury reserve asset, purchasing $250 million in Bitcoin.',
    significance: 'Pioneered corporate Bitcoin adoption strategy, demonstrating Bitcoin as digital gold and treasury asset, inspiring other corporations to follow suit.',
    category: 'adoption',
    sources: ['MicroStrategy SEC filings', 'corporate announcements', 'financial press'],
    alternativeNames: ['MicroStrategy Bitcoin', 'corporate treasury Bitcoin', 'MSTR Bitcoin strategy']
  },
  {
    date: '2021-02-08',
    title: 'Tesla Announces $1.5B Bitcoin Purchase',
    description: 'Tesla disclosed purchasing $1.5 billion in Bitcoin and announced plans to accept Bitcoin for vehicle payments, marking major Fortune 500 adoption.',
    significance: 'Massive mainstream validation from world\'s most valuable automaker, triggering corporate FOMO and demonstrating Bitcoin\'s acceptance by innovative tech companies.',
    category: 'adoption',
    sources: ['Tesla SEC 10-K filing', 'Elon Musk announcements', 'financial media'],
    alternativeNames: ['Tesla Bitcoin', 'TSLA Bitcoin purchase', 'Elon Musk Bitcoin']
  },
  {
    date: '2021-01-11',
    title: 'Bitcoin ETF Applications Surge',
    description: 'Multiple major financial institutions filed Bitcoin ETF applications with SEC, including VanEck, Valkyrie, and others, signaling institutional demand.',
    significance: 'Demonstrated growing institutional infrastructure development and regulatory acceptance pathway for Bitcoin investment products.',
    category: 'adoption',
    sources: ['SEC filings', 'ETF provider announcements', 'regulatory documents'],
    alternativeNames: ['Bitcoin ETF filings', 'institutional ETF applications', 'SEC Bitcoin ETF']
  },
  {
    date: '2024-01-10',
    title: 'Bitcoin Spot ETF Approval',
    description: 'SEC approved first Bitcoin spot ETFs from BlackRock, Fidelity, and other major asset managers, enabling direct Bitcoin exposure for traditional investors.',
    significance: 'Historic regulatory milestone providing mainstream investment access to Bitcoin, potentially bringing trillions in traditional capital to Bitcoin markets.',
    category: 'adoption',
    sources: ['SEC approval announcements', 'ETF provider statements', 'regulatory documents'],
    alternativeNames: ['Bitcoin ETF approval', 'spot Bitcoin ETF', 'BlackRock Bitcoin ETF', 'IBIT launch']
  },
  {
    date: '2024-04-20',
    title: 'Fourth Bitcoin Halving',
    description: 'Bitcoin block reward reduced from 6.25 BTC to 3.125 BTC per block at block height 840,000, occurring amid institutional adoption wave.',
    significance: 'The fourth halving occurred during unprecedented institutional adoption, with Bitcoin ETFs approved and major corporations holding Bitcoin, potentially amplifying scarcity effects.',
    category: 'technical',
    sources: ['blockchain records', 'Bitcoin Core documentation', 'institutional analysis'],
    alternativeNames: ['halving', 'halvening', 'fourth halving', '2024 halving']
  },
  {
    date: '2010-07-17',
    title: 'First Bitcoin Exchange (Mt. Gox)',
    description: 'Mt. Gox, originally a Magic: The Gathering trading card exchange, began operating as a Bitcoin exchange, becoming the first major Bitcoin trading platform.',
    significance: 'Established the first significant Bitcoin exchange, enabling price discovery and easier Bitcoin trading for early adopters.',
    category: 'economic',
    sources: ['Mt. Gox archives', 'Bitcoin forum discussions', 'early trader accounts'],
    alternativeNames: ['Mt. Gox launch', 'first Bitcoin exchange', 'Magic The Gathering Online eXchange']
  },
  {
    date: '2010-12-07',
    title: 'WikiLeaks Bitcoin Donations',
    description: 'WikiLeaks began accepting Bitcoin donations after being cut off from traditional payment processors, bringing Bitcoin to mainstream attention.',
    significance: 'First major organization to use Bitcoin for censorship-resistant payments, demonstrating Bitcoin\'s utility for financial sovereignty.',
    category: 'adoption',
    sources: ['WikiLeaks announcements', 'news reports', 'Bitcoin community discussions'],
    alternativeNames: ['WikiLeaks Bitcoin', 'censorship resistance', 'Julian Assange Bitcoin']
  }
];

export class BitcoinHistoryService {
  getEventByDate(date: string): BitcoinHistoricalEvent | undefined {
    return BITCOIN_HISTORICAL_EVENTS.find(event => event.date === date);
  }

  getEventsInRange(startDate: string, endDate: string): BitcoinHistoricalEvent[] {
    return BITCOIN_HISTORICAL_EVENTS.filter(event => 
      event.date >= startDate && event.date <= endDate
    );
  }

  searchEvents(query: string): BitcoinHistoricalEvent[] {
    const normalizedQuery = query.toLowerCase();
    return BITCOIN_HISTORICAL_EVENTS.filter(event => 
      event.title.toLowerCase().includes(normalizedQuery) ||
      event.description.toLowerCase().includes(normalizedQuery) ||
      event.alternativeNames.some(name => name.toLowerCase().includes(normalizedQuery))
    );
  }

  generateHistoricalContext(date: string): {
    hasEvent: boolean;
    event?: BitcoinHistoricalEvent;
    contextualSummary?: string;
  } {
    const event = this.getEventByDate(date);
    
    if (event) {
      const contextualSummary = `${event.title}: ${event.description} This event was significant because ${event.significance.toLowerCase()}`;
      
      return {
        hasEvent: true,
        event,
        contextualSummary
      };
    }

    // Check for anniversaries (same month and day in different years)
    const targetDate = new Date(date);
    const targetMonth = targetDate.getMonth();
    const targetDay = targetDate.getDate();
    
    for (const historicalEvent of BITCOIN_HISTORICAL_EVENTS) {
      const eventDate = new Date(historicalEvent.date);
      const eventMonth = eventDate.getMonth();
      const eventDay = eventDate.getDate();
      
      // Check if this is an anniversary (same month/day, different year)
      if (eventMonth === targetMonth && eventDay === targetDay && eventDate.getFullYear() !== targetDate.getFullYear()) {
        const yearsAgo = targetDate.getFullYear() - eventDate.getFullYear();
        
        if (yearsAgo > 0) {
          const ordinal = this.getOrdinal(yearsAgo);
          const anniversaryEvent = {
            ...historicalEvent,
            title: `${historicalEvent.title} (${ordinal} Anniversary)`,
            description: `${yearsAgo} years ago on this date: ${historicalEvent.description}`,
            significance: `This marks the ${ordinal} anniversary of a pivotal moment in Bitcoin history. ${historicalEvent.significance}`
          };
          
          return {
            hasEvent: true,
            event: anniversaryEvent,
            contextualSummary: `🎉 TODAY IS A HISTORIC BITCOIN ANNIVERSARY! ${yearsAgo} years ago on ${historicalEvent.date}: ${historicalEvent.title}. ${historicalEvent.significance}`
          };
        }
      }
    }

    // Check for nearby events (within 7 days)
    const nearbyEvents = BITCOIN_HISTORICAL_EVENTS.filter(event => {
      const eventDate = new Date(event.date);
      const daysDiff = Math.abs((targetDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
      return daysDiff <= 7;
    });

    if (nearbyEvents.length > 0) {
      const nearestEvent = nearbyEvents[0];
      const eventDate = new Date(nearestEvent.date);
      const daysDiff = Math.ceil((targetDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24));
      const timeRef = daysDiff > 0 ? `${daysDiff} days after` : `${Math.abs(daysDiff)} days before`;
      
      return {
        hasEvent: false,
        contextualSummary: `This date was ${timeRef} ${nearestEvent.title} (${nearestEvent.date}), a significant ${nearestEvent.category} milestone in Bitcoin's early history.`
      };
    }

    return { hasEvent: false };
  }

  private getOrdinal(num: number): string {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const remainder = num % 100;
    
    if (remainder >= 11 && remainder <= 13) {
      return num + 'th';
    }
    
    const lastDigit = num % 10;
    const suffix = suffixes[lastDigit] || suffixes[0];
    return num + suffix;
  }
}

export const bitcoinHistory = new BitcoinHistoryService();