import { json } from "@remix-run/node";
import { getImageFromStore } from "../utils/whatsapp.server";

export const loader = async ({ params }) => {
  const { filename } = params;
  
  if (!filename) {
    return new Response("File not found", { status: 404 });
  }
  
  try {
    // Security check - only allow certain file extensions
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    
    if (!allowedExtensions.includes(fileExtension)) {
      return new Response("File type not allowed", { status: 403 });
    }
    
    console.log('Attempting to serve file from database:', filename);
    
    // Get image from database
    const imageData = await getImageFromStore(filename);
    
    if (!imageData) {
      console.error('Image not found in database:', filename);
      return new Response("File not found", { status: 404 });
    }
    
    console.log('Image found in database. Size:', imageData.size, 'bytes');
    
    // Determine content type (use stored MIME type)
    const contentType = imageData.mimeType || 'image/jpeg';
    
    return new Response(imageData.buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('Error serving file:', error);
    return new Response("File not found", { status: 404 });
  }
};
