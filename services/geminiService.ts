
import { GoogleGenAI, Type } from "@google/genai";
import { SearchResult } from "../types";

export async function analyzeIntent(
  query: string, 
  currentTeam: string, 
  currentSystem: string
): Promise<SearchResult> {
  // Use process.env.API_KEY directly as it is a hard requirement.
  if (!process.env.API_KEY) {
    return fallbackAnalysis(query);
  }

  // Initialize GoogleGenAI with a named parameter and create a new instance right before making an API call.
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Use gemini-3-flash-preview for basic text task like intent analysis.
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `사용자 질문: "${query}"\n현재 선택된 팀: ${currentTeam}, 시스템: ${currentSystem}`,
    config: {
      systemInstruction: `당신은 사내 권한/메뉴 안내 봇입니다. 사용자의 질문 의도를 분석하여 JSON으로 반환하세요.
의도 타입(type): 
1. ROLE_TO_MENU: 특정 권한(role)이 가진 메뉴를 물어볼 때
2. MENU_TO_ROLE: 특정 메뉴(menu)를 보려면 어떤 권한이 필요한지 물어볼 때
3. ROLE_LIST: 특정 팀/시스템의 전체 권한 목록을 물어볼 때
4. UNKNOWN: 의도가 불분명할 때

규칙:
- keyword: 질문에서 핵심이 되는 권한명 또는 메뉴명을 추출하세요.
- candidates: 모호할 경우 예상되는 후보 키워드 리스트 (없으면 빈 배열)
- message: 사용자에게 답변할 친절한 한글 메시지 서두`,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          keyword: { type: Type.STRING },
          candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
          message: { type: Type.STRING }
        },
        required: ["type", "keyword", "message"]
      }
    }
  });

  try {
    // Access the text property directly on the GenerateContentResponse object.
    const responseText = response.text;
    return JSON.parse(responseText || "{}") as SearchResult;
  } catch (e) {
    return fallbackAnalysis(query);
  }
}

function fallbackAnalysis(query: string): SearchResult {
  if (query.includes("권한") && (query.includes("목록") || query.includes("보여줘"))) {
    return { type: 'ROLE_LIST', keyword: '', message: '권한 목록을 조회합니다.' };
  }
  if (query.includes("메뉴") || query.includes("볼 수") || query.includes("가진")) {
    return { type: 'ROLE_TO_MENU', keyword: query.replace(/권한|메뉴|볼 수|있어|가진|\?| /g, ''), message: '권한별 메뉴를 찾고 있습니다.' };
  }
  return { type: 'MENU_TO_ROLE', keyword: query.replace(/권한|메뉴|필요해|보려면|\?| /g, ''), message: '메뉴에 필요한 권한을 찾고 있습니다.' };
}
