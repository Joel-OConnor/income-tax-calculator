import { getBundle, syncTaxData } from "@/server/sync";

export const dynamic = "force-dynamic";

/** Manual sync. Returns the new status and the latest bundle so the page can refresh. */
export async function POST() {
  const status = await syncTaxData("manual");
  return Response.json({ status, bundle: getBundle() });
}
