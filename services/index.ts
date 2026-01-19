import express from "express";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
app.use(express.json());

type IntentType = "ROLE_TO_MENU" | "MENU_TO_ROLE" | "ROLE_LIST" | "UNKNOWN";

app.post("/api/analyze-intent", async (req, res) => {
  try {
    const { query, currentTeam, currentSystem } = req.body ?? {};

    const systemInstruction = `
    당신은 "사내 권한/메뉴 안내" 챗봇의 의도 분류기입니다.
    사용자의 한 문장을 보고, 아래 4가지 중 하나로 의도를 분류하고 "항상 JSON만" 반환하세요.

    [의도 타입 정의]
    1) ROLE_TO_MENU
    - 특정 권한(ROLE/권한명/권한코드) 또는 특정 팀이 가진 권한으로 "볼 수 있는 메뉴"를 묻는 경우
    - "우리 팀 접근 가능 메뉴", "전체 메뉴 보여줘", "메뉴 전체" 등도 여기에 해당

    2) MENU_TO_ROLE
    - 특정 메뉴(메뉴명/메뉴ID/URL)를 "보려면 필요한 권한"을 묻는 경우

    3) ROLE_LIST
    - 특정 팀/시스템에 존재하는 "권한 목록 전체"를 요청하는 경우
    - "권한", "권한만", "우리 팀 권한", "권한 뭐있어", "권한 목록", "권한 리스트" 등이 여기에 해당

    4) UNKNOWN
    - 권한/메뉴/팀/시스템과 무관하거나 정보가 너무 부족해 판단 불가능한 경우

    [분류 우선순위(헷갈릴 때)]
    - '권한만/권한 뭐/권한 목록/권한 리스트/뭐뭐 있어' => ROLE_LIST
    - '전체 메뉴/접근 가능 메뉴/메뉴 보여줘' => ROLE_TO_MENU  
    - '필요해/보려면/접근/신청해야' + 메뉴 단어 => MENU_TO_ROLE
    - 그 외 => UNKNOWN

    [추출 규칙]
    - ROLE_LIST의 경우: keyword는 현재 선택된 팀명 또는 빈 문자열
    - ROLE_TO_MENU의 경우: keyword는 팀명/시스템명 또는 "전체"
    - 나머지는 기존과 동일

    - message: 분류된 의도에 맞는 친절한 한글 응답 메시지
    - ROLE_LIST: "권한 목록을 조회할게요."
    - ROLE_TO_MENU: "접근 가능한 메뉴를 정리해드릴게요."
    - MENU_TO_ROLE: "해당 메뉴에 필요한 권한을 찾아볼게요."

    [출력 강제]
    - 반드시 responseSchema에 맞춘 JSON만 출력
    - 설명/마크다운/코드블록 금지
    `.trim();

    const safeQuery = typeof query === "string" ? query.trim() : "";
    if (!safeQuery) {
      return res.json({
        type: "UNKNOWN",
        keyword: "",
        candidates: [],
        message: "질문을 입력해 주세요.",
        confidence: 0.2,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({
        type: "UNKNOWN",
        keyword: "",
        candidates: [],
        message: "서버 설정 오류로 의도 분석을 수행할 수 없습니다. 관리자에게 문의해 주세요.",
        confidence: 0.1,
      });
    }

    const ai = new GoogleGenAI({ apiKey });

    const userContext = {
      query: safeQuery,
      selected_team: currentTeam || "",
      selected_system: currentSystem || "",
      hints: [
        "팀 선택/시스템 선택이 비어있으면, 사용자가 팀/시스템을 말했는지 먼저 본다.",
        "권한(auth/role)은 ROLE_ADMIN, ZC_*, ROLE_* 같은 코드/이름일 수 있다.",
        "메뉴(menu)는 '견적', '정산', '비즈니스파트너목록'처럼 사람 단어일 수도 있고, menu_id(pjt.xxx) 같은 ID일 수도 있다.",
      ],
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: JSON.stringify(userContext, null, 2) }] }],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING },
            keyword: { type: Type.STRING },
            candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
            message: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
          },
          required: ["type", "keyword", "message", "candidates", "confidence"],
        },
      },
    });

    let parsed: any = {};
    try {
      parsed = JSON.parse(response.text || "{}");
    } catch {
      parsed = {};
    }

    const allowedTypes: IntentType[] = ["ROLE_TO_MENU", "MENU_TO_ROLE", "ROLE_LIST", "UNKNOWN"];
    const type: IntentType = allowedTypes.includes(parsed.type) ? parsed.type : "UNKNOWN";

    const keyword = typeof parsed.keyword === "string" ? parsed.keyword.trim() : "";
    const finalKeyword =
      (type === "MENU_TO_ROLE" || type === "ROLE_TO_MENU") && keyword.length === 0 ? safeQuery : keyword;

    return res.json({
      type,
      keyword: finalKeyword,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      message: typeof parsed.message === "string" ? parsed.message : "질문 의도를 파악해볼게요.",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
    });
  } catch (e: any) {
    console.error("[/api/analyze-intent] Gemini failed:", e?.message || e);
    return res.json({
      type: "UNKNOWN",
      keyword: "",
      candidates: [],
      message: "의도 분석 중 오류가 발생했습니다. 다른 표현으로 다시 질문해 주세요.",
      confidence: 0.3,
    });
  }
});

const port = Number(process.env.API_PORT || 3001);
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${port}`);
});
