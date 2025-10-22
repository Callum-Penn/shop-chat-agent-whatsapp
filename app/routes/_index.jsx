import { redirect } from "@remix-run/node";

export const loader = async () => {
  // Redirect root path to /app
  return redirect("/app");
}; 