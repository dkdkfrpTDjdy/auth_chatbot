import json
import re
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd

# =========================
# 설정
# =========================
REPO_DIR = Path(r"D:\works\GEN_AI\auth_chat\auth_chat_2_restore")
INPUT_XLSX = REPO_DIR / "사용자_조직_권한_메뉴 매핑_20251218_v1.2.xlsx"

SHEET_IAS_USER = "IAS_Sales"
SHEET_IAS_TEAM = "IAS_sales_조직"
SHEET_SAP = "SAP"

OUT_BASE = REPO_DIR / "public" / "data"
OUT_BY_TEAM = OUT_BASE / "by_team"

IAS_SYS_NAME_FORCED = "IAS_Sales"
SAP_DESC_TOPN = 3

# =========================
# 유틸
# =========================
def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = df.columns.map(lambda c: str(c).strip())
    return df

def norm_text(x) -> str:
    """설명/이름/레벨 텍스트용: NaN/None만 ''로, 나머지는 그대로 문자열화"""
    if x is None or pd.isna(x):
        return ""
    s = str(x)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    # 공백만 과하게 정리하지 말고, 줄바꿈 주변만 살짝 정돈
    s = re.sub(r"[ \t]+\n", "\n", s)
    return s.strip()

def norm_code(x) -> str:
    """코드용: 1.0 -> '1' 같은 .0 제거 + NaN/None -> '' """
    if x is None or pd.isna(x):
        return ""
    # 숫자로 들어온 케이스
    if isinstance(x, (int,)):
        return str(x)
    if isinstance(x, float):
        # 1.0 같이 정수형 float이면 int로
        if float(x).is_integer():
            return str(int(x))
        # 정수가 아니면 그대로 문자열(원하면 반올림 규칙 추가 가능)
        return str(x)

    # 문자열로 들어온 케이스들
    s = str(x).strip()
    # "001.0" 같은 것도 올 수 있으니, 딱 끝이 ".0"인 경우만 제거
    if re.fullmatch(r"-?\d+\.0", s):
        s = s[:-2]
    return s

def ensure_cols(df: pd.DataFrame, cols: List[str], sheet_name: str):
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"[{sheet_name}] 시트에 컬럼이 없습니다: {missing}\n현재 컬럼: {list(df.columns)}")

def first_non_empty(series: pd.Series, is_code: bool = False) -> str:
    for v in series.tolist():
        vv = norm_code(v) if is_code else norm_text(v)
        if vv:
            return vv
    return ""

def build_sap_auth_desc(level3_list: List[str], topn: int = 3) -> str:
    uniq = []
    seen = set()
    for m in level3_list:
        m = norm_text(m)
        if not m:
            continue
        if m in seen:
            continue
        seen.add(m)
        uniq.append(m)
    if not uniq:
        return "여러 메뉴 등이 있습니다."
    return f"{', '.join(uniq[:topn])} 등이 있습니다."

# =========================
# 읽기: 원본 그대로 읽고(=dtype=str 사용 X) -> 우리가 직접 문자열 변환
# =========================
def read_sheet_raw(path: Path, sheet: str) -> pd.DataFrame:
    # keep_default_na=True(기본)여도 상관없음. 우리는 norm_*에서 처리.
    df = pd.read_excel(path, sheet_name=sheet)
    return clean_columns(df)

# =========================
# 정규화: 컬럼별로 안전하게 변환
# =========================
def normalize_df(df: pd.DataFrame, is_ias: bool, is_sap: bool) -> pd.DataFrame:
    df = df.copy()

    # IAS sys_name 강제 통일
    if is_ias:
        df["sys_name"] = IAS_SYS_NAME_FORCED

    # auth_desc 컬럼이 없으면 만들기(특히 SAP)
    if "auth_desc" not in df.columns:
        df["auth_desc"] = ""

    # team_name 컬럼 선택
    if "team_name2" not in df.columns and "team_name" not in df.columns:
        raise ValueError("팀명 컬럼(team_name2 또는 team_name)이 없습니다.")

    # 코드/텍스트 컬럼 변환
    code_cols = ["team_code", "sys_code", "auth_code", "menu_id"]
    text_cols = ["team_name2", "team_name", "sys_name", "auth_name", "auth_desc", "1level", "2level", "3level"]

    for c in code_cols:
        if c in df.columns:
            df[c] = df[c].map(norm_code)
        else:
            # menu_id 같은 게 없는 시트는 없겠지만 방어
            df[c] = ""

    for c in text_cols:
        if c in df.columns:
            df[c] = df[c].map(norm_text)
        else:
            df[c] = ""

    # SAP: auth_desc가 비었으면 생성(권한 단위)
    if is_sap:
        # 권한별로 3level 모아 desc 생성
        sap_desc_map = (
            df.groupby(["team_code", "sys_code", "auth_code"])["3level"]
              .apply(lambda s: build_sap_auth_desc(s.tolist(), topn=SAP_DESC_TOPN))
              .to_dict()
        )

        def fill_sap_desc(row):
            if row["auth_desc"].strip():
                return row["auth_desc"]
            return sap_desc_map.get((row["team_code"], row["sys_code"], row["auth_code"]), "")

        df["auth_desc"] = df.apply(fill_sap_desc, axis=1)

    return df

