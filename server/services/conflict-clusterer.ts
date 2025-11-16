import { storage } from '../storage';
import type { EventConflict } from '@shared/schema';

export interface ConflictCluster {
  clusterId: string;
  dates: string[];
  conflictIds: number[];
}

export interface ClusteredConflictGroup {
  clusterId: string;
  dates: string[];
  summaries: Record<string, string>;
  conflictIds: number[];
}

class ConflictClustererService {
  /**
   * Build connected components from conflict pairs using Union-Find algorithm
   */
  private buildClusters(conflicts: EventConflict[]): Map<string, Set<string>> {
    // Build adjacency list
    const graph = new Map<string, Set<string>>();
    
    for (const conflict of conflicts) {
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
    const clusters = new Map<string, Set<string>>();

    const dfs = (date: string, cluster: Set<string>) => {
      if (visited.has(date)) return;
      visited.add(date);
      cluster.add(date);

      const neighbors = graph.get(date) || new Set();
      for (const neighbor of neighbors) {
        dfs(neighbor, cluster);
      }
    };

    // Find all connected components
    for (const date of graph.keys()) {
      if (!visited.has(date)) {
        const cluster = new Set<string>();
        dfs(date, cluster);
        
        // Use the smallest date as the cluster ID for consistency
        const clusterId = Array.from(cluster).sort()[0];
        clusters.set(clusterId, cluster);
      }
    }

    return clusters;
  }

  /**
   * Get all conflicts grouped by clusters
   */
  async getClusteredConflicts(): Promise<ClusteredConflictGroup[]> {
    const allConflicts = await storage.getAllConflicts();
    
    if (allConflicts.length === 0) {
      return [];
    }

    const clusters = this.buildClusters(allConflicts);
    const result: ClusteredConflictGroup[] = [];

    for (const [clusterId, dates] of clusters.entries()) {
      const sortedDates = Array.from(dates).sort();
      
      // Fetch summaries for all dates in cluster
      const summaries: Record<string, string> = {};
      for (const date of sortedDates) {
        const analysis = await storage.getAnalysisByDate(date);
        summaries[date] = analysis?.summary || '';
      }

      // Find all conflict IDs that involve any dates in this cluster
      const conflictIds = allConflicts
        .filter(c => dates.has(c.sourceDate) || dates.has(c.relatedDate))
        .map(c => c.id);

      result.push({
        clusterId,
        dates: sortedDates,
        summaries,
        conflictIds,
      });
    }

    // Sort by cluster ID (earliest date) descending
    return result.sort((a, b) => b.clusterId.localeCompare(a.clusterId));
  }

  /**
   * Get clustered conflicts for a specific year
   */
  async getClusteredConflictsByYear(year: number): Promise<ClusteredConflictGroup[]> {
    const yearConflicts = await storage.getConflictsByYear(year);
    
    if (yearConflicts.length === 0) {
      return [];
    }

    const clusters = this.buildClusters(yearConflicts);
    const result: ClusteredConflictGroup[] = [];

    for (const [clusterId, dates] of clusters.entries()) {
      const sortedDates = Array.from(dates).sort();
      
      // Fetch summaries for all dates in cluster
      const summaries: Record<string, string> = {};
      for (const date of sortedDates) {
        const analysis = await storage.getAnalysisByDate(date);
        summaries[date] = analysis?.summary || '';
      }

      // Find all conflict IDs that involve any dates in this cluster
      const conflictIds = yearConflicts
        .filter(c => dates.has(c.sourceDate) || dates.has(c.relatedDate))
        .map(c => c.id);

      result.push({
        clusterId,
        dates: sortedDates,
        summaries,
        conflictIds,
      });
    }

    // Sort by cluster ID (earliest date) descending
    return result.sort((a, b) => b.clusterId.localeCompare(a.clusterId));
  }

  /**
   * Get a specific cluster by any date within it
   */
  async getClusterByDate(date: string): Promise<ClusteredConflictGroup | null> {
    const allConflicts = await storage.getAllConflicts();
    
    if (allConflicts.length === 0) {
      return null;
    }

    const clusters = this.buildClusters(allConflicts);

    // Find the cluster containing this date
    for (const [clusterId, dates] of clusters.entries()) {
      if (dates.has(date)) {
        const sortedDates = Array.from(dates).sort();
        
        // Fetch summaries for all dates in cluster
        const summaries: Record<string, string> = {};
        for (const clusterDate of sortedDates) {
          const analysis = await storage.getAnalysisByDate(clusterDate);
          summaries[clusterDate] = analysis?.summary || '';
        }

        // Find all conflict IDs that involve any dates in this cluster
        const conflictIds = allConflicts
          .filter(c => dates.has(c.sourceDate) || dates.has(c.relatedDate))
          .map(c => c.id);

        return {
          clusterId,
          dates: sortedDates,
          summaries,
          conflictIds,
        };
      }
    }

    return null;
  }

  /**
   * Delete all conflicts in a cluster
   */
  async deleteCluster(clusterId: string): Promise<void> {
    const cluster = await this.getClusterByDate(clusterId);
    
    if (!cluster) {
      console.log(`⚠️ No cluster found for ID: ${clusterId}`);
      return;
    }

    console.log(`🗑️ Deleting cluster ${clusterId} with ${cluster.conflictIds.length} conflicts`);
    
    // Delete all conflicts in the cluster
    for (const conflictId of cluster.conflictIds) {
      await storage.deleteConflict(conflictId);
    }

    console.log(`✅ Deleted cluster ${clusterId}`);
  }

  /**
   * Calculate and assign cluster IDs to all conflicts in the database
   * This replaces NULL cluster_id values with proper cluster assignments
   */
  async assignClusterIds(): Promise<{ clustersFound: number; conflictsUpdated: number }> {
    console.log('🔄 Calculating cluster IDs for all conflicts...');
    
    const allConflicts = await storage.getAllConflicts();
    
    if (allConflicts.length === 0) {
      console.log('✅ No conflicts to cluster');
      return { clustersFound: 0, conflictsUpdated: 0 };
    }

    // Build clusters using DFS
    const clusters = this.buildClusters(allConflicts);
    console.log(`🔍 Found ${clusters.size} clusters`);

    // Create map of date -> clusterId for efficient lookup
    const dateToCluster = new Map<string, string>();
    for (const [clusterId, dates] of clusters.entries()) {
      for (const date of dates) {
        dateToCluster.set(date, clusterId);
      }
    }

    // Update conflicts with cluster IDs
    let updatedCount = 0;
    for (const conflict of allConflicts) {
      // Get cluster ID from either source or related date (they should be the same)
      const clusterId = dateToCluster.get(conflict.sourceDate) || dateToCluster.get(conflict.relatedDate);
      
      if (clusterId && conflict.clusterId !== clusterId) {
        await storage.updateConflict(conflict.id, { clusterId });
        updatedCount++;
      }
    }

    console.log(`✅ Assigned cluster IDs to ${updatedCount} conflicts across ${clusters.size} clusters`);
    
    return {
      clustersFound: clusters.size,
      conflictsUpdated: updatedCount
    };
  }
}

export const conflictClusterer = new ConflictClustererService();
