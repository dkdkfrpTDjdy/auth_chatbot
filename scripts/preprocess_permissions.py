import json
import re
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

# =========================
# 설정
# =========================
REPO_DIR = Path(r"D:\works\GEN_AI\auth_chat\auth_chat_2")
INPUT_XLSX = REPO_DIR / "사용자_조직_권한_메뉴 매핑_20251218_v1.2.xlsx"  # ← 파일명 맞춰줘

# 시트명
SHEET_IAS_USER = "IAS_Sales"       # 유저별
SHEET_IAS_TEAM = "IAS_sales_조직"  # 팀(조직)별
SHEET_SAP = "SAP"                  # SAP 시트명 실제와 다르면 수정

# 출력 경로 (고정)
OUT_BASE = REPO_DIR / "public" / "data"
OUT_BY_TEAM = OUT_BASE / "by_team"

# IAS sys_name 통일(요구사항)
IAS_SYS_NAME_FORCED = "IAS_Sales"

# SAP auth_desc 생성 규칙
SAP_DESC_TOPN = 3

# =========================
# 유틸
# =========================
def norm_str(x) -> str:
    if x is None:
        return ""
    s = str(x).strip()
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\s+\n", "\n", s)
    return s

def ensure_cols(df: pd.DataFrame, cols: List[str], sheet_name: str):
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"[{sheet_name}] 시트에 컬럼이 없습니다: {missing}\n현재 컬럼: {list(df.columns)}")

def build_sap_auth_desc(menu_names: List[str], topn: int = 3) -> str:
    uniq = []
    seen = set()
    for m in menu_names:
        m = norm_str(m)
        if not m:
            continue
        if m in seen:
            continue
        seen.add(m)
        uniq.append(m)

    if not uniq:
        return "해당 권한은 여러 메뉴 접근 권한이 있습니다."

    sample = uniq[:topn]
    return f"{', '.join(sample)} 등의 메뉴 접근 권한이 있습니다."