# =========================
# 핵심: auth_desc 보존을 위해 "권한 메타 맵"을 먼저 만든 뒤 강제 주입
# =========================
def build_role_meta_map(df: pd.DataFrame, is_sap: bool) -> Dict[Tuple[str, str, str], Dict[str, str]]:
    """
    key = (team_code, sys_code, auth_code)
    value = {"auth_name": ..., "auth_desc": ...}
    """
    meta: Dict[Tuple[str, str, str], Dict[str, str]] = {}

    for (team_code, sys_code, auth_code), g in df.groupby(["team_code", "sys_code", "auth_code"]):
        auth_name = first_non_empty(g["auth_name"])
        auth_desc = first_non_empty(g["auth_desc"])

        # SAP 최후 안전망
        if is_sap and not auth_desc:
            auth_desc = build_sap_auth_desc(g["3level"].tolist(), topn=SAP_DESC_TOPN)

        meta[(team_code, sys_code, auth_code)] = {
            "auth_name": auth_name,
            "auth_desc": auth_desc,
        }
    return meta

# =========================
# outputs 생성
# =========================
def to_outputs(df: pd.DataFrame, is_sap: bool) -> Dict:
    # 팀명 컬럼 우선순위
    team_name_col = "team_name2" if "team_name2" in df.columns else "team_name"

    # ✅ 권한 메타(=auth_desc 보존) 맵 먼저 생성
    role_meta = build_role_meta_map(df, is_sap=is_sap)

    # ✅ 메뉴 기준 중복 제거는 해도 됨 (auth_desc는 role_meta로 복원/주입)
    df_menu = df.drop_duplicates(subset=["team_code", "sys_code", "auth_code", "menu_id"]).copy()

    # index_teams
    teams = (
        df_menu[[team_name_col, "team_code"]]
        .drop_duplicates()
        .rename(columns={team_name_col: "team_name"})
    )
    teams_records = (
        teams.sort_values("team_name")[["team_code", "team_name"]]
        .to_dict(orient="records")
    )

    # index_systems_by_team
    systems_by_team: Dict[str, List[Dict[str, str]]] = {}
    for team_code, g in df_menu.groupby("team_code"):
        sysmap = {}
        for _, r in g[["sys_code", "sys_name"]].drop_duplicates().iterrows():
            sysmap[r["sys_code"]] = r["sys_name"]
        systems_by_team[team_code] = [
            {"sys_code": sc, "sys_name": sn}
            for sc, sn in sorted(sysmap.items(), key=lambda x: x[1])
        ]

    # index_roles_by_team_sys (auth_desc는 role_meta에서 강제 주입)
    roles_by_team_sys: Dict[str, List[Dict[str, str]]] = {}
    for (team_code, sys_code), g_ts in df_menu.groupby(["team_code", "sys_code"]):
        key = f"{team_code}|{sys_code}"
        role_list = []
        for auth_code in sorted(g_ts["auth_code"].unique()):
            m = role_meta.get((team_code, sys_code, auth_code), {"auth_name": "", "auth_desc": ""})
            role_list.append({
                "auth_code": auth_code,
                "auth_name": m["auth_name"],
                "auth_desc": m["auth_desc"],
            })
        roles_by_team_sys[key] = sorted(role_list, key=lambda x: (x["auth_name"], x["auth_code"]))

    # bundles
    df_menu["path"] = df_menu["1level"] + " > " + df_menu["2level"] + " > " + df_menu["3level"]

    bundles_by_team: Dict[str, Dict[str, Dict]] = {}
    for team_code, g_team in df_menu.groupby("team_code"):
        team_name = first_non_empty(g_team[team_name_col])
        bundles_by_team.setdefault(team_code, {})

        for (sys_code, auth_code), g in g_team.groupby(["sys_code", "auth_code"]):
            sys_name = first_non_empty(g["sys_name"])

            m = role_meta.get((team_code, sys_code, auth_code), {"auth_name": "", "auth_desc": ""})

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
                "sys_name": sys_name,
                "auth_code": auth_code,
                "auth_name": m["auth_name"],
                "auth_desc": m["auth_desc"],  # ✅ 여기서도 강제 주입
                "menus": menus,
            }
            bundles_by_team[team_code][f"{sys_code}|{auth_code}"] = bundle

    return {
        "teams_records": teams_records,
        "systems_by_team": systems_by_team,
        "roles_by_team_sys": roles_by_team_sys,
        "bundles_by_team": bundles_by_team,
    }

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

    # roles (auth_desc 빈값으로 덮어쓰지 않게)
    for key, roles in add["roles_by_team_sys"].items():
        base["roles_by_team_sys"].setdefault(key, [])
        existing = {r["auth_code"]: r for r in base["roles_by_team_sys"][key]}
        for r in roles:
            ac = r["auth_code"]
            if ac not in existing:
                existing[ac] = r
            else:
                # base가 비어있고 add가 있으면 채움
                if not existing[ac].get("auth_desc") and r.get("auth_desc"):
                    existing[ac]["auth_desc"] = r["auth_desc"]
                if not existing[ac].get("auth_name") and r.get("auth_name"):
                    existing[ac]["auth_name"] = r["auth_name"]
        base["roles_by_team_sys"][key] = sorted(existing.values(), key=lambda x: (x["auth_name"], x["auth_code"]))

    # bundles
    for team_code, bundle_map in add["bundles_by_team"].items():
        base["bundles_by_team"].setdefault(team_code, {})
        for sys_auth, bundle in bundle_map.items():
            if sys_auth not in base["bundles_by_team"][team_code]:
                base["bundles_by_team"][team_code][sys_auth] = bundle
            else:
                existing = base["bundles_by_team"][team_code][sys_auth]
                # 메뉴 병합
                seen = {(m["menu_id"], m["path"]) for m in existing["menus"]}
                for m in bundle["menus"]:
                    k = (m["menu_id"], m["path"])
                    if k not in seen:
                        existing["menus"].append(m)
                        seen.add(k)
                existing["menus"].sort(key=lambda x: (x["path"], x["menu_id"]))
                # auth_desc는 빈값이면 채움
                if not existing.get("auth_desc") and bundle.get("auth_desc"):
                    existing["auth_desc"] = bundle["auth_desc"]

    return base

