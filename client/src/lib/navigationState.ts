/**
 * Utility functions for preserving navigation state when navigating to day view
 */

export interface HomePageState {
  page: 'home' | 'events-manager' | 'tags-browser';
  selectedEntities: Set<string>;
  showUntagged: boolean;
  searchQuery: string;
  currentPage: number;
  pageSize: number;
  viewMode: 'keywords' | 'topics';
  // EventsManager-specific fields
  selectedQualityCheck?: string | null;
  selectedVeriBadge?: string | null;
  qualityCheckPage?: number;
}

export interface MonthlyViewState {
  page: 'monthly';
  selectedYear: number | null;
  selectedMonth: number | null;
  currentPage: number;
  pageSize: number;
}

/**
 * Serialize page state to URL search params
 */
export function serializePageState(state: HomePageState | MonthlyViewState): string {
  const params = new URLSearchParams();
  
  if (state.page === 'monthly') {
    params.set('from', 'monthly');
    if (state.selectedYear) params.set('year', state.selectedYear.toString());
    if (state.selectedMonth) params.set('month', state.selectedMonth.toString());
    params.set('page', state.currentPage.toString());
    params.set('pageSize', state.pageSize.toString());
  } else {
    params.set('from', state.page);
    if (state.selectedEntities.size > 0) {
      params.set('entities', Array.from(state.selectedEntities).join(','));
    }
    if (state.showUntagged) {
      params.set('untagged', '1');
    }
    if (state.searchQuery) {
      params.set('search', state.searchQuery);
    }
    params.set('page', state.currentPage.toString());
    params.set('pageSize', state.pageSize.toString());
    params.set('viewMode', state.viewMode);
    // EventsManager-specific fields
    if (state.page === 'events-manager') {
      if (state.selectedQualityCheck) {
        params.set('qualityCheck', state.selectedQualityCheck);
      }
      if (state.selectedVeriBadge) {
        params.set('veriBadge', state.selectedVeriBadge);
      }
      if (state.qualityCheckPage) {
        params.set('qualityCheckPage', state.qualityCheckPage.toString());
      }
    }
  }
  
  return params.toString();
}

/**
 * Deserialize URL search params to page state
 */
