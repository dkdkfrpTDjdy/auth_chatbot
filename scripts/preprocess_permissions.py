import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional

import pandas as pd

# ============================================================
# 설정 (너 환경 고정)
# ============================================================
REPO_DIR = Path(r"D:\works\GEN_AI\auth_chat\auth_chat_2")

# 입력 CSV 파일명(레포 안에 두는 걸 추천)
# 예: D:\works\GEN_AI\auth_chat\auth_chat_2\input.csv
INPUT_CSV = REPO_DIR / "input.csv"

# 출력 경로 (요구사항 고정)
OUT_BASE = REPO_DIR / "public" / "data"
OUT_BY_TEAM = OUT_BASE / "by_team"
OUT_BAD = OUT_BASE / "_bad_rows"

# 테스트/안정화 옵션(필요 시만 사용)
MAX_MENUS_PER_ROLE: Optional[int] = None  # 예: 300. None이면 제한 없음

# ============================================================
# Robust JSON parsing
# ============================================================
# 탭/개행/CR은 별도로 처리하고, 그 외 제어문자만 제거
_CTRL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

def _clean_for_json(s: str) -> str:
    s2 = s.strip()
    # CSV 이스케이프 흔한 패턴 보정
    s2 = s2.replace('""', '"')
    # 제어문자 제거(탭/개행/CR 제외)
    s2 = _CTRL_CHARS.sub("", s2)
    return s2

def parse_page_content(raw: str) -> Dict[str, Any]:
    """
    page_content 파싱을 최대한 통과시키기 위한 함수.
    - contents/page_content에 실제 줄바꿈이 섞여 JSON이 깨지는 케이스
    - CSV quote 이스케이프 잔여
    - 제어문자 포함
    """
    if not isinstance(raw, str):
        raise ValueError("page_content is not a string")

    candidates = []

    s = raw.strip()
    candidates.append(s)

    # 바깥 따옴표가 감싸는 형태 보정
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        candidates.append(s[1:-1])

    # "" -> " 치환 후보
    candidates.append(s.replace('""', '"'))

    last_err = None
    for cand in candidates:
        c = _clean_for_json(cand)

        # 1) 기본
        try:
            return json.loads(c)
        except json.JSONDecodeError as e:
            last_err = e

        # 2) strict=False (가능하면)
        try:
            return json.loads(c, strict=False)
        except TypeError:
            pass
        except json.JSONDecodeError as e:
            last_err = e

        # 3) 실제 줄바꿈을 \n 문자열로 바꿔서 재시도
        c2 = c.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")
        try:
            return json.loads(c2)
        except json.JSONDecodeError as e:
            last_err = e

        try:
            return json.loads(c2, strict=False)
        except TypeError:
            pass
        except json.JSONDecodeError as e:
            last_err = e

    preview = raw[:250].replace("\n", "\\n").replace("\r", "\\r")
    raise ValueError(f"Failed to parse page_content JSON. preview={preview} ... last_err={last_err}")


