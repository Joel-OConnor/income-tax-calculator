import { getBundle } from "@/server/sync";

export const dynamic = "force-dynamic";

/** The stored bundle for ?year=, or the latest year. */
export async function GET(request: Request) {
  const year = new URL(request.url).searchParams.get("year");
  const bundle = getBundle(year ? Number(year) : undefined);
  if (!bundle) return Response.json({ error: "No tax data for that year" }, { status: 404 });
  return Response.json(bundle);
}
