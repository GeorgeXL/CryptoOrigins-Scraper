export interface QualityIssue {
  type: 'TOO_SHORT' | 'TOO_LONG' | 'EXCESSIVE_DOTS' | 'GENERIC_FALLBACK' | 'REPEATED_WORDS' | 'PLACEHOLDER_TEXT' | 'DUPLICATE_SUMMARY' | 'SIMILAR_SUMMARY' | 'INVALID_LINKS';
  message: string;
  severity: 'low' | 'medium' | 'high';
  details?: any; // For storing additional data like invalid URLs
}

export interface QualityResults {
  qualityIssues: Map<string, QualityIssue[]>;
  affectedDates: string[];
  totalIssues: number;
  summary: {
    tooShort: number;
    tooLong: number;
    excessiveDots: number;
    genericFallback: number;
    repeatedWords: number;
    placeholderText: number;
    duplicateSummaries: number;
    similarSummaries: number;
    invalidLinks: number;
  };
}

export class QualityCheckerService {
  private static readonly MIN_LENGTH = 100;
  private static readonly MAX_LENGTH = 110;
  private static readonly DOT_PATTERN = /\.{2,}/;
  private static readonly SIMILARITY_THRESHOLD = 0.8; // 80% similarity threshold
  private static readonly GENERIC_PATTERNS = [
    /significant development.*cryptocurrency market/i,
    /major.*cryptocurrency.*development/i,
    /cryptocurrency.*market.*update/i,
    /bitcoin.*market.*analysis/i
  ];
  private static readonly PLACEHOLDER_PATTERNS = [
    /\.{10,}/, // 10+ dots
    /\.{3,}.*\.{3,}/, // Multiple dot groups
    /^[^a-zA-Z]*$/, // Only non-letters
    /^.{1,20}\.{5,}$/ // Short text followed by many dots
  ];

  checkSummaryQuality(summary: string): QualityIssue[] {
    const issues: QualityIssue[] = [];

    // Length validation
    if (summary.length <= QualityCheckerService.MIN_LENGTH) {
      issues.push({
        type: 'TOO_SHORT',
        message: `Summary too short (${summary.length} chars, minimum ${QualityCheckerService.MIN_LENGTH})`,
        severity: 'high'
      });
    }

    if (summary.length > QualityCheckerService.MAX_LENGTH) {
      issues.push({
        type: 'TOO_LONG',
        message: `Summary too long (${summary.length} chars, maximum ${QualityCheckerService.MAX_LENGTH})`,
        severity: 'high'
      });
    }

    // Content validation
    if (QualityCheckerService.DOT_PATTERN.test(summary)) {
      issues.push({
        type: 'EXCESSIVE_DOTS',
        message: 'Summary contains 2+ consecutive dots',
        severity: 'medium'
      });
    }

    // Check for generic fallback patterns
    for (const pattern of QualityCheckerService.GENERIC_PATTERNS) {
      if (pattern.test(summary)) {
        issues.push({
          type: 'GENERIC_FALLBACK',
          message: 'Summary contains generic fallback pattern',
          severity: 'medium'
        });
        break;
      }
    }

    // Check for repeated words
    const words = summary.toLowerCase().split(/\s+/);
    const wordCount = new Map<string, number>();
    for (const word of words) {
      if (word.length > 3) { // Only check words longer than 3 chars
        wordCount.set(word, (wordCount.get(word) || 0) + 1);
      }
    }
    
    for (const [word, count] of wordCount) {
      if (count >= 3) {
        issues.push({
          type: 'REPEATED_WORDS',
          message: `Word "${word}" repeated ${count} times`,
          severity: 'low'
        });
        break;
      }
    }

    // Check for placeholder text
    for (const pattern of QualityCheckerService.PLACEHOLDER_PATTERNS) {
      if (pattern.test(summary)) {
        issues.push({
          type: 'PLACEHOLDER_TEXT',
          message: 'Summary appears to be placeholder text',
          severity: 'high'
        });
        break;
      }
    }

    return issues;
  }

  /**
   * Check if URLs from article data are accessible
   */
  async checkArticleLinks(tieredArticles: any, analyzedArticles: any): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = [];
    const invalidUrls: string[] = [];
    const urlsToCheck = new Set<string>();

