
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
}

export interface Menu {
  path: string;
  menu_id: string;
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
}

export interface SearchResult {
  type: IntentType;
  keyword: string;
  candidates?: string[];
  message?: string;
}

export type IntentType = "ROLE_TO_MENU" | "MENU_TO_ROLE" | "ROLE_LIST" | "UNKNOWN";

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  data?: any;
  intentType?: IntentType;
}
