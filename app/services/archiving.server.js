/**
 * Conversation Archiving Service
 * Handles automatic archiving and cleanup of old conversations
 */

import { 
  archiveOldConversations, 
  deleteOldArchivedConversations,
  getConversationStats
} from "../db.server";

/**
 * Run the archiving process
 * Archives conversations inactive for 30+ days
 * Deletes archived conversations older than 90 days
 * @returns {Promise<Object>} - Archiving results
 */
export async function runArchivingProcess() {
  console.log('Starting conversation archiving process...');
  
  try {
    // Get stats before archiving
    const statsBefore = await getConversationStats();
    console.log('Stats before archiving:', statsBefore);

    // Archive conversations inactive for 30+ days
    const archivedCount = await archiveOldConversations(30);
    console.log(`Archived ${archivedCount} conversations`);

    // Delete archived conversations older than 90 days
    const deletedCount = await deleteOldArchivedConversations(90);
    console.log(`Deleted ${deletedCount} old archived conversations`);

    // Get stats after archiving
    const statsAfter = await getConversationStats();
    console.log('Stats after archiving:', statsAfter);

    return {
      success: true,
      archivedCount,
      deletedCount,
      statsBefore,
      statsAfter
    };
  } catch (error) {
    console.error('Error in archiving process:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Schedule archiving to run periodically
 * Run this on application startup or via a cron job
 * @param {number} intervalHours - How often to run (in hours, default: 24)
 */
export function scheduleArchiving(intervalHours = 24) {
  console.log(`Scheduling archiving process to run every ${intervalHours} hours`);
  
  // Run immediately on startup
  runArchivingProcess().then(result => {
    console.log('Initial archiving completed:', result);
  });

  // Schedule recurring runs
  const intervalMs = intervalHours * 60 * 60 * 1000;
  setInterval(() => {
    console.log('Running scheduled archiving process...');
    runArchivingProcess().then(result => {
      console.log('Scheduled archiving completed:', result);
    });
  }, intervalMs);
}

/**
 * Get current database statistics
 * Useful for monitoring and dashboards
 * @returns {Promise<Object>} - Database statistics
 */
export async function getDatabaseStats() {
  try {
    const stats = await getConversationStats();
    return {
      success: true,
      stats
    };
  } catch (error) {
    console.error('Error getting database stats:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  runArchivingProcess,
  scheduleArchiving,
  getDatabaseStats
};