# =========================
# 공통 변환(평탄 테이블 -> outputs)
# =========================
def rows_to_outputs(df: pd.DataFrame, is_sap: bool) -> Dict:
    # 팀명 컬럼 우선순위: team_name2 > team_name
    if "team_name2" in df.columns:
        team_name_col = "team_name2"
    elif "team_name" in df.columns:
        team_name_col = "team_name"
    else:
        raise ValueError("팀명 컬럼(team_name2 또는 team_name)이 없습니다.")

    df = df.copy()

    # 문자열 정리
    df[team_name_col] = df[team_name_col].map(norm_str)
    df["team_code"] = df["team_code"].map(norm_str)

    df["sys_name"] = df["sys_name"].map(norm_str)
    df["sys_code"] = df["sys_code"].map(norm_str)

    df["auth_name"] = df["auth_name"].map(norm_str)
    df["auth_code"] = df["auth_code"].map(norm_str)

    if "auth_desc" in df.columns:
        df["auth_desc"] = df["auth_desc"].map(norm_str)
    else:
        df["auth_desc"] = ""

    df["1level"] = df["1level"].map(norm_str)
    df["2level"] = df["2level"].map(norm_str)
    df["3level"] = df["3level"].map(norm_str)
    df["menu_id"] = df["menu_id"].map(norm_str)

    # user 컬럼은 있어도 무시 (drop 안 해도 됨)

    # 핵심 중복 제거: 같은 팀/시스템/권한/메뉴는 1개만
    df = df.drop_duplicates(subset=["team_code", "sys_code", "auth_code", "menu_id"])

    # index_teams
    teams = (
        df[[team_name_col, "team_code"]]
        .drop_duplicates()
        .rename(columns={team_name_col: "team_name"})
    )
    teams_records = (
        teams.sort_values("team_name")[["team_code", "team_name"]]
        .to_dict(orient="records")
    )

    # index_systems_by_team
    systems_by_team: Dict[str, Dict[str, str]] = {}
    for team_code, g in df.groupby("team_code"):
        sysmap = {}
        for _, r in g[["sys_code", "sys_name"]].drop_duplicates().iterrows():
            sysmap[r["sys_code"]] = r["sys_name"]
        systems_by_team[team_code] = [
            {"sys_code": sc, "sys_name": sn}
            for sc, sn in sorted(sysmap.items(), key=lambda x: x[1])
        ]

    # index_roles_by_team_sys
    roles_by_team_sys: Dict[str, List[Dict[str, str]]] = {}
    sap_menu_names_by_role: Dict[str, List[str]] = {}

    for (team_code, sys_code), g in df.groupby(["team_code", "sys_code"]):
        key = f"{team_code}|{sys_code}"
        role_map = {}

        for _, r in g[["auth_code", "auth_name", "auth_desc"]].drop_duplicates().iterrows():
            ac = r["auth_code"]
            role_map[ac] = {
                "auth_code": ac,
                "auth_name": r["auth_name"],
                "auth_desc": r["auth_desc"],
            }

        roles_by_team_sys[key] = sorted(role_map.values(), key=lambda x: (x["auth_name"], x["auth_code"]))

        if is_sap:
            for auth_code, gg in g.groupby("auth_code"):
                k2 = f"{team_code}|{sys_code}|{auth_code}"
                sap_menu_names_by_role[k2] = gg["3level"].tolist()

    # SAP auth_desc 자동 생성
    if is_sap:
        for key, role_list in roles_by_team_sys.items():
            team_code, sys_code = key.split("|", 1)
            for role in role_list:
                if role.get("auth_desc"):
                    continue
                k2 = f"{team_code}|{sys_code}|{role['auth_code']}"
                role["auth_desc"] = build_sap_auth_desc(sap_menu_names_by_role.get(k2, []), topn=SAP_DESC_TOPN)

    # role_bundle_team_XXXX.jsonl
    df["path"] = df["1level"] + " > " + df["2level"] + " > " + df["3level"]

    bundles_by_team: Dict[str, Dict[str, Dict]] = {}
    for team_code, g_team in df.groupby("team_code"):
        team_name = g_team[team_name_col].iloc[0]
        bundles_by_team.setdefault(team_code, {})

        for (sys_code, auth_code), g in g_team.groupby(["sys_code", "auth_code"]):
            meta = g[["sys_name", "auth_name", "auth_desc"]].iloc[0].to_dict()

            menus = (
                g[["path", "menu_id"]]
                .drop_duplicates()
                .sort_values(["path", "menu_id"])
                .to_dict(orient="records")
            )

            bundle = {
                "team_code": team_code,
                "team_name": team_name,
                "sys_code": sys_code,
                "sys_name": meta["sys_name"],
                "auth_code": auth_code,
                "auth_name": meta["auth_name"],
                "auth_desc": meta.get("auth_desc", ""),
                "menus": menus,
            }
            bundles_by_team[team_code][f"{sys_code}|{auth_code}"] = bundle

    return {
        "teams_records": teams_records,
        "systems_by_team": systems_by_team,
        "roles_by_team_sys": roles_by_team_sys,
        "bundles_by_team": bundles_by_team,
    }

# =========================
# 출력 병합 (IAS + SAP)
# =========================
def merge_outputs(base: Dict, add: Dict) -> Dict:
    # teams
    team_map = {(t["team_code"], t["team_name"]) for t in base["teams_records"]}
    for t in add["teams_records"]:
        team_map.add((t["team_code"], t["team_name"]))
    base["teams_records"] = [{"team_code": tc, "team_name": tn} for tc, tn in sorted(team_map, key=lambda x: x[1])]

    # systems
    for team_code, sys_list in add["systems_by_team"].items():
        base["systems_by_team"].setdefault(team_code, [])
        existing = {s["sys_code"]: s["sys_name"] for s in base["systems_by_team"][team_code]}
        for s in sys_list:
            existing[s["sys_code"]] = s["sys_name"]
        base["systems_by_team"][team_code] = [{"sys_code": sc, "sys_name": sn} for sc, sn in sorted(existing.items(), key=lambda x: x[1])]

    # roles
    for key, roles in add["roles_by_team_sys"].items():
        base["roles_by_team_sys"].setdefault(key, [])
        existing = {r["auth_code"]: r for r in base["roles_by_team_sys"][key]}
        for r in roles:
            if r["auth_code"] in existing:
                if not existing[r["auth_code"]].get("auth_desc") and r.get("auth_desc"):
                    existing[r["auth_code"]]["auth_desc"] = r["auth_desc"]
                if not existing[r["auth_code"]].get("auth_name") and r.get("auth_name"):
                    existing[r["auth_code"]]["auth_name"] = r["auth_name"]
            else:
                existing[r["auth_code"]] = r
        base["roles_by_team_sys"][key] = sorted(existing.values(), key=lambda x: (x["auth_name"], x["auth_code"]))

    # bundles
    for team_code, bundle_map in add["bundles_by_team"].items():
        base["bundles_by_team"].setdefault(team_code, {})
        for sys_auth, bundle in bundle_map.items():
            if sys_auth not in base["bundles_by_team"][team_code]:
                base["bundles_by_team"][team_code][sys_auth] = bundle
            else:
                existing = base["bundles_by_team"][team_code][sys_auth]
                seen = {(m["menu_id"], m["path"]) for m in existing["menus"]}
                for m in bundle["menus"]:
                    k = (m["menu_id"], m["path"])
                    if k not in seen:
                        existing["menus"].append(m)
                        seen.add(k)
                existing["menus"].sort(key=lambda x: (x["path"], x["menu_id"]))
                if not existing.get("auth_desc") and bundle.get("auth_desc"):
                    existing["auth_desc"] = bundle["auth_desc"]

    return base

