import { NextResponse } from "next/server";
import { getTdxToken } from "@/lib/tdx";
import { getStaticSyncStates } from "@/lib/bus-static";
import { isSupabaseStaticConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tdxConfigured = Boolean(process.env.TDX_CLIENT_ID && process.env.TDX_CLIENT_SECRET);
  const supabaseConfigured = isSupabaseStaticConfigured();

  if (!tdxConfigured) {
    return NextResponse.json(
      {
        ok: false,
        tdxConfigured: false,
        supabaseConfigured,
        message: "尚未設定 TDX 環境變數",
      },
      { status: 503 }
    );
  }

  try {
    await getTdxToken();
    let staticSyncStates: Record<string, unknown>[] = [];
    if (supabaseConfigured) {
      try {
        staticSyncStates = await getStaticSyncStates();
      } catch (error) {
        console.warn("Supabase health check failed", error);
      }
    }

    return NextResponse.json({
      ok: true,
      tdxConfigured: true,
      tdxAuth: "ok",
      supabaseConfigured,
      staticSyncStates,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        tdxConfigured: true,
        tdxAuth: "failed",
        supabaseConfigured,
        message: error instanceof Error ? error.message : "TDX 驗證失敗",
      },
      { status: 502 }
    );
  }
}
