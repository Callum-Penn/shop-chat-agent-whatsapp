/**
 * Conversation Archiving Service
 * 
 * This service handles automatic archiving of old conversations
 * and cleanup of archived data to prevent database bloat.
 * 
 * Recommended usage:
 * - Run daily via cron job or scheduled task
 * - Call from a scheduled API endpoint
 * - Execute as part of maintenance tasks
 */

import { 
  archiveInactiveConversations, 
  deleteOldArchivedConversations 
} from "../db.server.js";

/**
 * Run all archiving tasks
 * @returns {Promise<Object>} - Summary of archiving results
 */
export async function runArchivingTasks() {
  console.log('=== Starting Archiving Tasks ===');
  const results = {
    timestamp: new Date().toISOString(),
    tasksRun: [],
    success: true
  };

  try {
    // Task 1: Archive conversations inactive for 30+ days
    console.log('Task 1: Archiving inactive conversations...');
    const archivedCount = await archiveInactiveConversations(30);
    results.tasksRun.push({
      task: 'archive_inactive_conversations',
      result: `Archived ${archivedCount} conversations`,
      count: archivedCount
    });
    console.log(`✓ Archived ${archivedCount} inactive conversations`);

    // Task 2: Delete conversations archived for 90+ days
    console.log('Task 2: Deleting old archived conversations...');
    const deletedCount = await deleteOldArchivedConversations(90);
    results.tasksRun.push({
      task: 'delete_old_archived_conversations',
      result: `Deleted ${deletedCount} old conversations`,
      count: deletedCount
    });
    console.log(`✓ Deleted ${deletedCount} old archived conversations`);

    console.log('=== Archiving Tasks Completed Successfully ===');
    return results;
  } catch (error) {
    console.error('Error running archiving tasks:', error);
    results.success = false;
    results.error = error.message;
    return results;
  }
}

/**
 * Archive specific conversation
 * @param {string} conversationId - Conversation ID to archive
 * @returns {Promise<Object>} - Archiving result
 */
export async function archiveSpecificConversation(conversationId) {
  const { archiveConversation } = await import("../db.server.js");
  
  try {
    const conversation = await archiveConversation(conversationId);
    console.log(`Archived conversation: ${conversationId}`);
    return {
      success: true,
      conversation
    };
  } catch (error) {
    console.error('Error archiving conversation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  runArchivingTasks,
  archiveSpecificConversation
};