# =========================
# main
# =========================
def main():
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    OUT_BY_TEAM.mkdir(parents=True, exist_ok=True)

    # 필수 컬럼(공통)
    need_cols = ["sys_name", "sys_code", "auth_name", "auth_code", "team_code", "menu_id", "1level", "2level", "3level"]

    # ===== IAS (유저/팀) 2개 시트 로드 후 합치기 =====
    df_ias_user = pd.read_excel(INPUT_XLSX, sheet_name=SHEET_IAS_USER, dtype=str)
    df_ias_team = pd.read_excel(INPUT_XLSX, sheet_name=SHEET_IAS_TEAM, dtype=str)

    ensure_cols(df_ias_user, need_cols, SHEET_IAS_USER)
    ensure_cols(df_ias_team, need_cols, SHEET_IAS_TEAM)

    # 합치기(유저/팀)
    df_ias = pd.concat([df_ias_user, df_ias_team], ignore_index=True)

    # 유저 무시 (컬럼이 있으면 drop 해도 되고 안 해도 됨)
    for col in ["user_name", "user_id", "end_date", "URL"]:
        if col in df_ias.columns:
            pass

    # IAS sys_name 통일
    df_ias["sys_name"] = IAS_SYS_NAME_FORCED

    # auth_desc는 IAS 쪽에 있으므로 있으면 유지, 없으면 빈 값
    if "auth_desc" not in df_ias.columns:
        df_ias["auth_desc"] = ""

    # ===== SAP 로드 =====
    df_sap = pd.read_excel(INPUT_XLSX, sheet_name=SHEET_SAP, dtype=str)
    ensure_cols(df_sap, need_cols, SHEET_SAP)
    if "auth_desc" not in df_sap.columns:
        df_sap["auth_desc"] = ""

    # ===== 변환 =====
    out_ias = rows_to_outputs(df_ias, is_sap=False)
    out_sap = rows_to_outputs(df_sap, is_sap=True)

    merged = {
        "teams_records": out_ias["teams_records"],
        "systems_by_team": out_ias["systems_by_team"],
        "roles_by_team_sys": out_ias["roles_by_team_sys"],
        "bundles_by_team": out_ias["bundles_by_team"],
    }
    merged = merge_outputs(merged, out_sap)

    # ===== 파일 쓰기 =====
    (OUT_BASE / "index_teams.json").write_text(
        json.dumps({"teams": merged["teams_records"]}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    (OUT_BASE / "index_systems_by_team.json").write_text(
        json.dumps(merged["systems_by_team"], ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    (OUT_BASE / "index_roles_by_team_sys.json").write_text(
        json.dumps(merged["roles_by_team_sys"], ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    for team_code, bundle_map in merged["bundles_by_team"].items():
        out_path = OUT_BY_TEAM / f"role_bundle_team_{team_code}.jsonl"
        rows = list(bundle_map.values())
        rows.sort(key=lambda b: (b["sys_name"], b["auth_name"], b["auth_code"]))
        with out_path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("✅ 완료")
    print(f"- {OUT_BASE / 'index_teams.json'}")
    print(f"- {OUT_BASE / 'index_systems_by_team.json'}")
    print(f"- {OUT_BASE / 'index_roles_by_team_sys.json'}")
    print(f"- {OUT_BY_TEAM} / role_bundle_team_<team_code>.jsonl")

if __name__ == "__main__":
    main()