    // Extract URLs from tieredArticles
    if (tieredArticles) {
      const extractUrlsFromTier = (tierData: any[]) => {
        if (Array.isArray(tierData)) {
          tierData.forEach(article => {
            if (article?.url && typeof article.url === 'string') {
              urlsToCheck.add(article.url);
            }
          });
        }
      };

      // Check all tiers
      if (tieredArticles.bitcoin) extractUrlsFromTier(tieredArticles.bitcoin);
      if (tieredArticles.crypto) extractUrlsFromTier(tieredArticles.crypto);
      if (tieredArticles.macro) extractUrlsFromTier(tieredArticles.macro);
    }

    // Extract URLs from analyzedArticles (legacy support)
    if (analyzedArticles && Array.isArray(analyzedArticles)) {
      analyzedArticles.forEach(article => {
        if (article?.url && typeof article.url === 'string') {
          urlsToCheck.add(article.url);
        }
      });
    }

    // Test each unique URL
    for (const url of urlsToCheck) {
      try {
        const isValid = await this.testUrlAccessibility(url);
        if (!isValid) {
          invalidUrls.push(url);
        }
      } catch (error) {
        console.warn(`URL check failed for ${url}:`, error);
        invalidUrls.push(url);
      }
    }

    if (invalidUrls.length > 0) {
      issues.push({
        type: 'INVALID_LINKS',
        message: `${invalidUrls.length} invalid or inaccessible link(s) found`,
        severity: 'medium',
        details: { invalidUrls }
      });
    }

