# -*- coding: utf-8 -*-
"""
✅ 바로 실행 가능한 수정본 (삭제 금지 / 증분 추가-only)

핵심 변경점
1) "이전 산출물(out_base)"을 읽어서 base로 삼고, 이번 전처리 결과를 UNION merge
   - 팀/시스템/권한/번들 모두 "없다고 삭제" 하지 않음 (NEVER DELETE)
2) team_code / dept_code / role_code 등 코드 정규화 강화(선행0/float .0 등)
3) apply_level_mapping의 out.get(...) 버그 수정(컬럼 없을 때 .map 호출 오류 방지)
4) 기존 by_team/*.jsonl까지 읽어서 번들도 보존(가능한 경우)

사용 방법
- CONFIG.paths.excel_a / excel_b / out_base / out_xlsx 경로만 본인 환경에 맞게 확인
- 기존 산출물이 out_base 아래에 존재하면: merge 수행(추가-only)
- 없으면: 이번 결과만 생성
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import pandas as pd


# =========================
# CONFIG
# =========================
CONFIG: Dict = {
    "paths": {
        "excel_a": r"C:\Users\User\Downloads\AM 내 최신 권한 데이터_260206.xlsx",
        "excel_b": r"D:\works\GEN_AI\auth_chat\auth_chat_2_restore\사용자_조직_권한_메뉴 매핑_20251218_v1.2.xlsx",

        "out_xlsx": r"C:\Users\User\Downloads\OUTPUT_팀별권한_통합_결과.xlsx",

        # ✅ 기존 산출물이 이미 있는 폴더(append-only merge 기준)
        "out_base": r"D:\works\GEN_AI\auth_chat\auth_chat_2_restore\public\data",
    },
    "sheets_a": {
        "sap_users": ["SAP 권한별 임직원"],
        "ias_users": ["IAS 권한별 임직원"],
        "mro_users": ["MRO 권한별 임직원"],
        "srm_users": ["SRM 권한별 임직원"],
        "eaccount_users": ["eAccount 권한별 임직원"],
        "team_target": ["팀별 권한"],
        "sap_role_tcode": ["SAP 역할별 TCODE"],
        "role_menu": ["역할별 메뉴"],
    },
    "sheets_b": {
        "ias_sales": ["IAS_Sales", "IAS_sales_조직", "IAS_sales"],  # 방어적으로 후보 추가
        "sap": ["SAP"],
    },
    "cols_a_user": {
        "name": ["이름"],
        "empno": ["사번"],
        "sys_name": ["시스템명"],
        "role_name": ["역할명"],
        "role_code": ["역할코드"],
        "desc": ["설명"],
        "start_date": ["시작일자"],
        "end_date": ["종료일자"],
        "dept_name": ["부서명"],
        "dept_code": ["부서코드"],
    },
    "cols_a_sap_tcode": {
        "role_name": ["역할명"],
        "role_code": ["역할코드"],
        "menu_name": ["메뉴명"],
        "menu_code": ["메뉴코드"],
    },
    "cols_a_role_menu": {
        "role_id": ["역할ID"],
        "role_name": ["역할명"],
        "menu_id": ["메뉴ID"],
        "menu_name": ["메뉴명"],
        "url": ["URL"],
    },
    "cols_b": {
        # IAS_Sales
        "ias_menu_name": ["menu_name", "3level"],
        "ias_menu_id": ["menu_id"],
        "ias_1": ["1level"],
        "ias_2": ["2level"],
        "ias_3": ["3level"],

        # SAP
        "sap_menu_id": ["menu_id"],
        "sap_1": ["1level"],
        "sap_2": ["2level"],
        "sap_3": ["3level"],  # (요구사항) SAP는 A.menu_name == B.3level
    },
    "constants": {
        "sap_desc_topn": 3,
        "out_sheet1": "팀별 권한_통합",
        "out_sheet2": "팀별 권한_통합_메뉴매핑",
        "out_sheet_log": "로그",
        "IAS_SYS_NAME_FORCED": "IAS_Sales",
    },
}


# =========================
# 유틸
# =========================
def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = df.columns.map(lambda c: str(c).strip())
    return df


def norm_text(x) -> str:
    if x is None or pd.isna(x):
        return ""
    s = str(x)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+\n", "\n", s)
    return s.strip()


def norm_code(x) -> str:
    """역할코드/메뉴ID 등: float .0 제거 + strip"""
    if x is None or pd.isna(x):
        return ""
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if float(x).is_integer():
            return str(int(x))
        return str(x)
    s = str(x).strip()
    if re.fullmatch(r"-?\d+\.0", s):
        s = s[:-2]
    return s


def canon_team_code(x) -> str:
    """
    팀/부서코드 canonicalize:
    - 숫자만 있으면 선행0 제거 (0100440 -> 100440)
    - "0RULE_" 같은 특수 코드는 그대로 유지
    """
    if x is None or pd.isna(x):
        return ""
    s = str(x).strip()
    if s.endswith(".0"):
        s = s[:-2]
    if s.startswith("0RULE_"):
        return s
    if re.fullmatch(r"\d+", s):
        s2 = s.lstrip("0")
        return s2 if s2 != "" else "0"
    return s


def pick_first_existing_col(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def ensure_any_col(df: pd.DataFrame, candidates: List[str], label: str, sheet_name: str) -> str:
    c = pick_first_existing_col(df, candidates)
    if c is None:
        raise ValueError(f"[{sheet_name}] '{label}' 컬럼 후보가 없습니다: {candidates}\n현재 컬럼: {list(df.columns)}")
    return c


def resolve_sheet_name(path: Path, candidates: List[str]) -> str:
    xls = pd.ExcelFile(path)
    for c in candidates:
        if c in xls.sheet_names:
            return c
    raise ValueError(f"시트를 찾지 못했습니다. 후보={candidates}\n실제 시트={xls.sheet_names}")


def read_sheet_raw(path: Path, sheet: str) -> pd.DataFrame:
    df = pd.read_excel(path, sheet_name=sheet)
    return clean_columns(df)


def build_sap_role_desc(menu_or_role_names: List[str], topn: int = 3) -> str:
    uniq, seen = [], set()
    for m in menu_or_role_names:
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


def log_join_rate(tag: str, left_cnt: int, matched_cnt: int):
    rate = 0.0 if left_cnt == 0 else (matched_cnt / left_cnt * 100.0)
    print(f"[JOIN] {tag}: matched {matched_cnt}/{left_cnt} ({rate:.2f}%)")


# =========================
# 요구 1) 중복제거
# =========================
def dedup_drop_name_emp(df: pd.DataFrame, sheet_name: str, name_col: str, emp_col: str) -> Tuple[pd.DataFrame, int, int]:
    before = len(df)
    df2 = df.drop(columns=[name_col, emp_col], errors="ignore").copy()
    df2 = df2.drop_duplicates()
    after = len(df2)
    print(f"[DEDUP] {sheet_name}: {before} -> {after} (drop name/emp then drop_duplicates)")
    return df2, before, after


# =========================
# 요구 2/4/5) 팀별권한 포맷 변환
# =========================
def to_team_priv_format(
    df_src: pd.DataFrame,
    sheet_name: str,
    sys_code: str,
    col_dept_name: str,
    col_dept_code: str,
    col_role_code: str,
    col_role_name: str,
    col_desc: Optional[str],
    col_start: Optional[str],
    col_end: Optional[str],
) -> pd.DataFrame:
    df = df_src.copy()

    df["team_name"] = df[col_dept_name].map(norm_text)
    df["team_code"] = df[col_dept_code].map(canon_team_code)

    df["sys_code"] = norm_text(sys_code)
    df["sys_name"] = norm_text(sys_code)

    df["auth_code"] = df[col_role_code].map(norm_code)
    df["auth_name"] = df[col_role_name].map(norm_text)

    if col_desc and col_desc in df.columns:
        df["auth_desc"] = df[col_desc].map(norm_text)
    else:
        df["auth_desc"] = ""

    if col_start and col_start in df.columns:
        df["start_date"] = df[col_start]
    else:
        df["start_date"] = pd.NaT

    if col_end and col_end in df.columns:
        df["end_date"] = df[col_end]
    else:
        df["end_date"] = pd.NaT

    print(f"[MAP] {sheet_name} -> team_priv: rows={len(df)} sys_code={df['sys_code'].iloc[0] if len(df) else ''}")
    return df


# =========================
# 요구 3) SAP 역할설명 생성
# =========================
def fill_sap_auth_desc_from_tcode(
    df_team_sap: pd.DataFrame,
    df_tcode: pd.DataFrame,
    role_code_col: str,
    role_name_col: str,
    menu_name_col: str,
    topn: int,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    t = df_tcode.copy()
    t["auth_code"] = t[role_code_col].map(norm_code)
    t["role_name"] = t[role_name_col].map(norm_text)
    t["menu_name"] = t[menu_name_col].map(norm_text)

    t.loc[t["menu_name"] == "", "menu_name"] = t.loc[t["menu_name"] == "", "role_name"]

    role_desc_map = (
        t.groupby("auth_code")["menu_name"]
         .apply(lambda s: build_sap_role_desc(s.tolist(), topn=topn))
         .to_dict()
    )
    map_df = pd.DataFrame([{"auth_code": k, "sap_generated_desc": v} for k, v in role_desc_map.items()])

    df = df_team_sap.copy()

    def _fill(row):
        cur = norm_text(row.get("auth_desc", ""))
        if cur:
            return cur
        return role_desc_map.get(norm_code(row.get("auth_code", "")), "")

    df["auth_desc"] = df.apply(_fill, axis=1)
    print(f"[SAP DESC] filled rows={len(df)}")
    return df, map_df


# =========================
# 요구 6) 역할별 메뉴 1:N 확장 매핑
# =========================
def expand_role_menu_mapping(df_team: pd.DataFrame, df_role_menu: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    rm = df_role_menu.copy()
    c_role_id = ensure_any_col(rm, CONFIG["cols_a_role_menu"]["role_id"], "역할ID", "역할별 메뉴")
    c_role_name = ensure_any_col(rm, CONFIG["cols_a_role_menu"]["role_name"], "역할명", "역할별 메뉴")
    c_menu_id = ensure_any_col(rm, CONFIG["cols_a_role_menu"]["menu_id"], "메뉴ID", "역할별 메뉴")
    c_menu_name = ensure_any_col(rm, CONFIG["cols_a_role_menu"]["menu_name"], "메뉴명", "역할별 메뉴")
    c_url = ensure_any_col(rm, CONFIG["cols_a_role_menu"]["url"], "URL", "역할별 메뉴")

    rm2 = rm[[c_role_id, c_role_name, c_menu_id, c_menu_name, c_url]].copy()
    rm2 = rm2.rename(columns={
        c_role_id: "role_id",
        c_role_name: "auth_name",
        c_menu_id: "menu_id",
        c_menu_name: "menu_name",
        c_url: "url",
    })
    rm2["auth_name"] = rm2["auth_name"].map(norm_text)
    rm2["role_id"] = rm2["role_id"].map(norm_code)
    rm2["menu_id"] = rm2["menu_id"].map(norm_code)
    rm2["menu_name"] = rm2["menu_name"].map(norm_text)
    rm2["url"] = rm2["url"].map(norm_text)

    left_cnt = len(df_team)
    out = df_team.merge(rm2, how="left", on="auth_name")

    matched = out["menu_id"].map(norm_text).ne("").sum()
    log_join_rate("A.role_menu (expand by auth_name)", left_cnt, matched)

    fail = out.loc[out["menu_id"].map(norm_text).eq(""), ["sys_code", "team_code", "team_name", "auth_code", "auth_name"]].copy()
    fail["issue"] = "role_menu mapping fail (auth_name not found)"
    return out, fail


# =========================
# 요구 7) 엑셀B 레벨 매핑
# =========================
def apply_level_mapping(df: pd.DataFrame, df_b_ias: pd.DataFrame, df_b_sap: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    out = df.copy()

    # IAS_Sales
    b_ias = df_b_ias.copy()
    b_ias["menu_name"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_menu_name"], "menu_name", "B.IAS_Sales")].map(norm_text)
    b_ias["menu_id"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_menu_id"], "menu_id", "B.IAS_Sales")].map(norm_code)
    b_ias["1level"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_1"], "1level", "B.IAS_Sales")].map(norm_text)
    b_ias["2level"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_2"], "2level", "B.IAS_Sales")].map(norm_text)
    b_ias["3level"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_3"], "3level", "B.IAS_Sales")].map(norm_text)
    b_ias = b_ias[["menu_name", "menu_id", "1level", "2level", "3level"]].drop_duplicates()

    # SAP
    b_sap = df_b_sap.copy()
    b_sap["menu_id"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_menu_id"], "menu_id", "B.SAP")].map(norm_code)
    b_sap["1level"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_1"], "1level", "B.SAP")].map(norm_text)
    b_sap["2level"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_2"], "2level", "B.SAP")].map(norm_text)
    b_sap["3level"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_3"], "3level", "B.SAP")].map(norm_text)
    b_sap = b_sap[["menu_id", "1level", "2level", "3level"]].drop_duplicates()

    # ✅ FIX: 컬럼이 없을 때 out.get("menu_id","")가 str이 되어 .map이 깨지는 문제 방지
    if "menu_id" not in out.columns:
        out["menu_id"] = ""
    if "menu_name" not in out.columns:
        out["menu_name"] = ""

    out["menu_id"] = out["menu_id"].map(norm_code)
    out["menu_name"] = out["menu_name"].map(norm_text)
    out["sys_code"] = out["sys_code"].map(norm_text)

    ias_like = set(["IAS", "LEGO", CONFIG["constants"]["IAS_SYS_NAME_FORCED"]])

    df_ias = out[out["sys_code"].isin(ias_like)].copy()
    df_rest = out[~out["sys_code"].isin(ias_like)].copy()

    if len(df_ias) > 0:
        before = len(df_ias)
        df_ias = df_ias.merge(b_ias, how="left", on=["menu_name", "menu_id"], suffixes=("", "_b"))
        matched = df_ias["3level"].map(norm_text).ne("").sum()
        log_join_rate("B.level (IAS-like: menu_name+menu_id)", before, matched)

    df_sap = df_rest[df_rest["sys_code"] == "SAP"].copy()
    df_other = df_rest[df_rest["sys_code"] != "SAP"].copy()

    if len(df_sap) > 0:
        before = len(df_sap)
        df_sap = df_sap.merge(
            b_sap,
            how="left",
            left_on=["menu_id", "menu_name"],
            right_on=["menu_id", "3level"],
            suffixes=("", "_b"),
        )
        matched = df_sap["3level"].map(norm_text).ne("").sum()
        log_join_rate("B.level (SAP: menu_name==B.3level + menu_id)", before, matched)

    out2 = pd.concat([df_ias, df_sap, df_other], ignore_index=True)

    # level 컬럼 없으면 만들어두기
    for c in ["1level", "2level", "3level"]:
        if c not in out2.columns:
            out2[c] = ""

    fail = out2.loc[
        out2["menu_id"].map(norm_text).ne("") & out2["3level"].map(norm_text).eq(""),
        ["sys_code", "team_code", "team_name", "auth_code", "auth_name", "menu_id", "menu_name"]
    ].copy()
    fail["issue"] = "level mapping fail (menu exists but 3level empty)"
    return out2, fail


# =========================
# 원코드 산출물 생성
# =========================
def first_non_empty(series: pd.Series, is_code: bool = False) -> str:
    for v in series.tolist():
        vv = norm_code(v) if is_code else norm_text(v)
        if vv:
            return vv
    return ""


def build_role_meta_map(df: pd.DataFrame, is_sap: bool) -> Dict[Tuple[str, str, str], Dict[str, str]]:
    meta: Dict[Tuple[str, str, str], Dict[str, str]] = {}
    for (team_code, sys_code, auth_code), g in df.groupby(["team_code", "sys_code", "auth_code"]):
        auth_name = first_non_empty(g["auth_name"])
        auth_desc = first_non_empty(g["auth_desc"])
        if is_sap and not auth_desc:
            auth_desc = build_sap_role_desc(g.get("3level", pd.Series([""])).tolist(), topn=int(CONFIG["constants"]["sap_desc_topn"]))
        meta[(team_code, sys_code, auth_code)] = {"auth_name": auth_name, "auth_desc": auth_desc}
    return meta


def to_outputs(df: pd.DataFrame, is_sap: bool) -> Dict:
    role_meta = build_role_meta_map(df, is_sap=is_sap)
    need_cols = ["team_code", "team_name", "sys_code", "sys_name", "auth_code", "auth_name", "auth_desc", "menu_id", "1level", "2level", "3level"]
    for c in need_cols:
        if c not in df.columns:
            df[c] = ""

    df_menu = df.drop_duplicates(subset=["team_code", "sys_code", "auth_code", "menu_id"]).copy()

    teams = df_menu[["team_name", "team_code"]].drop_duplicates()
    teams_records = (
        teams.sort_values("team_name")[["team_code", "team_name"]]
        .to_dict(orient="records")
    )

    systems_by_team: Dict[str, List[Dict[str, str]]] = {}
    for team_code, g in df_menu.groupby("team_code"):
        sysmap = {}
        for _, r in g[["sys_code", "sys_name"]].drop_duplicates().iterrows():
            sysmap[norm_text(r["sys_code"])] = norm_text(r["sys_name"])
        systems_by_team[team_code] = [{"sys_code": sc, "sys_name": sn} for sc, sn in sorted(sysmap.items(), key=lambda x: x[1])]

    roles_by_team_sys: Dict[str, List[Dict[str, str]]] = {}
    for (team_code, sys_code), g_ts in df_menu.groupby(["team_code", "sys_code"]):
        key = f"{team_code}|{sys_code}"
        role_list = []
        for auth_code in sorted(g_ts["auth_code"].map(norm_code).unique()):
            m = role_meta.get((team_code, sys_code, auth_code), {"auth_name": "", "auth_desc": ""})
            role_list.append({"auth_code": auth_code, "auth_name": m["auth_name"], "auth_desc": m["auth_desc"]})
        roles_by_team_sys[key] = sorted(role_list, key=lambda x: (x["auth_name"], x["auth_code"]))

    df_menu["path"] = df_menu["1level"].map(norm_text) + " > " + df_menu["2level"].map(norm_text) + " > " + df_menu["3level"].map(norm_text)

    bundles_by_team: Dict[str, Dict[str, Dict]] = {}
    for team_code, g_team in df_menu.groupby("team_code"):
        team_name = first_non_empty(g_team["team_name"])
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
                "auth_desc": m["auth_desc"],
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
# ✅ NEW: 기존 산출물과 append-only merge
# =========================
def load_old_outputs(out_base: Path) -> Optional[Dict]:
    idx_teams = out_base / "index_teams.json"
    idx_sys = out_base / "index_systems_by_team.json"
    idx_roles = out_base / "index_roles_by_team_sys.json"
    by_team = out_base / "by_team"

    if not (idx_teams.exists() and idx_sys.exists() and idx_roles.exists()):
        print("[OLD] 기존 index json 없음 -> merge 없이 신규 생성")
        return None

    old_teams = json.loads(idx_teams.read_text(encoding="utf-8")).get("teams", [])
    old_sys = json.loads(idx_sys.read_text(encoding="utf-8"))
    old_roles = json.loads(idx_roles.read_text(encoding="utf-8"))

    # bundles: by_team/*.jsonl 있으면 전부 로드
    old_bundles_by_team: Dict[str, Dict[str, Dict]] = {}
    if by_team.exists():
        for p in by_team.glob("role_bundle_team_*.jsonl"):
            team_code = p.stem.replace("role_bundle_team_", "").strip()
            team_code = canon_team_code(team_code)
            old_bundles_by_team.setdefault(team_code, {})
            with p.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    b = json.loads(line)
                    tc = canon_team_code(b.get("team_code", team_code))
                    sc = norm_text(b.get("sys_code", ""))
                    ac = norm_code(b.get("auth_code", ""))
                    key = f"{sc}|{ac}"
                    b["team_code"] = tc
                    old_bundles_by_team[tc][key] = b

    print(f"[OLD] teams={len(old_teams)} systems_keys={len(old_sys)} roles_keys={len(old_roles)} bundles_teams={len(old_bundles_by_team)}")
    return {
        "teams_records": old_teams,
        "systems_by_team": old_sys,
        "roles_by_team_sys": old_roles,
        "bundles_by_team": old_bundles_by_team,
    }


def merge_outputs_append_only(base: Dict, add: Dict) -> Dict:
    """
    ✅ 삭제 금지 merge
    - teams: base 유지 + add 추가(동일 team_code면 team_name 빈값만 보강)
    - systems_by_team: union
    - roles_by_team_sys: union (auth_code 기준)
    - bundles_by_team: union (sys|auth 기준), menus는 (menu_id,path) 기준 union
    """
    # teams
    base_map = {canon_team_code(t["team_code"]): norm_text(t.get("team_name", "")) for t in base.get("teams_records", []) if norm_text(t.get("team_code", ""))}
    for t in add.get("teams_records", []):
        tc = canon_team_code(t.get("team_code", ""))
        tn = norm_text(t.get("team_name", ""))
        if not tc:
            continue
        if tc not in base_map:
            base_map[tc] = tn
        else:
            if base_map[tc] == "" and tn != "":
                base_map[tc] = tn
    base["teams_records"] = [{"team_code": tc, "team_name": tn} for tc, tn in sorted(base_map.items(), key=lambda x: x[1])]

    # systems_by_team
    base.setdefault("systems_by_team", {})
    for team_code, sys_list in add.get("systems_by_team", {}).items():
        tc = canon_team_code(team_code)
        base["systems_by_team"].setdefault(tc, [])
        existing = {s["sys_code"]: s["sys_name"] for s in base["systems_by_team"][tc]}
        for s in sys_list:
            sc = norm_text(s.get("sys_code", ""))
            sn = norm_text(s.get("sys_name", ""))
            if not sc:
                continue
            if sc not in existing:
                existing[sc] = sn
            else:
                if existing[sc] == "" and sn != "":
                    existing[sc] = sn
        base["systems_by_team"][tc] = [{"sys_code": sc, "sys_name": sn} for sc, sn in sorted(existing.items(), key=lambda x: x[1])]

    # roles_by_team_sys
    base.setdefault("roles_by_team_sys", {})
    for key, roles in add.get("roles_by_team_sys", {}).items():
        # key: team|sys
        if "|" not in key:
            continue
        team_code, sys_code = key.split("|", 1)
        tc = canon_team_code(team_code)
        sc = norm_text(sys_code)
        k2 = f"{tc}|{sc}"
        base["roles_by_team_sys"].setdefault(k2, [])
        existing = {r["auth_code"]: dict(r) for r in base["roles_by_team_sys"][k2] if norm_text(r.get("auth_code", ""))}
        for r in roles:
            ac = norm_code(r.get("auth_code", ""))
            if not ac:
                continue
            rn = norm_text(r.get("auth_name", ""))
            rd = norm_text(r.get("auth_desc", ""))
            if ac not in existing:
                existing[ac] = {"auth_code": ac, "auth_name": rn, "auth_desc": rd}
            else:
                if existing[ac].get("auth_name", "") == "" and rn != "":
                    existing[ac]["auth_name"] = rn
                if existing[ac].get("auth_desc", "") == "" and rd != "":
                    existing[ac]["auth_desc"] = rd
        base["roles_by_team_sys"][k2] = sorted(existing.values(), key=lambda x: (x.get("auth_name",""), x.get("auth_code","")))

    # bundles_by_team
    base.setdefault("bundles_by_team", {})
    for team_code, bundle_map in add.get("bundles_by_team", {}).items():
        tc = canon_team_code(team_code)
        base["bundles_by_team"].setdefault(tc, {})
        for sys_auth, bundle in bundle_map.items():
            # bundle key normalize
            sc = norm_text(bundle.get("sys_code", ""))
            ac = norm_code(bundle.get("auth_code", ""))
            k = f"{sc}|{ac}"
            bundle["team_code"] = tc

            if k not in base["bundles_by_team"][tc]:
                base["bundles_by_team"][tc][k] = bundle
                continue

            existing = base["bundles_by_team"][tc][k]

            # menus union by (menu_id, path)
            ex_menus = existing.get("menus", []) or []
            ad_menus = bundle.get("menus", []) or []

            seen = {(norm_code(m.get("menu_id","")), norm_text(m.get("path",""))) for m in ex_menus}
            for m in ad_menus:
                mid = norm_code(m.get("menu_id",""))
                pth = norm_text(m.get("path",""))
                if not mid and not pth:
                    continue
                kk = (mid, pth)
                if kk not in seen:
                    ex_menus.append({"menu_id": mid, "path": pth})
                    seen.add(kk)
            ex_menus.sort(key=lambda x: (x.get("path",""), x.get("menu_id","")))
            existing["menus"] = ex_menus

            # 메타 보강
            for f in ["team_name","sys_name","auth_name","auth_desc"]:
                if norm_text(existing.get(f,"")) == "" and norm_text(bundle.get(f,"")) != "":
                    existing[f] = bundle[f]

            base["bundles_by_team"][tc][k] = existing

    return base


def write_output_xlsx(path_out: Path, sheets: Dict[str, pd.DataFrame]):
    path_out.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(path_out, engine="openpyxl") as w:
        for sn, df in sheets.items():
            df.to_excel(w, sheet_name=sn[:31], index=False)
    print(f"✅ Saved Excel: {path_out}")


def main():
    path_a = Path(CONFIG["paths"]["excel_a"])
    path_b = Path(CONFIG["paths"]["excel_b"])
    out_xlsx = Path(CONFIG["paths"]["out_xlsx"])

    out_base = Path(CONFIG["paths"]["out_base"])
    out_by_team = out_base / "by_team"
    out_base.mkdir(parents=True, exist_ok=True)
    out_by_team.mkdir(parents=True, exist_ok=True)

    # --- sheets
    sh_sap = resolve_sheet_name(path_a, CONFIG["sheets_a"]["sap_users"])
    sh_ias = resolve_sheet_name(path_a, CONFIG["sheets_a"]["ias_users"])
    sh_mro = resolve_sheet_name(path_a, CONFIG["sheets_a"]["mro_users"])
    sh_srm = resolve_sheet_name(path_a, CONFIG["sheets_a"]["srm_users"])
    sh_eac = resolve_sheet_name(path_a, CONFIG["sheets_a"]["eaccount_users"])
    sh_sap_tcode = resolve_sheet_name(path_a, CONFIG["sheets_a"]["sap_role_tcode"])
    sh_role_menu = resolve_sheet_name(path_a, CONFIG["sheets_a"]["role_menu"])

    sh_b_ias = resolve_sheet_name(path_b, CONFIG["sheets_b"]["ias_sales"])
    sh_b_sap = resolve_sheet_name(path_b, CONFIG["sheets_b"]["sap"])

    # --- load
    df_sap_raw = read_sheet_raw(path_a, sh_sap)
    df_ias_raw = read_sheet_raw(path_a, sh_ias)
    df_mro_raw = read_sheet_raw(path_a, sh_mro)
    df_srm_raw = read_sheet_raw(path_a, sh_srm)
    df_eac_raw = read_sheet_raw(path_a, sh_eac)

    df_sap_tcode = read_sheet_raw(path_a, sh_sap_tcode)
    df_role_menu = read_sheet_raw(path_a, sh_role_menu)

    df_b_ias = read_sheet_raw(path_b, sh_b_ias)
    df_b_sap = read_sheet_raw(path_b, sh_b_sap)

    # --- resolve columns (A user sheets)
    c = CONFIG["cols_a_user"]

    def resolve_cols(df: pd.DataFrame, sheet: str) -> Dict[str, str]:
        return {
            "name": ensure_any_col(df, c["name"], "이름", sheet),
            "empno": ensure_any_col(df, c["empno"], "사번", sheet),
            "sys_name": ensure_any_col(df, c["sys_name"], "시스템명", sheet),
            "role_name": ensure_any_col(df, c["role_name"], "역할명", sheet),
            "role_code": ensure_any_col(df, c["role_code"], "역할코드", sheet),
            "desc": ensure_any_col(df, c["desc"], "설명", sheet),
            "start": ensure_any_col(df, c["start_date"], "시작일자", sheet),
            "end": ensure_any_col(df, c["end_date"], "종료일자", sheet),
            "dept_name": ensure_any_col(df, c["dept_name"], "부서명", sheet),
            "dept_code": ensure_any_col(df, c["dept_code"], "부서코드", sheet),
        }

    cols_sap = resolve_cols(df_sap_raw, sh_sap)
    cols_ias = resolve_cols(df_ias_raw, sh_ias)
    cols_mro = resolve_cols(df_mro_raw, sh_mro)
    cols_srm = resolve_cols(df_srm_raw, sh_srm)
    cols_eac = resolve_cols(df_eac_raw, sh_eac)

    # --- dedup
    df_sap_dedup, _, _ = dedup_drop_name_emp(df_sap_raw, sh_sap, cols_sap["name"], cols_sap["empno"])
    df_ias_dedup, _, _ = dedup_drop_name_emp(df_ias_raw, sh_ias, cols_ias["name"], cols_ias["empno"])
    df_mro_dedup, _, _ = dedup_drop_name_emp(df_mro_raw, sh_mro, cols_mro["name"], cols_mro["empno"])
    df_srm_dedup, _, _ = dedup_drop_name_emp(df_srm_raw, sh_srm, cols_srm["name"], cols_srm["empno"])
    df_eac_dedup, _, _ = dedup_drop_name_emp(df_eac_raw, sh_eac, cols_eac["name"], cols_eac["empno"])

    # --- convert
    sys_sap = first_non_empty(df_sap_raw[cols_sap["sys_name"]])
    sys_ias = first_non_empty(df_ias_raw[cols_ias["sys_name"]])
    sys_mro = first_non_empty(df_mro_raw[cols_mro["sys_name"]])
    sys_srm = first_non_empty(df_srm_raw[cols_srm["sys_name"]])
    sys_eac = first_non_empty(df_eac_raw[cols_eac["sys_name"]])

    df_team_sap = to_team_priv_format(
        df_sap_dedup, sh_sap, sys_sap,
        cols_sap["dept_name"], cols_sap["dept_code"],
        cols_sap["role_code"], cols_sap["role_name"],
        None,  # SAP desc는 생성
        cols_sap["start"], cols_sap["end"],
    )
    df_team_ias = to_team_priv_format(
        df_ias_dedup, sh_ias, sys_ias,
        cols_ias["dept_name"], cols_ias["dept_code"],
        cols_ias["role_code"], cols_ias["role_name"],
        cols_ias["desc"],
        cols_ias["start"], cols_ias["end"],
    )
    df_team_mro = to_team_priv_format(
        df_mro_dedup, sh_mro, sys_mro,
        cols_mro["dept_name"], cols_mro["dept_code"],
        cols_mro["role_code"], cols_mro["role_name"],
        cols_mro["desc"],
        cols_mro["start"], cols_mro["end"],
    )
    df_team_srm = to_team_priv_format(
        df_srm_dedup, sh_srm, sys_srm,
        cols_srm["dept_name"], cols_srm["dept_code"],
        cols_srm["role_code"], cols_srm["role_name"],
        cols_srm["desc"],
        cols_srm["start"], cols_srm["end"],
    )
    df_team_eac = to_team_priv_format(
        df_eac_dedup, sh_eac, sys_eac,
        cols_eac["dept_name"], cols_eac["dept_code"],
        cols_eac["role_code"], cols_eac["role_name"],
        cols_eac["desc"],
        cols_eac["start"], cols_eac["end"],
    )

    # --- SAP desc
    tc = CONFIG["cols_a_sap_tcode"]
    c_tc_role_code = ensure_any_col(df_sap_tcode, tc["role_code"], "역할코드", sh_sap_tcode)
    c_tc_role_name = ensure_any_col(df_sap_tcode, tc["role_name"], "역할명", sh_sap_tcode)
    c_tc_menu_name = ensure_any_col(df_sap_tcode, tc["menu_name"], "메뉴명", sh_sap_tcode)

    df_team_sap, _df_sap_desc_map = fill_sap_auth_desc_from_tcode(
        df_team_sap, df_sap_tcode,
        role_code_col=c_tc_role_code,
        role_name_col=c_tc_role_name,
        menu_name_col=c_tc_menu_name,
        topn=int(CONFIG["constants"]["sap_desc_topn"]),
    )

    # --- union all systems
    df_team_all = pd.concat([df_team_sap, df_team_ias, df_team_mro, df_team_srm, df_team_eac], ignore_index=True)
    print(f"[UNION] team_all rows={len(df_team_all)}")

    # --- role_menu expand (1:N)
    df_menu_mapped, log_fail_role_menu = expand_role_menu_mapping(df_team_all, df_role_menu)

    # --- level mapping
    df_level_mapped, log_fail_level = apply_level_mapping(df_menu_mapped, df_b_ias, df_b_sap)

    # --- logs
    df_log = pd.concat([log_fail_role_menu, log_fail_level], ignore_index=True)
    if len(df_log) == 0:
        df_log = pd.DataFrame([{"issue": "no issues"}])

    # --- Excel 저장
    out_sheets = {
        CONFIG["constants"]["out_sheet1"]: df_team_all,
        CONFIG["constants"]["out_sheet2"]: df_level_mapped,
        CONFIG["constants"]["out_sheet_log"]: df_log,
    }
    write_output_xlsx(out_xlsx, out_sheets)

    # --- 산출물 생성 (이번 데이터 기준)
    ias_like = ["IAS", "LEGO", CONFIG["constants"]["IAS_SYS_NAME_FORCED"]]
    df_ias_like = df_level_mapped[df_level_mapped["sys_code"].isin(ias_like)].copy()
    df_sap_like = df_level_mapped[df_level_mapped["sys_code"] == "SAP"].copy()
    df_other = df_level_mapped[~df_level_mapped["sys_code"].isin(ias_like + ["SAP"])].copy()

    out_ias = to_outputs(df_ias_like, is_sap=False)
    out_sap = to_outputs(df_sap_like, is_sap=True)

    merged_new = {
        "teams_records": out_ias["teams_records"],
        "systems_by_team": out_ias["systems_by_team"],
        "roles_by_team_sys": out_ias["roles_by_team_sys"],
        "bundles_by_team": out_ias["bundles_by_team"],
    }
    merged_new = merge_outputs_append_only(merged_new, out_sap)

    if len(df_other) > 0:
        out_o = to_outputs(df_other, is_sap=False)
        merged_new = merge_outputs_append_only(merged_new, out_o)

    # ✅ 기존 산출물 로드 + append-only merge
    old = load_old_outputs(out_base)
    if old is not None:
        merged_all = merge_outputs_append_only(old, merged_new)
    else:
        merged_all = merged_new

    # --- index json 저장
    (out_base / "index_teams.json").write_text(
        json.dumps({"teams": merged_all["teams_records"]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_base / "index_systems_by_team.json").write_text(
        json.dumps(merged_all["systems_by_team"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_base / "index_roles_by_team_sys.json").write_text(
        json.dumps(merged_all["roles_by_team_sys"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # --- bundles jsonl 저장(by_team)
    for team_code, bundle_map in merged_all["bundles_by_team"].items():
        out_path = out_by_team / f"role_bundle_team_{team_code}.jsonl"
        rows = list(bundle_map.values())
        rows.sort(key=lambda b: (norm_text(b.get("sys_name","")), norm_text(b.get("auth_name","")), norm_code(b.get("auth_code",""))))
        with out_path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("✅ 완료 (append-only, no delete)")
    print(f"- Excel Output: {out_xlsx}")
    print(f"- JSON index: {out_base / 'index_teams.json'}")
    print(f"- JSON index: {out_base / 'index_systems_by_team.json'}")
    print(f"- JSON index: {out_base / 'index_roles_by_team_sys.json'}")
    print(f"- JSONL bundles: {out_by_team} / role_bundle_team_<team_code>.jsonl")
    print(f"- Log rows: {len(df_log)}")


if __name__ == "__main__":
    main()