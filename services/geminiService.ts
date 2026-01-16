import { GoogleGenAI, Type } from "@google/genai";
import { SearchResult } from "../types";

type IntentType = "ROLE_TO_MENU" | "MENU_TO_ROLE" | "ROLE_LIST" | "UNKNOWN";

export async function analyzeIntent(
  query: string,
  currentTeam: string,
  currentSystem: string
): Promise<SearchResult> {
  // ✅ Vite에서는 이게 정답
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!apiKey) return fallbackAnalysis(query);

  const ai = new GoogleGenAI({ apiKey });

  // 모델이 판단할 때 참고할 “현재 컨텍스트”를 더 구조화해서 제공
  const userContext = {
    query,
    selected_team: currentTeam || "",
    selected_system: currentSystem || "",
    hints: [
      "팀 선택/시스템 선택이 비어있으면, 사용자가 팀/시스템을 말했는지 먼저 본다.",
      "권한(auth/role)은 ROLE_ADMIN, ZC_*, ROLE_* 같은 코드/이름일 수 있다.",
      "메뉴(menu)는 '견적', '정산', '비즈니스파트너목록'처럼 사람 단어일 수도 있고, menu_id(pjt.xxx) 같은 ID일 수도 있다."
    ]
  };

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(userContext, null, 2) }]
        }
      ],
      config: {
        systemInstruction: `
당신은 "사내 권한/메뉴 안내" 챗봇의 의도 분류기입니다.
사용자의 한 문장을 보고, 아래 4가지 중 하나로 의도를 분류하고 "항상 JSON만" 반환하세요.

[의도 타입 정의]
1) ROLE_TO_MENU
- 특정 권한(ROLE/권한명/권한코드) 또는 특정 팀이 가진 권한으로 "볼 수 있는 메뉴"를 묻는 경우
- 예:
  - "ROLE_ADMIN은 뭐 볼 수 있어?"
  - "DX본부에서 신청 가능한 권한/메뉴 알려줘"
  - "이 권한 신청하면 어떤 메뉴 나와?"

2) MENU_TO_ROLE
- 특정 메뉴(메뉴명/메뉴ID/URL)를 "보려면 필요한 권한"을 묻는 경우
- 예:
  - "IAS Sales 견적 메뉴 보려면 무슨 권한 필요해?"
  - "pjt.core.bizPartner.bizPartnerList 보려면?"
  - "정산 화면 접근하려면 뭐 신청해야 돼?"

3) ROLE_LIST
- 특정 팀/시스템에 존재하는 "권한 목록 전체"를 요청하는 경우
- 예:
  - "DX본부 LEGO 권한 목록 보여줘"
  - "IAS Sales 권한 뭐뭐 있어?"
  - "전체 리스트"

4) UNKNOWN
- 권한/메뉴/팀/시스템과 무관하거나 정보가 너무 부족해 판단 불가능한 경우

[추출 규칙]
- keyword:
  - ROLE_TO_MENU이면: '권한명/권한코드/팀명' 중 질문의 핵심 키워드 1개를 넣는다.
  - MENU_TO_ROLE이면: '메뉴명 또는 menu_id 또는 URL' 중 핵심 1개를 넣는다.
  - ROLE_LIST이면: 사용자가 언급한 팀명/시스템명이 있으면 그걸 넣고, 없으면 빈 문자열.
  - UNKNOWN이면 빈 문자열.

- candidates:
  - 질문이 모호하거나 keyword가 여러 개 가능하면 후보를 2~6개로 제공한다.
  - 확실하면 빈 배열 [].

- message:
  - 사용자에게 보여줄 친절한 한글 서두(한 문장).
  - 예: "해당 메뉴에 필요한 권한을 찾아볼게요." / "선택된 팀/시스템 기준 권한 목록을 보여드릴게요."

[분류 우선순위(헷갈릴 때)]
- '필요해/보려면/접근/신청해야' + 메뉴 단어/ID/URL가 있으면 => MENU_TO_ROLE 우선
- '뭐 볼 수/어떤 메뉴/가능/권한이 가진' => ROLE_TO_MENU
- '목록/리스트/전체/뭐뭐 있어' => ROLE_LIST
- 그 외 => UNKNOWN

[출력 강제]
- 반드시 아래 responseSchema에 맞춘 JSON만 출력 (설명/마크다운/코드블록 금지)
`.trim(),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING },
            keyword: { type: Type.STRING },
            candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
            message: { type: Type.STRING },
            confidence: { type: Type.NUMBER }
          },
          required: ["type", "keyword", "message", "candidates", "confidence"]
        }
      }
    });

    const parsed = JSON.parse(response.text || "{}");

    return {
      type: (parsed.type as IntentType) || "UNKNOWN",
      keyword: parsed.keyword ?? "",
      message: parsed.message ?? "질문 의도를 파악해볼게요.",
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6
    } as SearchResult;
  } catch (e) {
    console.error("❌ Gemini API 분석 실패 → fallback 동작", e);
    return fallbackAnalysis(query);
  }
}

function fallbackAnalysis(query: string): SearchResult {
  const q = query.replace(/\s/g, "");

  if (q.includes("목록") || q.includes("리스트") || q.includes("전체") || q.includes("뭐뭐") || q.includes("뭐있어")) {
    return { type: "ROLE_LIST", keyword: "", message: "권한 목록을 조회할게요.", candidates: [], confidence: 0.4 } as any;
  }

  if (q.includes("필요") || q.includes("보려면") || q.includes("접근") || q.includes("신청해야")) {
    return {
      type: "MENU_TO_ROLE",
      keyword: query.replace(/권한|메뉴|필요해|보려면|어떻게|뭐|신청|\?| /g, ""),
      message: "해당 메뉴에 필요한 권한을 찾아볼게요.",
      candidates: [],
      confidence: 0.4
    } as any;
  }

  if (q.includes("메뉴") || q.includes("볼수") || q.includes("기능") || q.includes("가진")) {
    return {
      type: "ROLE_TO_MENU",
      keyword: query.replace(/권한|메뉴|볼수|있어|가진|뭐야|확인|\?| /g, ""),
      message: "해당 권한(또는 팀)이 볼 수 있는 메뉴를 찾아볼게요.",
      candidates: [],
      confidence: 0.4
    } as any;
  }

  return { type: "UNKNOWN", keyword: "", message: "질문을 조금만 더 구체적으로 알려주세요.", candidates: [], confidence: 0.3 } as any;
}