    return issues;
  }

  /**
   * Test if a URL is accessible
   */
  private async testUrlAccessibility(url: string): Promise<boolean> {
    try {
      // Basic URL validation
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        return false;
      }

      // Make HEAD request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(url, {
        method: 'HEAD', // Use HEAD to avoid downloading content
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Bitcoin-News-Bot/1.0)',
          'Accept': '*/*'
        }
      });

      clearTimeout(timeoutId);

      // Check if response is successful (2xx status codes)
      return response.ok && response.status >= 200 && response.status < 300;
    } catch (error) {
      // Network errors, timeouts, etc.
      return false;
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    
    // Create matrix
    const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));
    
    // Initialize first row and column
    for (let i = 0; i <= len1; i++) matrix[0][i] = i;
    for (let j = 0; j <= len2; j++) matrix[j][0] = j;
    
    // Calculate distances
    for (let j = 1; j <= len2; j++) {
      for (let i = 1; i <= len1; i++) {
        const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j - 1][i] + 1,     // deletion
          matrix[j][i - 1] + 1,     // insertion
          matrix[j - 1][i - 1] + substitutionCost // substitution
        );
      }
    }
    
    const maxLength = Math.max(len1, len2);
    const levenshteinDistance = matrix[len2][len1];
    
    // Return similarity ratio (1.0 = identical, 0.0 = completely different)
    return maxLength === 0 ? 1.0 : (maxLength - levenshteinDistance) / maxLength;
  }

  async checkMonthQuality(analyses: any[]): Promise<QualityResults> {
    const qualityIssues = new Map<string, QualityIssue[]>();
    const affectedDates: string[] = [];
    const summary = {
      tooShort: 0,
      tooLong: 0,
      excessiveDots: 0,
      genericFallback: 0,
      repeatedWords: 0,
      placeholderText: 0,
      duplicateSummaries: 0,
      similarSummaries: 0,
      invalidLinks: 0
    };

    for (const analysis of analyses) {
      if (!analysis.summary || !analysis.analysisDate) continue;

      console.log(`🔍 Checking analysis for ${analysis.analysisDate}: "${analysis.summary}" (${analysis.summary.length} chars)`);
      const summaryIssues = this.checkSummaryQuality(analysis.summary);
      
      // Check URLs if available
      const linkIssues = await this.checkArticleLinks(analysis.tieredArticles, analysis.analyzedArticles);
      
      const allIssues = [...summaryIssues, ...linkIssues];
      console.log(`📊 Found ${allIssues.length} issues for ${analysis.analysisDate}:`, allIssues.map(i => i.type));
      
      if (allIssues.length > 0) {
        qualityIssues.set(analysis.analysisDate, allIssues);
        affectedDates.push(analysis.analysisDate);
        console.log(`✅ Added ${allIssues.length} issues to Map for ${analysis.analysisDate}`);

        // Update summary counts
        for (const issue of allIssues) {
          switch (issue.type) {
            case 'TOO_SHORT':
              summary.tooShort++;
              break;
            case 'TOO_LONG':
              summary.tooLong++;
              break;
            case 'EXCESSIVE_DOTS':
              summary.excessiveDots++;
              break;
            case 'GENERIC_FALLBACK':
              summary.genericFallback++;
              break;
            case 'REPEATED_WORDS':
              summary.repeatedWords++;
              break;
            case 'PLACEHOLDER_TEXT':
              summary.placeholderText++;
              break;
            case 'DUPLICATE_SUMMARY':
              summary.duplicateSummaries++;
              break;
            case 'SIMILAR_SUMMARY':
              summary.similarSummaries++;
              break;
            case 'INVALID_LINKS':
              summary.invalidLinks++;
              break;
          }
        }
      }
    }

    // NEW: Cross-date similarity detection
    console.log(`🔍 Quality check: Performing cross-date similarity analysis for ${analyses.length} analyses`);
    const processedPairs = new Set<string>();
    
    for (let i = 0; i < analyses.length; i++) {
      const analysisA = analyses[i];
      if (!analysisA.summary || !analysisA.analysisDate) continue;
      
      for (let j = i + 1; j < analyses.length; j++) {
        const analysisB = analyses[j];
        if (!analysisB.summary || !analysisB.analysisDate) continue;
        
        const pairKey = `${analysisA.analysisDate}-${analysisB.analysisDate}`;
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);
        
        const similarity = this.calculateSimilarity(
          analysisA.summary.toLowerCase().trim(),
          analysisB.summary.toLowerCase().trim()
        );
        
        // Exact duplicates (100% similarity)
        if (similarity >= 0.99) {
          const duplicateIssue: QualityIssue = {
            type: 'DUPLICATE_SUMMARY',
            message: `Identical summary to ${analysisB.analysisDate}`,
            severity: 'high'
          };
          
          // Add to both dates
          if (!qualityIssues.has(analysisA.analysisDate)) {
            qualityIssues.set(analysisA.analysisDate, []);
            affectedDates.push(analysisA.analysisDate);
          }
          if (!qualityIssues.has(analysisB.analysisDate)) {
            qualityIssues.set(analysisB.analysisDate, []);
            affectedDates.push(analysisB.analysisDate);
          }
          
          qualityIssues.get(analysisA.analysisDate)!.push({
            ...duplicateIssue,
            message: `Identical summary to ${analysisB.analysisDate}`
          });
          qualityIssues.get(analysisB.analysisDate)!.push({
            ...duplicateIssue,
            message: `Identical summary to ${analysisA.analysisDate}`
          });
          
          summary.duplicateSummaries += 2;
          
        } else if (similarity >= QualityCheckerService.SIMILARITY_THRESHOLD) {
          // High similarity (80%+ but not identical)
          const similarIssue: QualityIssue = {
            type: 'SIMILAR_SUMMARY',
            message: `${Math.round(similarity * 100)}% similar to ${analysisB.analysisDate}`,
            severity: 'medium'
          };
          
          // Add to both dates
          if (!qualityIssues.has(analysisA.analysisDate)) {
            qualityIssues.set(analysisA.analysisDate, []);
            affectedDates.push(analysisA.analysisDate);
          }
          if (!qualityIssues.has(analysisB.analysisDate)) {
            qualityIssues.set(analysisB.analysisDate, []);
            affectedDates.push(analysisB.analysisDate);
          }
          
          qualityIssues.get(analysisA.analysisDate)!.push({
            ...similarIssue,
            message: `${Math.round(similarity * 100)}% similar to ${analysisB.analysisDate}`
          });
          qualityIssues.get(analysisB.analysisDate)!.push({
            ...similarIssue,
            message: `${Math.round(similarity * 100)}% similar to ${analysisA.analysisDate}`
          });
          
          summary.similarSummaries += 2;
        }
      }
    }

    return {
      qualityIssues,
      affectedDates,
      totalIssues: affectedDates.length,
      summary
    };
  }
}

export const qualityChecker = new QualityCheckerService();
