/**
 * Archiving API Route
 * 
 * This endpoint can be called by a cron job or scheduled task to run
 * automatic conversation archiving and cleanup.
 * 
 * Usage:
 * POST /api/archiving with Authorization header
 * 
 * Security: Requires ARCHIVING_API_KEY environment variable
 */

import { json } from "@remix-run/node";
import { runArchivingTasks, archiveSpecificConversation } from "../services/archiving.server";

/**
 * POST endpoint to trigger archiving tasks
 */
export const action = async ({ request }) => {
  try {
    // Security: Check for API key
    const authHeader = request.headers.get("Authorization");
    const expectedKey = process.env.ARCHIVING_API_KEY || "default_key_change_me";
    
    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return json(
        { error: "Unauthorized. Invalid or missing API key." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const action = body.action || "run_all";

    if (action === "run_all") {
      // Run all archiving tasks
      const results = await runArchivingTasks();
      return json(results, { status: 200 });
    } else if (action === "archive_conversation" && body.conversationId) {
      // Archive specific conversation
      const result = await archiveSpecificConversation(body.conversationId);
      return json(result, { status: result.success ? 200 : 500 });
    } else {
      return json(
        { error: "Invalid action or missing parameters" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error in archiving API:", error);
    return json(
      { error: "Internal server error", details: error.message },
      { status: 500 }
    );
  }
};

/**
 * GET endpoint to check service status
 */
export const loader = async () => {
  return json({
    status: "online",
    service: "conversation-archiving",
    timestamp: new Date().toISOString()
  });
};