# =========================
# main
# =========================
def main():
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    OUT_BY_TEAM.mkdir(parents=True, exist_ok=True)

    need_cols = ["sys_name", "sys_code", "auth_name", "auth_code", "team_code", "menu_id", "1level", "2level", "3level"]

    # ===== IAS =====
    df_ias_user = read_sheet_raw(INPUT_XLSX, SHEET_IAS_USER)
    df_ias_team = read_sheet_raw(INPUT_XLSX, SHEET_IAS_TEAM)

    ensure_cols(df_ias_user, need_cols, SHEET_IAS_USER)
    ensure_cols(df_ias_team, need_cols, SHEET_IAS_TEAM)

    df_ias = pd.concat([df_ias_user, df_ias_team], ignore_index=True)
    df_ias = normalize_df(df_ias, is_ias=True, is_sap=False)

    # ===== SAP =====
    df_sap = read_sheet_raw(INPUT_XLSX, SHEET_SAP)
    ensure_cols(df_sap, need_cols, SHEET_SAP)
    df_sap = normalize_df(df_sap, is_ias=False, is_sap=True)

    # ===== (필수 디버그) team_code .0 확인 + auth_desc 존재 확인 =====
    # 여기서 제대로 나오면 "읽기/변환"은 성공이고, JSON 생성단에서 날아가던 문제였던 것.
    print("IAS team_code sample:", df_ias["team_code"].head(5).tolist())
    print("IAS auth_desc non-empty rows:", (df_ias["auth_desc"] != "").sum(), "/", len(df_ias))
    print(df_ias[["team_code", "sys_code", "auth_code", "auth_name", "auth_desc"]].head(10))

    # ===== outputs =====
    out_ias = to_outputs(df_ias, is_sap=False)
    out_sap = to_outputs(df_sap, is_sap=True)

    merged = {
        "teams_records": out_ias["teams_records"],
        "systems_by_team": out_ias["systems_by_team"],
        "roles_by_team_sys": out_ias["roles_by_team_sys"],
        "bundles_by_team": out_ias["bundles_by_team"],
    }
    merged = merge_outputs(merged, out_sap)

    # ===== write =====
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