# ============================================================
# Menu extraction (supports BOTH nested & flat schemas)
# ============================================================
def extract_menus(auth_obj: Dict[str, Any]) -> List[Dict[str, str]]:
    """
    지원 스키마 2가지:

    (A) 평탄형:
      auth_obj["menus"] = [
        {"1level": "...", "2level": "...", "3level": "...", "3level_id": "..."},
        ...
      ]

    (B) 중첩형:
      auth_obj["menus"] = [
        {"1level": "...", "2level_menus": [
          {"2level_name": "...", "3level_menus": [{"3level": "...", "3level_id": "..."}, ...]},
          ...
        ]},
        ...
      ]
    """
    out: List[Dict[str, str]] = []
    menus = auth_obj.get("menus", []) or []

    for m in menus:
        # 중첩형인지 체크
        if "2level_menus" in m:
            l1 = str(m.get("1level", "")).strip()
            for m2 in (m.get("2level_menus", []) or []):
                l2 = str(m2.get("2level_name", "")).strip()
                for m3 in (m2.get("3level_menus", []) or []):
                    l3 = str(m3.get("3level", "")).strip()
                    mid = str(m3.get("3level_id", "")).strip()
                    if not (l1 or l2 or l3 or mid):
                        continue
                    out.append({"path": f"{l1} > {l2} > {l3}", "menu_id": mid})
        else:
            # 평탄형
            l1 = str(m.get("1level", "")).strip()
            l2 = str(m.get("2level", "")).strip()
            l3 = str(m.get("3level", "")).strip()
            mid = str(m.get("3level_id", "")).strip()
            if not (l1 or l2 or l3 or mid):
                continue
            out.append({"path": f"{l1} > {l2} > {l3}", "menu_id": mid})

    # 중복 제거 + 정렬
    seen = set()
    uniq = []
    for m in out:
        k = (m["menu_id"], m["path"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(m)

    uniq.sort(key=lambda x: (x["path"], x["menu_id"]))

    if MAX_MENUS_PER_ROLE is not None:
        uniq = uniq[:MAX_MENUS_PER_ROLE]

    return uniq


# ============================================================
# Main processing
# ============================================================
def main():
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"입력 CSV를 찾을 수 없음: {INPUT_CSV}")

    OUT_BASE.mkdir(parents=True, exist_ok=True)
    OUT_BY_TEAM.mkdir(parents=True, exist_ok=True)
    OUT_BAD.mkdir(parents=True, exist_ok=True)

    # UTF-8 BOM 대응 + NA 처리 방지(문자열 깨짐 예방)
    df = pd.read_csv(
        INPUT_CSV,
        dtype=str,
        encoding="utf-8-sig",
        keep_default_na=False,
        na_filter=False,
    )

    required_cols = ["team_name", "team_code", "page_content"]
    for c in required_cols:
        if c not in df.columns:
            raise ValueError(f"CSV에 필요한 컬럼이 없습니다: {c}. 현재 컬럼={list(df.columns)}")

    teams_map: Dict[str, str] = {}  # team_code -> team_name
    systems_by_team: Dict[str, Dict[str, str]] = {}  # team_code -> {sys_code: sys_name}
    roles_by_team_sys: Dict[str, Dict[str, Dict[str, str]]] = {}  # "team|sys" -> {auth_code: role}

    # team_code -> {"sys|auth": bundle}
    bundles_by_team: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for idx, r in df.iterrows():
        team_code = str(r["team_code"]).strip()
        team_name = str(r["team_name"]).strip()
        raw = r["page_content"]

        if not team_code or not team_name:
            continue

        teams_map[team_code] = team_name

        try:
            obj = parse_page_content(raw)
        except Exception as e:
            bad_path = OUT_BAD / f"bad_row_{idx}.txt"
            bad_path.write_text(str(raw), encoding="utf-8", errors="replace")
            raise ValueError(f"[ROW {idx}] page_content 파싱 실패. 덤프 파일: {bad_path}") from e

        systems = obj.get("systems", []) or []
        for sys in systems:
            sys_code = str(sys.get("sys_code", "")).strip()
            sys_name = str(sys.get("sys_name", "")).strip()
            if not sys_code:
                continue

            systems_by_team.setdefault(team_code, {})
            systems_by_team[team_code][sys_code] = sys_name

            org_auth = sys.get("org_auth", []) or []
            for auth in org_auth:
                auth_code = str(auth.get("auth_code", "")).strip()
                auth_name = str(auth.get("auth_name", "")).strip()
                auth_desc = str(auth.get("auth_desc", "")).strip()

                if not auth_code:
                    continue

                # index_roles_by_team_sys
                team_sys_key = f"{team_code}|{sys_code}"
                roles_by_team_sys.setdefault(team_sys_key, {})
                roles_by_team_sys[team_sys_key][auth_code] = {
                    "auth_code": auth_code,
                    "auth_name": auth_name,
                    "auth_desc": auth_desc
                }

                # role bundle (team별 JSONL)
                menus = extract_menus(auth)

                bundles_by_team.setdefault(team_code, {})
                sys_auth_key = f"{sys_code}|{auth_code}"

                if sys_auth_key not in bundles_by_team[team_code]:
                    bundles_by_team[team_code][sys_auth_key] = {
                        "team_code": team_code,
                        "team_name": team_name,
                        "sys_code": sys_code,
                        "sys_name": sys_name,
                        "auth_code": auth_code,
                        "auth_name": auth_name,
                        "auth_desc": auth_desc,
                        "menus": menus
                    }
                else:
                    # 같은 sys/auth가 중복될 경우 메뉴 합치기
                    existing = bundles_by_team[team_code][sys_auth_key]
                    seen = {(m["menu_id"], m["path"]) for m in existing["menus"]}
                    for m in menus:
                        k = (m["menu_id"], m["path"])
                        if k not in seen:
                            existing["menus"].append(m)
                            seen.add(k)
                    existing["menus"].sort(key=lambda x: (x["path"], x["menu_id"]))

    # ------------------------------------------------------------
    # 파일 생성 (요구 포맷/경로 고정)
    # ------------------------------------------------------------

    # 1) index_teams.json
    index_teams = {
        "teams": [{"team_code": tc, "team_name": tn}
                  for tc, tn in sorted(teams_map.items(), key=lambda x: x[1])]
    }
    (OUT_BASE / "index_teams.json").write_text(
        json.dumps(index_teams, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # 2) index_systems_by_team.json
    index_systems: Dict[str, List[Dict[str, str]]] = {}
    for tc, sysmap in systems_by_team.items():
        index_systems[tc] = [{"sys_code": sc, "sys_name": sn}
                             for sc, sn in sorted(sysmap.items(), key=lambda x: x[1])]
    (OUT_BASE / "index_systems_by_team.json").write_text(
        json.dumps(index_systems, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # 3) index_roles_by_team_sys.json
    index_roles: Dict[str, List[Dict[str, str]]] = {}
    for k, rolemap in roles_by_team_sys.items():
        roles_sorted = sorted(rolemap.values(), key=lambda x: (x.get("auth_name", ""), x.get("auth_code", "")))
        index_roles[k] = roles_sorted

    (OUT_BASE / "index_roles_by_team_sys.json").write_text(
        json.dumps(index_roles, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # 4) role_bundle_team_<team_code>.jsonl
    for tc, bundle_map in bundles_by_team.items():
        out_path = OUT_BY_TEAM / f"role_bundle_team_{tc}.jsonl"
        rows = list(bundle_map.values())
        rows.sort(key=lambda b: (b["sys_name"], b["auth_name"], b["auth_code"]))

        with out_path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("✅ 전처리 완료. 생성된 파일:")
    print(f"- {OUT_BASE / 'index_teams.json'}")
    print(f"- {OUT_BASE / 'index_systems_by_team.json'}")
    print(f"- {OUT_BASE / 'index_roles_by_team_sys.json'}")
    print(f"- {OUT_BY_TEAM} / role_bundle_team_<team_code>.jsonl")
    print(f"(파싱 실패 행이 있으면 {OUT_BAD} 폴더에 덤프됨)")

if __name__ == "__main__":
    main()
