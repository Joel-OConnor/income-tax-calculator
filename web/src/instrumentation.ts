// Runs once when the server starts: pull the latest tax data in the background.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { firstSync } = await import("./server/sync");
    void firstSync();
  }
}
