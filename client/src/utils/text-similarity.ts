/**
 * Text similarity utilities
 * Calculates similarity between two strings using word-based and character-based methods
 */

/**
 * Normalize text for comparison
 * - Convert to lowercase
 * - Remove punctuation
 * - Normalize whitespace
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

/**
 * Calculate word-based similarity using Jaccard similarity
 * Returns a value between 0 and 1 (1 = identical, 0 = completely different)
 */
function wordSimilarity(str1: string, str2: string): number {
  const words1 = new Set(normalizeText(str1).split(' ').filter(w => w.length > 0));
  const words2 = new Set(normalizeText(str2).split(' ').filter(w => w.length > 0));
  
  if (words1.size === 0 && words2.size === 0) return 1.0;
  if (words1.size === 0 || words2.size === 0) return 0.0;
  
  // Calculate intersection and union
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  // Jaccard similarity: intersection / union
  return intersection.size / union.size;
}

/**
 * Calculate character-based similarity using Levenshtein distance
 * Returns a value between 0 and 1 (1 = identical, 0 = completely different)
 */
function characterSimilarity(str1: string, str2: string): number {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;
  
  // Levenshtein distance
  const matrix: number[][] = [];
  const len1 = s1.length;
  const len2 = s2.length;
  
  // Initialize matrix
  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }
  
  // Fill matrix
  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (s2[i - 1] === s1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }
  
  const distance = matrix[len2][len1];
  const maxLength = Math.max(len1, len2);
  
  return 1 - (distance / maxLength);
}

/**
 * Calculate overall similarity between two texts
 * Combines word-based and character-based similarity
 * Returns a value between 0 and 1 (1 = identical, 0 = completely different)
 */
export function calculateTextSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1.trim() === str2.trim()) return 1.0;
  
  const wordSim = wordSimilarity(str1, str2);
  const charSim = characterSimilarity(str1, str2);
  
  // Weighted average: word similarity is more important for semantic comparison
  return (wordSim * 0.7) + (charSim * 0.3);
}

/**
 * Get similarity label and color based on similarity score
 */
export function getSimilarityInfo(similarity: number): {
  label: string;
  color: string;
  bgColor: string;
  percentage: number;
} {
  const percentage = Math.round(similarity * 100);
  
  if (similarity >= 0.7) {
    return {
      label: 'Similar',
      color: 'text-green-700',
      bgColor: 'bg-green-100',
      percentage
    };
  } else if (similarity >= 0.4) {
    return {
      label: 'Somewhat Similar',
      color: 'text-yellow-700',
      bgColor: 'bg-yellow-100',
      percentage
    };
  } else {
    return {
      label: 'Different',
      color: 'text-red-700',
      bgColor: 'bg-red-100',
      percentage
    };
  }
}

