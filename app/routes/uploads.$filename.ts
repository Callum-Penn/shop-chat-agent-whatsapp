import { json } from "@remix-run/node";
import { readFile } from "fs/promises";
import { join } from "path";

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
    
    // Read the file
    const filePath = join(process.cwd(), 'public', 'uploads', filename);
    console.log('Attempting to serve file from path:', filePath);
    
    // Check if file exists first
    try {
      const { access, stat } = await import('fs/promises');
      await access(filePath);
      const stats = await stat(filePath);
      console.log('File exists, proceeding to read. File size:', stats.size, 'bytes');
    } catch (error) {
      console.error('File does not exist at path:', filePath);
      console.error('Error details:', error);
      
      // Let's also check if the directory exists
      try {
        const { access } = await import('fs/promises');
        const dirPath = join(process.cwd(), 'public', 'uploads');
        await access(dirPath);
        console.log('Directory exists:', dirPath);
      } catch (dirError) {
        console.error('Directory does not exist:', join(process.cwd(), 'public', 'uploads'));
      }
      
      return new Response("File not found", { status: 404 });
    }
    
    const fileBuffer = await readFile(filePath);
    
    // Determine content type
    let contentType = 'image/jpeg';
    if (fileExtension === '.png') contentType = 'image/png';
    if (fileExtension === '.gif') contentType = 'image/gif';
    if (fileExtension === '.webp') contentType = 'image/webp';
    
    return new Response(fileBuffer, {
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
