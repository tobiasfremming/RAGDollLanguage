import { NextRequest, NextResponse } from "next/server";

interface TranslateRequest {
  text?: string;
  texts?: string[];
  source?: string;
  target?: string;
  backendUrl?: string;
  warmup?: boolean;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as TranslateRequest;
  const text = body.text?.trim();
  const texts = body.texts?.map((item) => item.trim()).filter(Boolean) || [];
  const source = body.source?.trim() || "auto";
  const target = body.target?.trim() || "en";
  const backendUrl = (
    body.backendUrl ||
    process.env.NEXT_PUBLIC_BACKEND_API_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");

  if (body.warmup) {
    const response = await fetch(
      `${backendUrl}/api/translate/warmup?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`,
      { method: "POST" }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  }

  if (!text && texts.length === 0) {
    return NextResponse.json(
      { message: "Text or texts are required." },
      { status: 400 }
    );
  }

  if (texts.length > 0) {
    const response = await fetch(`${backendUrl}/api/translate/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, source, target }),
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        {
          message:
            data?.message || "RAGdoll batch translation returned an error.",
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      translations: data.translations || [],
      source,
      target,
      provider: "ragdoll",
    });
  }

  const response = await fetch(`${backendUrl}/api/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source, target }),
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json(
      {
        message: data?.message || "RAGdoll translation returned an error.",
      },
      { status: response.status }
    );
  }

  return NextResponse.json({
    text,
    translatedText: data.translatedText,
    source: data.source || source,
    target: data.target || target,
    provider: data.provider || "ragdoll",
  });
}
