import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * Normalize markdown file:
 * 1. Convert all dates to ISO format (YYYY-MM-DD)
 * 2. Normalize table formats to single-line
 * 3. Remove empty table rows
 * 4. Ensure consistent formatting
 */

const filePath = '/Users/jiriczolko/Downloads/Private & Shared/News Scraper 1a77ae01d497800c8f56dbc3e60fe1f4.md';

// Month name to number mapping
const monthMap: Record<string, string> = {
  'jan': '01', 'january': '01',
  'feb': '02', 'february': '02',
  'mar': '03', 'march': '03',
  'apr': '04', 'april': '04',
  'may': '05',
  'jun': '06', 'june': '06',
  'jul': '07', 'july': '07',
  'aug': '08', 'august': '08',
  'sep': '09', 'september': '09',
  'oct': '10', 'october': '10',
  'nov': '11', 'november': '11',
  'dec': '12', 'december': '12'
};

/**
 * Convert various date formats to ISO (YYYY-MM-DD)
 */
function normalizeDate(dateStr: string, contextYear: string | null = null): string | null {
  if (!dateStr) return null;
  
  // Skip table headers and non-date strings
  if (/^(Date|Category|Summary|Examples|Total|rest out)/i.test(dateStr.trim())) {
    return null;
  }
  
  // Remove bold markers, asterisks, and other formatting
  dateStr = dateStr.replace(/\*\*/g, '').replace(/\*/g, '').trim();
  
  // Already ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Format: YYYY-MM (incomplete, use first day)
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    return `${dateStr}-01`;
  }
  
  // Format: YYYY (incomplete, use Jan 1)
  if (/^\d{4}$/.test(dateStr)) {
    return `${dateStr}-01-01`;
  }
  
  // Format: "Month DDth, YYYY" or "Month DD, YYYY" (with ordinal suffixes)
  // Also handles "Month DDth" without year (uses context year if available)
  const monthDayYearOrdinal = dateStr.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (monthDayYearOrdinal) {
    const [, month, day, year] = monthDayYearOrdinal;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day.padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Format: "Jan DD, YYYY" or "Jul DD, YYYY" (abbreviated month)
  const abbrevMonthDayYear = dateStr.match(/([a-z]{3,4})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (abbrevMonthDayYear) {
    const [, month, day, year] = abbrevMonthDayYear;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day.padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Format: "Month DDth" or "Month DD" (without year - use context if available)
  const monthDayNoYear = dateStr.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (monthDayNoYear && contextYear) {
    const [, month, day] = monthDayNoYear;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day.padStart(2, '0');
      return `${contextYear}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Format: "DDth Month YYYY" or "DD Month YYYY"
  const dayMonthYearOrdinal = dateStr.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{4})/i);
  if (dayMonthYearOrdinal) {
    const [, day, month, year] = dayMonthYearOrdinal;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day.padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Format: "Month DD, YYYY" or "DD Month YYYY" or "Month YYYY" (without ordinal)
  const monthDayYear = dateStr.match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (monthDayYear) {
    const [, month, day, year] = monthDayYear;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day.padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Format: "Month YYYY"
  const monthYear = dateStr.match(/([a-z]+)\s+(\d{4})/i);
  if (monthYear) {
    const [, month, year] = monthYear;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      return `${year}-${monthNum}-01`;
    }
  }
  
  // Format: "DD Month YYYY" (without ordinal)
  const dayMonthYear = dateStr.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (dayMonthYear) {
    const [, day, month, year] = dayMonthYear;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day.padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Format: "DD/MM/YYYY" or "MM/DD/YYYY" (try both)
  const slashDate = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashDate) {
    const [, part1, part2, year] = slashDate;
    // Assume MM/DD/YYYY (US format) if first part > 12, otherwise ambiguous
    if (parseInt(part1) > 12) {
      // DD/MM/YYYY
      return `${year}-${part2.padStart(2, '0')}-${part1.padStart(2, '0')}`;
    } else {
      // MM/DD/YYYY
      return `${year}-${part1.padStart(2, '0')}-${part2.padStart(2, '0')}`;
    }
  }
  
  // Format: "YYYY‑MM‑DD" (with non-breaking hyphen or em dash)
  const dashDate = dateStr.match(/(\d{4})[‑–—](\d{2})[‑–—](\d{2})/);
  if (dashDate) {
    const [, year, month, day] = dashDate;
    return `${year}-${month}-${day}`;
  }
  
  // Handle date ranges - take the first date
  const dateRange = dateStr.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[–—]\s*(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (dateRange) {
    const [, month, day1, , year] = dateRange;
    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) {
      const dayPadded = day1.padStart(2, '0');
      return `${year}-${monthNum}-${dayPadded}`;
    }
  }
  
  // Handle incomplete dates like "2014 (general)" - extract year
  const yearInParens = dateStr.match(/(\d{4})\s*\(/);
  if (yearInParens) {
    return `${yearInParens[1]}-01-01`;
  }
  
  // Handle "Early/Late/Beginning/End of YYYY" or "Season YYYY"
  const periodYear = dateStr.match(/(early|late|beginning|end|summer|winter|spring|fall|autumn)\s+(\d{4})/i);
  if (periodYear) {
    const [, period, year] = periodYear;
    const periodLower = period.toLowerCase();
    if (periodLower === 'early' || periodLower === 'beginning' || periodLower === 'spring') {
      return `${year}-01-01`;
    } else if (periodLower === 'summer') {
      return `${year}-06-01`;
    } else if (periodLower === 'fall' || periodLower === 'autumn') {
      return `${year}-09-01`;
    } else if (periodLower === 'winter') {
      return `${year}-12-01`;
    } else {
      return `${year}-12-31`;
    }
  }
  
  // Skip if it's clearly not a date (too long, contains too many words, etc.)
  if (!/\d{4}/.test(dateStr)) {
    return null;
  }
  
  // Skip if it looks like a description or sentence (too many words, contains "like", "etc", etc.)
  const wordCount = dateStr.split(/\s+/).length;
  if (wordCount > 8 || 
      dateStr.toLowerCase().includes('like') || 
      dateStr.toLowerCase().includes('etc') ||
      dateStr.toLowerCase().includes('e.g.') ||
      dateStr.includes('–') && wordCount > 3) {
    return null;
  }
  
  // Last resort: try to extract any 4-digit year and use Jan 1
  // But only if the string is short and looks date-like
  if (wordCount <= 5) {
    const yearOnly = dateStr.match(/\b(\d{4})\b/);
    if (yearOnly) {
      // Only use this if the year is reasonable (1900-2100)
      const year = parseInt(yearOnly[1]);
      if (year >= 1900 && year <= 2100) {
        return `${yearOnly[1]}-01-01`;
      }
    }
  }
  
  return null;
}

/**
 * Normalize a table row - handles both single-line and multi-line formats
 */
function normalizeTableRow(line: string, nextLines: string[], contextYear: string | null = null): { normalized: string; consumed: number } {
  const trimmed = line.trim();
  
  // Check if this is a table separator
  if (trimmed.match(/^\|\s*---/)) {
    return { normalized: line, consumed: 0 };
  }
  
  // Skip if not a table row
  if (!trimmed.startsWith('|')) {
    return { normalized: line, consumed: 0 };
  }
  
  // Try single-line format first: | date | summary |
  const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
  if (cells.length >= 2) {
    const date = normalizeDate(cells[0], contextYear);
    if (date) {
      const summary = cells.slice(1).join(' | ').trim();
      return { normalized: `| ${date} | ${summary} |`, consumed: 0 };
    }
    
    // If first cell is a date without year (like "January 22nd"), try with context
    if (contextYear && cells[0].match(/^[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?$/i)) {
      const monthDayMatch = cells[0].match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
      if (monthDayMatch) {
        const [, month, day] = monthDayMatch;
        const monthNum = monthMap[month.toLowerCase()];
        if (monthNum) {
          const dayPadded = day.padStart(2, '0');
          const fullDate = `${contextYear}-${monthNum}-${dayPadded}`;
          const summary = cells.slice(1).join(' | ').trim();
          return { normalized: `| ${fullDate} | ${summary} |`, consumed: 0 };
        }
      }
    }
  }
  
  // Multi-line format: date and summary on separate lines
  // Pattern: | \n Date \n | \n Summary \n |
  let dateStr = '';
  let summaryStr = '';
  let consumed = 0;
  
  // Check if current line is just "|" (start of multi-line entry)
  if (trimmed === '|') {
    // Look ahead for date and summary
    for (let i = 0; i < Math.min(10, nextLines.length); i++) {
      const checkLine = nextLines[i]?.trim() || '';
      
      // Skip empty lines and separators
      if (!checkLine || checkLine === '|' || checkLine.match(/^\|\s*---/)) {
        continue;
      }
      
      // If line starts with |, it might be part of the table structure
      if (checkLine.startsWith('|')) {
        const checkCells = checkLine.split('|').map(c => c.trim()).filter(c => c);
        
        // First cell might be date
        if (checkCells.length > 0 && !dateStr) {
          const potentialDate = normalizeDate(checkCells[0], contextYear);
          if (potentialDate) {
            dateStr = potentialDate;
            if (checkCells.length > 1) {
              summaryStr = checkCells.slice(1).join(' ').trim();
            }
            consumed = i + 1;
            continue;
          }
        }
        
        // If we have date, collect summary
        if (dateStr && checkCells.length > 0) {
          summaryStr = (summaryStr ? summaryStr + ' ' : '') + checkCells.join(' ').trim();
          consumed = i + 1;
        }
      } else {
        // Non-table line - might be date or summary text
        if (!dateStr) {
          const potentialDate = normalizeDate(checkLine, contextYear);
          if (potentialDate) {
            dateStr = potentialDate;
            consumed = i + 1;
            continue;
          }
        } else if (!summaryStr) {
          // This is the summary
          summaryStr = checkLine;
          consumed = i + 1;
        }
      }
      
      // Stop if we have both date and summary
      if (dateStr && summaryStr) {
        break;
      }
      
      // Stop if we hit another table row or section
      if (checkLine.startsWith('-') || checkLine.startsWith('#') || checkLine.match(/^\|\s*\d{4}/)) {
        break;
      }
    }
    
    if (dateStr && summaryStr) {
      return { normalized: `| ${dateStr} | ${summaryStr} |`, consumed };
    }
  }
  
  // If current line has content but no date found, try to extract from it
  if (cells.length > 0) {
    const potentialDate = normalizeDate(cells[0], contextYear);
    if (potentialDate && cells.length > 1) {
      return { normalized: `| ${potentialDate} | ${cells.slice(1).join(' | ')} |`, consumed: 0 };
    }
  }
  
  // Try single-line format again with context year
  if (cells.length >= 2) {
    const date = normalizeDate(cells[0], contextYear);
    if (date) {
      const summary = cells.slice(1).join(' | ').trim();
      return { normalized: `| ${date} | ${summary} |`, consumed: 0 };
    }
  }
  
  // Return as-is if we can't normalize
  return { normalized: line, consumed: 0 };
}

/**
 * Main normalization function
 */
function normalizeMarkdown(content: string): string {
  const lines = content.split('\n');
  const normalized: string[] = [];
  let i = 0;
  let currentSection = '';
  let lastYear: string | null = null;
  
  while (i < lines.length) {
    const line = lines[i];
    const nextLines = lines.slice(i + 1, i + 10);
    
    // Track section headers to infer context
    if (line.match(/^##?\s+/)) {
      currentSection = line;
      lastYear = null; // Reset year context on new section
    }
    
    // Extract year from section if available
    const yearMatch = currentSection.match(/\b(\d{4})\b/);
    if (yearMatch) {
      lastYear = yearMatch[1];
    }
    
    // Also check for standalone year headers (like "2013" on its own line, possibly indented)
    const standaloneYear = line.trim().match(/^(\d{4})\s*$/);
    if (standaloneYear) {
      lastYear = standaloneYear[1];
      // Keep the year line as-is, but update context
      normalized.push(line);
      i++;
      continue;
    }
    
    // Skip empty table rows (but preserve context year)
    if (line.trim() === '|' || line.trim() === '|  |' || line.trim() === '|  |  |') {
      normalized.push(line);
      i++;
      continue;
    }
    
    // Skip empty lines (but preserve context year)
    if (line.trim() === '') {
      normalized.push(line);
      i++;
      continue;
    }
    
    // Check if this is a table row
    if (line.trim().startsWith('|') && !line.trim().match(/^\|\s*---/)) {
      const result = normalizeTableRow(line, nextLines, lastYear);
      normalized.push(result.normalized);
      i += 1 + result.consumed;
      
      // Update lastYear if we found a date, but only if the original row didn't have a year
      // (to preserve context year from standalone year headers)
      const originalCells = line.trim().split('|').map(c => c.trim()).filter(c => c);
      const hasYearInOriginal = originalCells[0] && /^\d{4}/.test(originalCells[0]);
      if (!hasYearInOriginal) {
        const dateMatch = result.normalized.match(/\|\s*(\d{4})-\d{2}-\d{2}\s*\|/);
        if (dateMatch) {
          lastYear = dateMatch[1];
        }
      }
    } else {
      // Regular line, but check if it's a standalone date that should be in a table
      // Pattern: Date on one line, summary on next line (not in table format)
      const trimmedLine = line.trim();
      const standaloneDate = normalizeDate(trimmedLine, lastYear);
      
      if (standaloneDate && nextLines.length > 0) {
        const nextLine = nextLines[0]?.trim() || '';
        // Check if next line is a summary (not a table row, not a section header, not empty)
        if (nextLine && 
            !nextLine.startsWith('|') && 
            !nextLine.startsWith('-') && 
            !nextLine.startsWith('#') &&
            !nextLine.match(/^\s*$/) &&
            nextLine.length > 20) { // Summary should be substantial
          // Combine into table format
          normalized.push(`| ${standaloneDate} | ${nextLine} |`);
          i += 2;
          
          // Update lastYear
          const yearMatch = standaloneDate.match(/^(\d{4})/);
          if (yearMatch) {
            lastYear = yearMatch[1];
          }
          continue;
        }
      }
      
      // Also check if current line might be a date without year that needs context
      // Look ahead to see if next line is a summary
      if (!trimmedLine.startsWith('|') && !trimmedLine.startsWith('-') && !trimmedLine.startsWith('#')) {
        const potentialDateNoYear = trimmedLine.match(/([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
        if (potentialDateNoYear && lastYear && nextLines.length > 0) {
          const nextLine = nextLines[0]?.trim() || '';
          if (nextLine && 
              !nextLine.startsWith('|') && 
              !nextLine.startsWith('-') && 
              !nextLine.startsWith('#') &&
              nextLine.length > 20) {
            const [, month, day] = potentialDateNoYear;
            const monthNum = monthMap[month.toLowerCase()];
            if (monthNum) {
              const dayPadded = day.padStart(2, '0');
              const fullDate = `${lastYear}-${monthNum}-${dayPadded}`;
              normalized.push(`| ${fullDate} | ${nextLine} |`);
              i += 2;
              continue;
            }
          }
        }
      }
      
      normalized.push(line);
      i++;
    }
  }
  
  return normalized.join('\n');
}

// Main execution
try {
  console.log('📖 Reading markdown file...');
  const content = readFileSync(filePath, 'utf-8');
  
  console.log('🔧 Normalizing markdown...');
  const normalized = normalizeMarkdown(content);
  
  // Create backup first
  const backupPath = filePath.replace('.md', '.backup.md');
  console.log(`💾 Creating backup: ${backupPath}`);
  writeFileSync(backupPath, content, 'utf-8');
  
  // Write normalized version
  console.log('💾 Writing normalized file...');
  writeFileSync(filePath, normalized, 'utf-8');
  
  console.log('✅ Normalization complete!');
  console.log(`   Original: ${content.length} characters`);
  console.log(`   Normalized: ${normalized.length} characters`);
  console.log(`   Backup saved to: ${backupPath}`);
} catch (error) {
  console.error('❌ Error:', error);
  process.exit(1);
}

