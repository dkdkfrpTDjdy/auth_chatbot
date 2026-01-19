import { SearchResult } from "../types";

export async function analyzeIntent(
  query: string,
  currentTeam: string,
  currentSystem: string
): Promise<SearchResult> {
  const safeQuery = String(query || "").trim();
  if (!safeQuery) return fallbackAnalysis("");

  try {
    const res = await fetch("/api/analyze-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: safeQuery,
        currentTeam: String(currentTeam || ""),
        currentSystem: String(currentSystem || ""),
      }),
    });

    // 서버가 죽었거나(500 등) 응답이 이상해도 UI가 깨지지 않게
    if (!res.ok) return fallbackAnalysis(safeQuery);

    const data = await res.json();

    const type = typeof data?.type === "string" ? data.type : "UNKNOWN";
    const keyword = typeof data?.keyword === "string" ? data.keyword : "";
    const message = typeof data?.message === "string" ? data.message : "질문 의도를 파악해볼게요.";
    const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
    const confidence = typeof data?.confidence === "number" ? data.confidence : 0.6;

    return { type, keyword, message, candidates, confidence } as SearchResult;
  } catch (e) {
    console.error("❌ intent api 실패 → fallback 동작", e);
    return fallbackAnalysis(safeQuery);
  }
}

function fallbackAnalysis(query: string): SearchResult {
  const q = String(query || "").replace(/\s/g, "");

  if (!q) {
    return { type: "UNKNOWN", keyword: "", message: "질문을 입력해 주세요.", candidates: [], confidence: 0.2 } as any;
  }

  if (q.includes("목록") || q.includes("리스트") || q.includes("전체") || q.includes("뭐뭐") || q.includes("뭐있어")) {
    return { type: "ROLE_LIST", keyword: "", message: "권한 목록을 조회할게요.", candidates: [], confidence: 0.4 } as any;
  }

  if (q.includes("필요") || q.includes("보려면") || q.includes("접근") || q.includes("신청해야")) {
    return {
      type: "MENU_TO_ROLE",
      keyword: query.replace(/권한|메뉴|필요해|보려면|어떻게|뭐|신청|\?| /g, ""),
      message: "해당 메뉴에 필요한 권한을 찾아볼게요.",
      candidates: [],
      confidence: 0.4,
    } as any;
  }

  if (q.includes("메뉴") || q.includes("볼수") || q.includes("기능") || q.includes("가진")) {
    return {
      type: "ROLE_TO_MENU",
      keyword: query.replace(/권한|메뉴|볼수|있어|가진|뭐야|확인|\?| /g, ""),
      message: "해당 권한(또는 팀)이 볼 수 있는 메뉴를 찾아볼게요.",
      candidates: [],
      confidence: 0.4,
    } as any;
  }

  return { type: "UNKNOWN", keyword: "", message: "질문을 조금만 더 구체적으로 알려주세요.", candidates: [], confidence: 0.3 } as any;
}
