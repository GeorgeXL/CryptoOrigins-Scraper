/**
 * Tag similarity detection utilities
 * Uses string similarity algorithms to find similar tags
 */

/**
 * Normalize a tag name for comparison
 * - Convert to lowercase
 * - Remove special characters
 * - Trim whitespace
 */
export function normalizeTagName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity score between 0 and 1
 * 1 = identical, 0 = completely different
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const normalized1 = normalizeTagName(str1);
  const normalized2 = normalizeTagName(str2);

  // Exact match after normalization
  if (normalized1 === normalized2) return 1.0;

  // Check if one is a prefix of the other (e.g., "Bitcoin" and "Bitcoin v0.3.6")
  if (normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1)) {
    const longer = Math.max(normalized1.length, normalized2.length);
    const shorter = Math.min(normalized1.length, normalized2.length);
    // High similarity if shorter is at least 70% of longer
    if (shorter / longer >= 0.7) {
      return 0.85; // High similarity for prefix matches
    }
  }

  // Calculate Levenshtein distance
  const maxLength = Math.max(normalized1.length, normalized2.length);
  if (maxLength === 0) return 1.0;

  const distance = levenshteinDistance(normalized1, normalized2);
  const similarity = 1 - distance / maxLength;

  return Math.max(0, similarity);
}

/**
 * Find similar tags from a list
 * Returns tags with similarity score >= threshold
 */
export function findSimilarTags(
  targetTag: string,
  candidateTags: Array<{ name: string; category?: string }>,
  threshold: number = 0.7
): Array<{ name: string; category?: string; similarity: number }> {
  const results: Array<{ name: string; category?: string; similarity: number }> = [];

  for (const candidate of candidateTags) {
    // Don't compare with itself
    if (candidate.name === targetTag) continue;

    const similarity = calculateSimilarity(targetTag, candidate.name);
    if (similarity >= threshold) {
      results.push({
        name: candidate.name,
        category: candidate.category,
        similarity,
      });
    }
  }

  // Sort by similarity (highest first)
  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Check if two tags are likely variants of the same entity
 * (e.g., "Bitcoin" and "Bitcoin v0.3.6")
 */
export function areTagVariants(tag1: string, tag2: string): boolean {
  const normalized1 = normalizeTagName(tag1);
  const normalized2 = normalizeTagName(tag2);

  // One is a prefix of the other
  if (normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1)) {
    const longer = Math.max(normalized1.length, normalized2.length);
    const shorter = Math.min(normalized1.length, normalized2.length);
    return shorter / longer >= 0.6; // At least 60% match
  }

  // High similarity score
  return calculateSimilarity(tag1, tag2) >= 0.8;
}




