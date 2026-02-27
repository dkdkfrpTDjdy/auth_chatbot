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
        # ✅ 지금 대화에 업로드된 파일 경로(필요 시 수정)
        "excel_a": r"C:\Users\User\Downloads\AM 내 최신 권한 데이터_260206.xlsx",
        "excel_b": r"D:\works\GEN_AI\auth_chat\auth_chat_2_restore\사용자_조직_권한_메뉴 매핑_20251218_v1.2.xlsx",

        # ✅ 결과 저장 경로
        "out_xlsx": r"C:\Users\User\Downloads\OUTPUT_팀별권한_통합_결과.xlsx",

        # ✅ 원코드와 동일 산출물(JSON/JSONL) 저장 루트
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
        "ias_sales": ["IAS_Sales"],
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
        "ias_menu_name": ["menu_name", "3level"],  # 방어 (원코드에선 menu_name)
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

        # output excel sheet names
        "out_sheet1": "팀별 권한_통합",
        "out_sheet2": "팀별 권한_통합_메뉴매핑",
        "out_sheet_log": "로그",

        # 원코드 강제명
        "IAS_SYS_NAME_FORCED": "IAS_Sales",
    },
}


# =========================
# 유틸 (원코드 스타일 유지)
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
    df["team_code"] = df[col_dept_code].map(norm_code)

    # sys_code/sys_name: 원파일의 "시스템명" 값 기반 (IAS가 LEGO인 케이스 대응)
    df["sys_code"] = norm_text(sys_code)
    df["sys_name"] = norm_text(sys_code)

    df["auth_code"] = df[col_role_code].map(norm_code)
    df["auth_name"] = df[col_role_name].map(norm_text)

    # 역할설명
    if col_desc and col_desc in df.columns:
        df["auth_desc"] = df[col_desc].map(norm_text)
    else:
        df["auth_desc"] = ""

    # 시작/종료일자(있으면 유지)
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
# 요구 3) SAP 역할설명 생성 (SAP 역할별 TCODE)
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

    # 메뉴명이 없으면 역할명으로 fallback
    t.loc[t["menu_name"] == "", "menu_name"] = t.loc[t["menu_name"] == "", "role_name"]

    role_desc_map = (
        t.groupby("auth_code")["menu_name"]
         .apply(lambda s: build_sap_role_desc(s.tolist(), topn=topn))
         .to_dict()
    )
    map_df = pd.DataFrame([{"auth_code": k, "sap_generated_desc": v} for k, v in role_desc_map.items()])

    df = df_team_sap.copy()
    before_nonempty = (df["auth_desc"].map(norm_text) != "").sum()

    def _fill(row):
        cur = norm_text(row.get("auth_desc", ""))
        if cur:
            return cur
        return role_desc_map.get(norm_code(row.get("auth_code", "")), "")

    df["auth_desc"] = df.apply(_fill, axis=1)
    after_nonempty = (df["auth_desc"].map(norm_text) != "").sum()
    print(f"[SAP DESC] non-empty {before_nonempty} -> {after_nonempty} / {len(df)}")

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

    # IAS_Sales: menu_name + menu_id
    b_ias = df_b_ias.copy()
    b_ias["menu_name"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_menu_name"], "menu_name", "B.IAS_Sales")].map(norm_text)
    b_ias["menu_id"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_menu_id"], "menu_id", "B.IAS_Sales")].map(norm_code)
    b_ias["1level"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_1"], "1level", "B.IAS_Sales")].map(norm_text)
    b_ias["2level"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_2"], "2level", "B.IAS_Sales")].map(norm_text)
    b_ias["3level"] = b_ias[ensure_any_col(b_ias, CONFIG["cols_b"]["ias_3"], "3level", "B.IAS_Sales")].map(norm_text)
    b_ias = b_ias[["menu_name", "menu_id", "1level", "2level", "3level"]].drop_duplicates()

    # SAP: (A)menu_name == (B)3level AND menu_id match
    b_sap = df_b_sap.copy()
    b_sap["menu_id"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_menu_id"], "menu_id", "B.SAP")].map(norm_code)
    b_sap["1level"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_1"], "1level", "B.SAP")].map(norm_text)
    b_sap["2level"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_2"], "2level", "B.SAP")].map(norm_text)
    b_sap["3level"] = b_sap[ensure_any_col(b_sap, CONFIG["cols_b"]["sap_3"], "3level", "B.SAP")].map(norm_text)
    b_sap = b_sap[["menu_id", "1level", "2level", "3level"]].drop_duplicates()

    # A normalize
    out["menu_id"] = out.get("menu_id", "").map(norm_code)
    out["menu_name"] = out.get("menu_name", "").map(norm_text)
    out["sys_code"] = out["sys_code"].map(norm_text)

    # IAS 판정: 원파일 A에서는 IAS 시스템명이 LEGO이지만,
    # 레벨 매핑 규칙은 "IAS_Sales 시트"를 쓴다고 했으므로,
    # 여기서는 sys_code가 LEGO든 IAS든 "IAS계열"로 처리할 수 있게 후보를 둠.
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
        # A.menu_name == B.3level
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

    fail = out2.loc[
        out2["menu_id"].map(norm_text).ne("") & out2.get("3level", "").map(norm_text).eq(""),
        ["sys_code", "team_code", "team_name", "auth_code", "auth_name", "menu_id", "menu_name"]
    ].copy()
    fail["issue"] = "level mapping fail (menu exists but 3level empty)"
    return out2, fail


# =========================
# 원코드 산출물(JSON/JSONL) 생성 로직 (최대한 그대로)
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


def merge_outputs(base: Dict, add: Dict) -> Dict:
    team_map = {(t["team_code"], t["team_name"]) for t in base["teams_records"]}
    for t in add["teams_records"]:
        team_map.add((t["team_code"], t["team_name"]))
    base["teams_records"] = [{"team_code": tc, "team_name": tn} for tc, tn in sorted(team_map, key=lambda x: x[1])]

    for team_code, sys_list in add["systems_by_team"].items():
        base["systems_by_team"].setdefault(team_code, [])
        existing = {s["sys_code"]: s["sys_name"] for s in base["systems_by_team"][team_code]}
        for s in sys_list:
            existing[s["sys_code"]] = s["sys_name"]
        base["systems_by_team"][team_code] = [{"sys_code": sc, "sys_name": sn} for sc, sn in sorted(existing.items(), key=lambda x: x[1])]

    for key, roles in add["roles_by_team_sys"].items():
        base["roles_by_team_sys"].setdefault(key, [])
        existing = {r["auth_code"]: r for r in base["roles_by_team_sys"][key]}
        for r in roles:
            ac = r["auth_code"]
            if ac not in existing:
                existing[ac] = r
            else:
                if not existing[ac].get("auth_desc") and r.get("auth_desc"):
                    existing[ac]["auth_desc"] = r["auth_desc"]
                if not existing[ac].get("auth_name") and r.get("auth_name"):
                    existing[ac]["auth_name"] = r["auth_name"]
        base["roles_by_team_sys"][key] = sorted(existing.values(), key=lambda x: (x["auth_name"], x["auth_code"]))

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

    # --- 요구 1) dedup
    df_sap_dedup, _, _ = dedup_drop_name_emp(df_sap_raw, sh_sap, cols_sap["name"], cols_sap["empno"])
    df_ias_dedup, _, _ = dedup_drop_name_emp(df_ias_raw, sh_ias, cols_ias["name"], cols_ias["empno"])
    df_mro_dedup, _, _ = dedup_drop_name_emp(df_mro_raw, sh_mro, cols_mro["name"], cols_mro["empno"])
    df_srm_dedup, _, _ = dedup_drop_name_emp(df_srm_raw, sh_srm, cols_srm["name"], cols_srm["empno"])
    df_eac_dedup, _, _ = dedup_drop_name_emp(df_eac_raw, sh_eac, cols_eac["name"], cols_eac["empno"])

    # --- 요구 2/4/5) convert
    # sys_code는 원파일의 시스템명 값 기반(예: IAS가 LEGO)
    sys_sap = first_non_empty(df_sap_raw[cols_sap["sys_name"]])
    sys_ias = first_non_empty(df_ias_raw[cols_ias["sys_name"]])
    sys_mro = first_non_empty(df_mro_raw[cols_mro["sys_name"]])
    sys_srm = first_non_empty(df_srm_raw[cols_srm["sys_name"]])
    sys_eac = first_non_empty(df_eac_raw[cols_eac["sys_name"]])

    df_team_sap = to_team_priv_format(
        df_sap_dedup, sh_sap, sys_sap,
        cols_sap["dept_name"], cols_sap["dept_code"],
        cols_sap["role_code"], cols_sap["role_name"],
        None,  # SAP 설명은 빈값이므로 사용하지 않음 (요구 2)
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

    # --- 요구 3) SAP desc
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

    # --- union
    df_team_all = pd.concat([df_team_sap, df_team_ias, df_team_mro, df_team_srm, df_team_eac], ignore_index=True)
    print(f"[UNION] team_all rows={len(df_team_all)}")

    # --- 요구 6) role_menu expand (1:N)
    df_menu_mapped, log_fail_role_menu = expand_role_menu_mapping(df_team_all, df_role_menu)

    # --- 요구 7) level mapping
    df_level_mapped, log_fail_level = apply_level_mapping(df_menu_mapped, df_b_ias, df_b_sap)

    # --- logs
    df_log = pd.concat([log_fail_role_menu, log_fail_level], ignore_index=True)
    if len(df_log) == 0:
        df_log = pd.DataFrame([{"issue": "no issues"}])

    # --- 요구 8) Excel 저장
    out_sheets = {
        CONFIG["constants"]["out_sheet1"]: df_team_all,
        CONFIG["constants"]["out_sheet2"]: df_level_mapped,
        CONFIG["constants"]["out_sheet_log"]: df_log,
    }
    write_output_xlsx(out_xlsx, out_sheets)

    # --- 원코드와 동일 산출물(JSON/JSONL) 저장
    # 원코드는 IAS + SAP만 합치던 구조였지만, 여기선 전체를 한 번에 out로 만들어도 됨.
    # 다만 merge_outputs를 그대로 살리기 위해 IAS-like / SAP / others로 나눠 병합.
    df_ias_like = df_level_mapped[df_level_mapped["sys_code"].isin(["IAS", "LEGO", CONFIG["constants"]["IAS_SYS_NAME_FORCED"]])].copy()
    df_sap_like = df_level_mapped[df_level_mapped["sys_code"] == "SAP"].copy()
    df_other = df_level_mapped[~df_level_mapped["sys_code"].isin(["IAS", "LEGO", CONFIG["constants"]["IAS_SYS_NAME_FORCED"], "SAP"])].copy()

    out_ias = to_outputs(df_ias_like, is_sap=False)
    out_sap = to_outputs(df_sap_like, is_sap=True)
    merged = {
        "teams_records": out_ias["teams_records"],
        "systems_by_team": out_ias["systems_by_team"],
        "roles_by_team_sys": out_ias["roles_by_team_sys"],
        "bundles_by_team": out_ias["bundles_by_team"],
    }
    merged = merge_outputs(merged, out_sap)

    if len(df_other) > 0:
        out_o = to_outputs(df_other, is_sap=False)
        merged = merge_outputs(merged, out_o)

    (out_base / "index_teams.json").write_text(
        json.dumps({"teams": merged["teams_records"]}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_base / "index_systems_by_team.json").write_text(
        json.dumps(merged["systems_by_team"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_base / "index_roles_by_team_sys.json").write_text(
        json.dumps(merged["roles_by_team_sys"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    for team_code, bundle_map in merged["bundles_by_team"].items():
        out_path = out_by_team / f"role_bundle_team_{team_code}.jsonl"
        rows = list(bundle_map.values())
        rows.sort(key=lambda b: (b["sys_name"], b["auth_name"], b["auth_code"]))
        with out_path.open("w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print("✅ 완료")
    print(f"- Excel Output: {out_xlsx}")
    print(f"- JSON index: {out_base / 'index_teams.json'}")
    print(f"- JSON index: {out_base / 'index_systems_by_team.json'}")
    print(f"- JSON index: {out_base / 'index_roles_by_team_sys.json'}")
    print(f"- JSONL bundles: {out_by_team} / role_bundle_team_<team_code>.jsonl")
    print(f"- Log rows: {len(df_log)}")


if __name__ == "__main__":
    main()