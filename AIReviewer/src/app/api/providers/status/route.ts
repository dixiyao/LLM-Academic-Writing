import { NextResponse } from "next/server";

import { serverEnv } from "@/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    gemini: {
      configured: Boolean(serverEnv.geminiApiKey),
      model: serverEnv.geminiModel,
      fastModel: serverEnv.geminiFastModel
    },
    openrouter: {
      configured: Boolean(serverEnv.openRouterApiKey),
      model: serverEnv.openRouterModel
    },
    fakeProviderEnabled: serverEnv.allowFakeProvider
  });
}
