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
export async function runArchivingProcess(daysInactive = 30, daysOld = 90) {
  const cutoffDate = subDays(new Date(), daysInactive);
  const archivedCount = await archiveOldConversations(cutoffDate);
  const deletedCount = await deleteOldArchivedConversations(subDays(new Date(), daysOld));

  return {
    archivedCount,
    deletedCount
  };
}

/**
 * Schedule archiving to run periodically
 * Run this on application startup or via a cron job
 * @param {number} intervalHours - How often to run (in hours, default: 24)
 */
export function scheduleArchiving(intervalHours = 24) {
  runArchivingProcess()
    .then((result) => {
      archivingEmitter.emit('archiving:completed', result);
    })
    .catch((error) => {
      console.error('Scheduled archiving failed:', error);
    });

  // Schedule recurring runs
  const intervalMs = intervalHours * 60 * 60 * 1000;
  archivingInterval = setInterval(async () => {
    try {
      const result = await runArchivingProcess(daysInactive, daysOld);
      archivingEmitter.emit('archiving:completed', result);
    } catch (error) {
      console.error('Scheduled archiving failed:', error);
    }
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

