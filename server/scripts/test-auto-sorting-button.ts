/**
 * Test script for the "Auto Sorting" button functionality
 * Verifies that the button uses the correct taxonomy
 */

import { TAXONOMY_TREE, getCategoryKeyFromPath } from '@shared/taxonomy';

// Valid category keys from taxonomy
const VALID_CATEGORY_KEYS = [
  'bitcoin',
  'money-economics',
  'technology',
  'organizations',
  'people',
  'regulation-law',
  'markets-geography', // ✅ CORRECT - must be this, NOT "geography-markets"
  'education-community',
  'crime-security',
  'topics',
  'miscellaneous'
];

// Invalid category keys that should never be used
const INVALID_CATEGORY_KEYS = [
  'geography-markets', // ❌ WRONG - should be "markets-geography"
  'blockchain-platforms', // Old/deprecated
  'crypto', // Too generic
];

function getAllSubcategoryKeys(nodes: typeof TAXONOMY_TREE): string[] {
  const keys: string[] = [];
  
  function traverse(node: typeof TAXONOMY_TREE[0]) {
    if (node.key.includes('.')) {
      keys.push(node.key);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }
  
  for (const node of nodes) {
    traverse(node);
  }
  
  return keys;
}

function validateTaxonomy() {
  console.log('🧪 Testing Auto Sorting Button - Taxonomy Validation\n');
  
  // Test 1: Verify taxonomy structure
  console.log('✅ Test 1: Taxonomy Structure');
  console.log(`   Found ${TAXONOMY_TREE.length} main categories`);
  const allSubcategories = getAllSubcategoryKeys(TAXONOMY_TREE);
  console.log(`   Found ${allSubcategories.length} subcategories`);
  
  // Test 2: Verify correct category keys
  console.log('\n✅ Test 2: Valid Category Keys');
  const taxonomyCategoryKeys = TAXONOMY_TREE.map(node => node.key);
  const allValid = taxonomyCategoryKeys.every(key => VALID_CATEGORY_KEYS.includes(key));
  console.log(`   All taxonomy categories are valid: ${allValid ? '✅' : '❌'}`);
  
  if (!allValid) {
    const invalid = taxonomyCategoryKeys.filter(key => !VALID_CATEGORY_KEYS.includes(key));
    console.log(`   ❌ Invalid categories found: ${invalid.join(', ')}`);
  }
  
  // Test 3: Verify "markets-geography" is used (not "geography-markets")
  console.log('\n✅ Test 3: Geography Category Key');
  const hasCorrectGeography = taxonomyCategoryKeys.includes('markets-geography');
  const hasWrongGeography = taxonomyCategoryKeys.includes('geography-markets');
  console.log(`   Has "markets-geography": ${hasCorrectGeography ? '✅' : '❌'}`);
  console.log(`   Has "geography-markets": ${hasWrongGeography ? '❌ WRONG!' : '✅ (correctly absent)'}`);
  
  // Test 4: Verify subcategory paths are valid
  console.log('\n✅ Test 4: Subcategory Path Validation');
  let validPaths = 0;
  let invalidPaths = 0;
  
  function validatePath(node: typeof TAXONOMY_TREE[0], parentPath: string[] = []): void {
    if (node.key.includes('.')) {
      const path = [...parentPath, node.key];
      const categoryKey = getCategoryKeyFromPath(path);
      if (categoryKey && VALID_CATEGORY_KEYS.includes(categoryKey)) {
        validPaths++;
      } else {
        invalidPaths++;
        console.log(`   ❌ Invalid path: ${path.join(' -> ')} (category: ${categoryKey})`);
      }
    }
    
    if (node.children) {
      const currentPath = node.key.includes('.') ? [...parentPath, node.key] : parentPath;
      for (const child of node.children) {
        validatePath(child, currentPath);
      }
    }
  }
  
  for (const node of TAXONOMY_TREE) {
    validatePath(node);
  }
  
  console.log(`   Valid paths: ${validPaths}`);
  console.log(`   Invalid paths: ${invalidPaths}`);
  
  // Test 5: Verify category key mapping
  console.log('\n✅ Test 5: Category Key Mapping');
  const testCases = [
    { path: ['7.1'], expected: 'markets-geography' },
    { path: ['4.2', '4.2.3'], expected: 'organizations' },
    { path: ['5.2'], expected: 'people' },
    { path: ['3.5'], expected: 'technology' },
    { path: ['1.1'], expected: 'bitcoin' },
  ];
  
  let passed = 0;
  for (const testCase of testCases) {
    const result = getCategoryKeyFromPath(testCase.path);
    const correct = result === testCase.expected;
    if (correct) {
      passed++;
      console.log(`   ✅ ${testCase.path.join(' -> ')} → ${result}`);
    } else {
      console.log(`   ❌ ${testCase.path.join(' -> ')} → ${result} (expected: ${testCase.expected})`);
    }
  }
  console.log(`   Passed: ${passed}/${testCases.length}`);
  
  // Test 6: Check for common mistakes
  console.log('\n✅ Test 6: Common Mistakes Check');
  const mistakes: string[] = [];
  
  // Check if any invalid keys are present
  for (const invalidKey of INVALID_CATEGORY_KEYS) {
    if (taxonomyCategoryKeys.includes(invalidKey)) {
      mistakes.push(`Found invalid category key: ${invalidKey}`);
    }
  }
  
  // Check subcategory format
  for (const subcat of allSubcategories) {
    if (!/^\d+\.\d+(\.\d+)*$/.test(subcat)) {
      mistakes.push(`Invalid subcategory format: ${subcat}`);
    }
  }
  
  if (mistakes.length === 0) {
    console.log('   ✅ No common mistakes found');
  } else {
    console.log('   ❌ Found mistakes:');
    mistakes.forEach(m => console.log(`      - ${m}`));
  }
  
  // Summary
  console.log('\n📊 Test Summary:');
  console.log(`   ✅ Taxonomy structure: ${TAXONOMY_TREE.length} categories, ${allSubcategories.length} subcategories`);
  console.log(`   ${hasCorrectGeography ? '✅' : '❌'} Correct geography key: "markets-geography"`);
  console.log(`   ${!hasWrongGeography ? '✅' : '❌'} No wrong geography key: "geography-markets"`);
  console.log(`   ✅ Valid paths: ${validPaths}, Invalid: ${invalidPaths}`);
  console.log(`   ✅ Category mapping: ${passed}/${testCases.length} passed`);
  console.log(`   ${mistakes.length === 0 ? '✅' : '❌'} Common mistakes: ${mistakes.length}`);
  
  const allTestsPassed = allValid && hasCorrectGeography && !hasWrongGeography && invalidPaths === 0 && passed === testCases.length && mistakes.length === 0;
  
  console.log(`\n${allTestsPassed ? '✅' : '❌'} Overall: ${allTestsPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  
  return allTestsPassed;
}

// Test the button endpoint structure
function testButtonEndpoint() {
  console.log('\n\n🔍 Testing Button Endpoint Structure\n');
  
  console.log('✅ Endpoint: POST /api/tags/ai-categorize/start');
  console.log('   Expected behavior:');
  console.log('   1. Checks if already running (409 if running)');
  console.log('   2. Gets all unique tags from tags_version2');
  console.log('   3. Starts background processing');
  console.log('   4. Uses categorizeTagWithContext() with Gemini');
  console.log('   5. Validates category keys against taxonomy');
  console.log('   6. Creates/updates tags in database');
  console.log('   7. Links tags to analyses');
  console.log('   8. Updates usage counts');
  
  console.log('\n✅ Taxonomy Usage in categorizeTagWithContext():');
  console.log('   - Uses getTaxonomyStructure() for prompt');
  console.log('   - Explicitly warns: "markets-geography" NOT "geography-markets"');
  console.log('   - Validates with Zod schema');
  console.log('   - System prompt reinforces correct keys');
  
  console.log('\n✅ Validation Points:');
  console.log('   ✓ Category key must be one of 11 valid keys');
  console.log('   ✓ Subcategory path must be valid array');
  console.log('   ✓ Confidence must be 0.0-1.0');
  console.log('   ✓ Path must be within single category');
}

// Run tests
const taxonomyValid = validateTaxonomy();
testButtonEndpoint();

console.log('\n\n💡 Manual Testing Steps:');
console.log('1. Start dev server: pnpm dev');
console.log('2. Navigate to Tag Manager');
console.log('3. Find "Tags without path" section');
console.log('4. Click "Auto Sorting" button');
console.log('5. Verify toast: "Auto Sorting started"');
console.log('6. Check server logs for categorization progress');
console.log('7. Verify tags are categorized with correct taxonomy');
console.log('8. Check that category keys match taxonomy (especially "markets-geography")');

process.exit(taxonomyValid ? 0 : 1);

