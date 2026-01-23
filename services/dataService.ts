import { Team, System, Role, RoleBundle } from "../types";

const BASE_PATH = import.meta.env.BASE_URL || "/";

export const getAssetPath = (path: string) => {
  const cleanBase = BASE_PATH.endsWith("/") ? BASE_PATH : `${BASE_PATH}/`;
  const cleanPath = path.startsWith("/") ? path.substring(1) : path;
  return `${cleanBase}${cleanPath}`;
};

export async function fetchTeams(): Promise<Team[]> {
  const response = await fetch(getAssetPath("data/index_teams.json"));
  if (!response.ok) throw new Error("팀 목록을 불러오지 못했습니다.");
  const data = await response.json();

  // index_teams.json 구조가 { teams: [...] } 또는 [...] 둘 다 대응
  if (Array.isArray(data?.teams)) return data.teams as Team[];
  if (Array.isArray(data)) return data as Team[];
  return [];
}

export async function fetchSystemsByTeam(teamCode: string): Promise<System[]> {
  const response = await fetch(getAssetPath("data/index_systems_by_team.json"));
  if (!response.ok) throw new Error("시스템 목록을 불러오지 못했습니다.");
  const data = await response.json();
  return (data?.[teamCode] || []) as System[];
}

export async function fetchRolesByTeamSys(teamCode: string, sysCode: string): Promise<Role[]> {
  const response = await fetch(getAssetPath("data/index_roles_by_team_sys.json"));
  if (!response.ok) throw new Error("권한 목록을 불러오지 못했습니다.");
  const data = await response.json();
  const key = `${teamCode}|${sysCode}`;
  return (data?.[key] || []) as Role[];
}

export async function fetchRoleBundle(teamCode: string): Promise<RoleBundle[]> {
  // 파일명 규칙: public/data/by_team/role_bundle_team_${teamCode}.jsonl
  // teamCode에 공백/특수문자가 섞일 가능성 방어
  const safeTeamCode = encodeURIComponent(String(teamCode || "").trim());
  const url = getAssetPath(`data/by_team/role_bundle_team_${safeTeamCode}.jsonl`);

  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`팀(${teamCode})의 상세 데이터 파일이 존재하지 않습니다.`);
    }
    throw new Error("상세 데이터를 불러오는 중 오류가 발생했습니다.");
  }

  const text = await response.text();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // JSONL: 한 줄 깨져도 전체가 죽지 않게 방어
  const items: RoleBundle[] = [];
  for (const line of lines) {
    try {
      items.push(JSON.parse(line));
    } catch {
      // 깨진 줄은 스킵
    }
  }
  return items;
}


/**
 * 메뉴 리스트를 한글 우선 가나다순으로 정렬하고 20개씩 페이징합니다.
 */
export function getPagedMenus(menus: any[], page: number = 0): any[] {
  const sorted = [...menus].sort((a, b) => {
    const nameA = a.menu_name || "";
    const nameB = b.menu_name || "";
    
    // 한글 여부 체크 (정규식)
    const isKoA = /[ㄱ-ㅎ|가-힣]/.test(nameA);
    const isKoB = /[ㄱ-ㅎ|가-힣]/.test(nameB);

    if (isKoA && !isKoB) return -1; // 한글이 앞으로
    if (!isKoA && isKoB) return 1;  // 영어가 뒤로
    
    // 같은 언어끼리는 사전순
    return nameA.localeCompare(nameB, 'ko');
  });

  // 20개씩 자르기 (0페이지: 0~19, 1페이지: 20~39)
  return sorted.slice(page * 20, (page + 1) * 20);
}