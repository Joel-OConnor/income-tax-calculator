import { SavedStateSchema } from "@/lib/profile";
import { storeSavedState } from "@/server/profile";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const parsed = SavedStateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid profile" }, { status: 400 });
  storeSavedState(parsed.data);
  return Response.json({ ok: true });
}
