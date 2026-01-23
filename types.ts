export interface Team {
  team_code: string;
  team_name: string;
}

export interface System {
  sys_code: string;
  sys_name: string;
}

export interface Role {
  auth_code: string;
  auth_name: string;
  auth_desc: string;

  // === IAS_Sales 전용 권한 표기를 위해 추가 ===
  // 화면에 보여줄 "권한명" (IAS_Sales면 auth_desc, 그 외는 auth_name)
  display_auth_name?: string;

  // 화면에 보여줄 "권한코드" 레이블 (보통 auth_name)
  auth_code_label?: string;

  // "이 권한명 그대로 복사" 요청 시, 클립보드에 들어갈 텍스트
  copy_auth_name?: string;
}


export interface Menu {
  path: string;
  menu_id: string;

  // 메뉴 정렬/표기를 위해 path에서 파생한 한글 메뉴명
  menu_name?: string;
}


export interface RoleBundle {
  team_code: string;
  team_name: string;
  sys_code: string;
  sys_name: string;
  auth_code: string;
  auth_name: string;
  auth_desc: string;
  menus: Menu[];

  // === IAS_Sales 권한 표기용 파생 필드 (Role과 동일 개념) ===
  display_auth_name?: string;
  auth_code_label?: string;
  copy_auth_name?: string;
}


export interface SearchResult {
  type: IntentType;
  keyword: string;
  candidates?: string[];
  message?: string;
  confidence?: number;   // 추가
}


export type IntentType = "ROLE_TO_MENU" | "MENU_TO_ROLE" | "ROLE_LIST" | "UNKNOWN";

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  data?: any;
  intentType?: IntentType;
}
