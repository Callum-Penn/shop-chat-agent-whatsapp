/**
 * Archiving API Route
 * Provides endpoints for manual archiving and statistics
 */
import { json } from "@remix-run/node";
import { runArchivingProcess, getDatabaseStats } from "../services/archiving.server";

/**
 * Handle GET requests - return database statistics
 */
export async function loader({ request }) {
  try {
    const result = await getDatabaseStats();
    return json(result);
  } catch (error) {
    console.error('Error getting database stats:', error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

/**
 * Handle POST requests - manually trigger archiving
 */
export async function action({ request }) {
  try {
    // Optional: Add authentication check here
    // For now, anyone can trigger archiving
    
    const result = await runArchivingProcess();
    
    return json(result, { 
      status: result.success ? 200 : 500 
    });
  } catch (error) {
    console.error('Error running archiving process:', error);
    return json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