export function deserializePageState(searchParams: URLSearchParams): Partial<HomePageState | MonthlyViewState> | null {
  const from = searchParams.get('from');
  
  // If 'from' is 'monthly', it's monthly view
  if (from === 'monthly') {
    const year = searchParams.get('year');
    const month = searchParams.get('month');
    return {
      page: 'monthly',
      selectedYear: year ? parseInt(year, 10) : null,
      selectedMonth: month ? parseInt(month, 10) : null,
      currentPage: parseInt(searchParams.get('page') || '1', 10),
      pageSize: parseInt(searchParams.get('pageSize') || '50', 10),
    } as MonthlyViewState;
  }
  
  // If 'from' is specified and is a known page type, use it
  if (from === 'home' || from === 'events-manager' || from === 'tags-browser') {
    const entities = searchParams.get('entities');
    const state: HomePageState = {
      page: from as 'home' | 'events-manager' | 'tags-browser',
      selectedEntities: entities ? new Set(entities.split(',')) : new Set(),
      showUntagged: searchParams.get('untagged') === '1',
      searchQuery: searchParams.get('search') || '',
      currentPage: parseInt(searchParams.get('page') || '1', 10),
      pageSize: parseInt(searchParams.get('pageSize') || '50', 10),
      viewMode: (searchParams.get('viewMode') || 'keywords') as 'keywords' | 'topics',
    };
    // EventsManager-specific fields
    if (from === 'events-manager') {
      const qualityCheck = searchParams.get('qualityCheck');
      const veriBadge = searchParams.get('veriBadge');
      const qualityCheckPage = searchParams.get('qualityCheckPage');
      if (qualityCheck) state.selectedQualityCheck = qualityCheck;
      if (veriBadge) state.selectedVeriBadge = veriBadge;
      if (qualityCheckPage) state.qualityCheckPage = parseInt(qualityCheckPage, 10);
    }
    return state;
  }
  
  // If no 'from' parameter, determine page type from pathname or specific params
  if (!from) {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    const hasEventsManagerParams = searchParams.has('qualityCheck') || searchParams.has('veriBadge') || searchParams.has('qualityCheckPage');
    
    // If we're on /events-manager path or have EventsManager-specific params, treat as events-manager
    if (pathname === '/events-manager' || hasEventsManagerParams) {
      const entities = searchParams.get('entities');
      const state: HomePageState = {
        page: 'events-manager',
        selectedEntities: entities ? new Set(entities.split(',')) : new Set(),
        showUntagged: searchParams.get('untagged') === '1',
        searchQuery: searchParams.get('search') || '',
        currentPage: parseInt(searchParams.get('page') || '1', 10),
        pageSize: parseInt(searchParams.get('pageSize') || '50', 10),
        viewMode: (searchParams.get('viewMode') || 'keywords') as 'keywords' | 'topics',
      };
      // EventsManager-specific fields
      const qualityCheck = searchParams.get('qualityCheck');
      const veriBadge = searchParams.get('veriBadge');
      const qualityCheckPage = searchParams.get('qualityCheckPage');
      if (qualityCheck) state.selectedQualityCheck = qualityCheck;
      if (veriBadge) state.selectedVeriBadge = veriBadge;
      if (qualityCheckPage) state.qualityCheckPage = parseInt(qualityCheckPage, 10);
      return state;
    }
    
    // Otherwise, if we have homepage-related params, treat as homepage
    // This handles URLs without 'from=home' (which should be the default for homepage)
    if (searchParams.has('entities') || searchParams.has('untagged') || searchParams.has('search') || searchParams.has('page') || searchParams.has('viewMode')) {
      const entities = searchParams.get('entities');
      const state: HomePageState = {
        page: 'home',
        selectedEntities: entities ? new Set(entities.split(',')) : new Set(),
        showUntagged: searchParams.get('untagged') === '1',
        searchQuery: searchParams.get('search') || '',
        currentPage: parseInt(searchParams.get('page') || '1', 10),
        pageSize: parseInt(searchParams.get('pageSize') || '50', 10),
        viewMode: (searchParams.get('viewMode') || 'keywords') as 'keywords' | 'topics',
      };
      return state;
    }
  }
  
  return null;
}

/**
 * Reconstruct the previous page URL from state
 */
export function reconstructPageUrl(state: HomePageState | MonthlyViewState): string {
  if (state.page === 'monthly') {
    const params = new URLSearchParams();
    if (state.selectedYear) params.set('year', state.selectedYear.toString());
    if (state.selectedMonth) params.set('month', state.selectedMonth.toString());
    params.set('page', state.currentPage.toString());
    params.set('pageSize', state.pageSize.toString());
    const query = params.toString();
    return `/monthly${query ? `?${query}` : ''}`;
  } else {
    const params = new URLSearchParams();
    if (state.selectedEntities.size > 0) {
      params.set('entities', Array.from(state.selectedEntities).join(','));
    }
    if (state.showUntagged) {
      params.set('untagged', '1');
    }
    if (state.searchQuery) {
      params.set('search', state.searchQuery);
    }
    params.set('page', state.currentPage.toString());
    params.set('pageSize', state.pageSize.toString());
    params.set('viewMode', state.viewMode);
    // EventsManager-specific fields
    if (state.page === 'events-manager') {
      if (state.selectedQualityCheck) {
        params.set('qualityCheck', state.selectedQualityCheck);
      }
      if (state.selectedVeriBadge) {
        params.set('veriBadge', state.selectedVeriBadge);
      }
      if (state.qualityCheckPage) {
        params.set('qualityCheckPage', state.qualityCheckPage.toString());
      }
    }
    const query = params.toString();
    const basePath = state.page === 'home' ? '/' : `/${state.page}`;
    return `${basePath}${query ? `?${query}` : ''}`;
  }
}

