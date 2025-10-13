import { redirect } from "@remix-run/node";

export async function loader({ request }) {
  const url = new URL(request.url);
  
  // If this is a direct visit to the app URL, redirect to the app route
  if (url.pathname === "/") {
    return redirect("/app");
  }
  
  return null;
}

export default function Index() {
  return (
    <div style={{ 
      padding: "2rem", 
      textAlign: "center", 
      fontFamily: "Arial, sans-serif" 
    }}>
      <h1>Shopify AI Chat Agent</h1>
      <p>This app is designed to be used within the Shopify adminn.</p>
      <p>Please install this app on your Shopify store to use it.</p>
      <a href="/app" style={{ 
        display: "inline-block", 
        padding: "10px 20px", 
        backgroundColor: "#008060", 
        color: "white", 
        textDecoration: "none", 
        borderRadius: "5px" 
      }}>
        Open App
      </a>
    </div>
  );
} 