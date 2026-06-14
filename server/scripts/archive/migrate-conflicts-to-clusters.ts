import { storage } from '../storage';
import { conflictClusterer } from '../services/conflict-clusterer';

/**
 * One-off migration script to ensure all conflicts are properly clustered
 * and no mirror duplicates exist in the database.
 * 
 * This script:
 * 1. Fetches all existing conflicts
 * 2. Identifies clusters (connected components)
 * 3. Rebuilds conflict table with canonical pairs only
 */
async function migrateConflictsToCluster() {
  console.log('\n🔄 Starting conflict clustering migration...\n');

  try {
    // Get all existing conflicts
    const allConflicts = await storage.getAllConflicts();
    console.log(`📊 Found ${allConflicts.length} existing conflicts`);

    if (allConflicts.length === 0) {
      console.log('✅ No conflicts to migrate');
      return;
    }

    // Build clusters
    const clusters = new Map<string, Set<string>>();
    const graph = new Map<string, Set<string>>();
    
    // Build adjacency list
    for (const conflict of allConflicts) {
      if (!graph.has(conflict.sourceDate)) {
        graph.set(conflict.sourceDate, new Set());
      }
      if (!graph.has(conflict.relatedDate)) {
        graph.set(conflict.relatedDate, new Set());
      }
      
      graph.get(conflict.sourceDate)!.add(conflict.relatedDate);
      graph.get(conflict.relatedDate)!.add(conflict.sourceDate);
    }

    // Find connected components using DFS
    const visited = new Set<string>();

    const dfs = (date: string, cluster: Set<string>) => {
      if (visited.has(date)) return;
      visited.add(date);
      cluster.add(date);

      const neighbors = graph.get(date) || new Set();
      for (const neighbor of neighbors) {
        dfs(neighbor, cluster);
      }
    };

    // Find all clusters
    for (const date of graph.keys()) {
      if (!visited.has(date)) {
        const cluster = new Set<string>();
        dfs(date, cluster);
        
        // Use the smallest date as the cluster ID
        const clusterId = Array.from(cluster).sort()[0];
        clusters.set(clusterId, cluster);
      }
    }

    console.log(`🔍 Identified ${clusters.size} conflict clusters`);

    // Display cluster information
    let clusterNum = 1;
    for (const [clusterId, dates] of clusters.entries()) {
      const sortedDates = Array.from(dates).sort();
      console.log(`\nCluster ${clusterNum} (ID: ${clusterId}):`);
      console.log(`  Dates: ${sortedDates.join(', ')}`);
      console.log(`  Size: ${dates.size} dates`);
      clusterNum++;
    }

    // Build new canonical conflict pairs
    const newConflicts: Array<{ sourceDate: string; relatedDate: string; clusterId: string }> = [];
    
    for (const [clusterId, dates] of clusters.entries()) {
      const sortedDates = Array.from(dates).sort();
      
      // Create canonical pairs within cluster (smaller date first)
      for (let i = 0; i < sortedDates.length; i++) {
        for (let j = i + 1; j < sortedDates.length; j++) {
          newConflicts.push({
            sourceDate: sortedDates[i],
            relatedDate: sortedDates[j],
            clusterId: clusterId, // The smallest date in the cluster
          });
        }
      }
    }

    console.log(`\n📝 Generated ${newConflicts.length} canonical conflict pairs`);

    // Insert new canonical conflicts in batches FIRST
    console.log('\n💾 Inserting new canonical conflicts...');
    const BATCH_SIZE = 1000;
    let totalInserted = 0;
    
    for (let i = 0; i < newConflicts.length; i += BATCH_SIZE) {
      const batch = newConflicts.slice(i, i + BATCH_SIZE);
      const insertedBatch = await storage.createEventConflicts(batch);
      totalInserted += insertedBatch.length;
      console.log(`  📦 Inserted batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(newConflicts.length/BATCH_SIZE)} (${totalInserted}/${newConflicts.length})`);
    }
    
    console.log(`✅ Inserted ${totalInserted} canonical conflicts`);

    // Only clear old conflicts AFTER successful insertion
    console.log('\n🗑️  Clearing old conflicts without cluster_id...');
    const conflictsToDelete = allConflicts.filter(c => !c.clusterId);
    for (const conflict of conflictsToDelete) {
      await storage.deleteConflict(conflict.id);
    }
    console.log(`✅ Cleared ${conflictsToDelete.length} old conflicts`);

    // Verification
    const finalConflicts = await storage.getAllConflicts();
    console.log(`\n✅ Migration complete! Final conflict count: ${finalConflicts.length}`);
    console.log(`📊 Before: ${allConflicts.length} conflicts | After: ${finalConflicts.length} conflicts`);
    console.log(`🎯 Reduction: ${allConflicts.length - finalConflicts.length} duplicate/mirror pairs removed`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrateConflictsToCluster()
  .then(() => {
    console.log('\n🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration failed:', error);
    process.exit(1);
  });

export { migrateConflictsToCluster };
