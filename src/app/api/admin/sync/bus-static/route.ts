import { NextRequest, NextResponse } from "next/server";
import { getStaticSyncStates, syncBusCityStatic } from "@/lib/bus-static";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const expected = process.env.STATIC_SYNC_SECRET;
  if (!expected) return false;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return bearer === expected || request.headers.get("x-sync-secret") === expected;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "未授權" }, { status: 401 });
  try {
    return NextResponse.json({ states: await getStaticSyncStates() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "狀態查詢失敗" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "未授權" }, { status: 401 });
  try {
    const body = (await request.json()) as { city?: string };
    const city = body.city?.trim();
    if (!city || !/^[A-Za-z]+$/.test(city)) {
      return NextResponse.json({ error: "請提供有效的 TDX 縣市代碼" }, { status: 400 });
    }
    const result = await syncBusCityStatic(city);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Static bus sync failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步失敗" }, { status: 500 });
  }
}
