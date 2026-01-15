
import { Team, System, Role, RoleBundle } from '../types';

// Fix: Property 'env' does not exist on type 'ImportMeta'. Using any to bypass type check.
const BASE_PATH = (import.meta as any).env?.BASE_URL || '/';

export const getAssetPath = (path: string) => {
  const cleanBase = BASE_PATH.endsWith('/') ? BASE_PATH : `${BASE_PATH}/`;
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;
  return `${cleanBase}${cleanPath}`;
};

export async function fetchTeams(): Promise<Team[]> {
  const response = await fetch(getAssetPath('data/index_teams.json'));
  if (!response.ok) throw new Error('팀 목록을 불러오지 못했습니다.');
  const data = await response.json();
  return data.teams;
}

export async function fetchSystemsByTeam(teamCode: string): Promise<System[]> {
  const response = await fetch(getAssetPath('data/index_systems_by_team.json'));
  if (!response.ok) throw new Error('시스템 목록을 불러오지 못했습니다.');
  const data = await response.json();
  return data[teamCode] || [];
}

export async function fetchRolesByTeamSys(teamCode: string, sysCode: string): Promise<Role[]> {
  const response = await fetch(getAssetPath('data/index_roles_by_team_sys.json'));
  if (!response.ok) throw new Error('권한 목록을 불러오지 못했습니다.');
  const data = await response.json();
  const key = `${teamCode}|${sysCode}`;
  return data[key] || [];
}

export async function fetchRoleBundle(teamCode: string): Promise<RoleBundle[]> {
  const response = await fetch(getAssetPath(`data/by_team/role_bundle_team_${teamCode}.jsonl`));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`팀(${teamCode})의 상세 데이터 파일이 존재하지 않습니다.`);
    }
    throw new Error('상세 데이터를 불러오는 중 오류가 발생했습니다.');
  }
  
  const text = await response.text();
  const lines = text.split('\n').filter(line => line.trim() !== '');
  return lines.map(line => JSON.parse(line));
}
