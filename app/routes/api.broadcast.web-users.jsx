import { json } from "@remix-run/node";
import { getAllWebUsers } from "../db.server";

export const loader = async () => {
  try {
    const webUsers = await getAllWebUsers();
    return json({ count: webUsers.length });
  } catch (error) {
    console.error('Error getting web users count:', error);
    return json({ count: 0 });
  }
};
