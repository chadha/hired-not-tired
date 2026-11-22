export const isLocalWorkspace =
  import.meta.env.MODE === "development" && !import.meta.env["VITE_API_BASE_URL"];
