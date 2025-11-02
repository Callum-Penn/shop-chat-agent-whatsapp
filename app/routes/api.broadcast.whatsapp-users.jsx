import { json } from "@remix-run/node";
import { getAllWhatsAppUsers } from "../db.server";

export const loader = async () => {
  try {
    const whatsappUsers = await getAllWhatsAppUsers();
    return json({ count: whatsappUsers.length });
  } catch (error) {
    console.error('Error getting WhatsApp user count:', error);
    return json({ count: 0 });
  }
};

