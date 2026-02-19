import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown, Layout, MessageSquare, AlertCircle, RefreshCcw, Loader2, Home, ShieldCheck, Check, X, Layers, Copy, ClipboardCheck, Info, MousePointer2, UserCheck, PlusCircle, Send, CheckCircle2, ChevronUp } from 'lucide-react';
import * as dataService from './services/dataService';
import { Team, System, Role, RoleBundle, ChatMessage, Menu } from './types';
import { analyzeIntent } from './services/geminiService';

const LOGO_PATH = dataService.getAssetPath('assets/logo.png');

// --- 유틸리티 및 데이터 전처리 함수 ---
const normalize = (text: string) => (text || '').toLowerCase().replace(/\s+/g, '').trim();
const hasKorean = (text: string) => /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text || '');
const cleanValue = (val: any): string => {
  if (val === null || val === undefined) return '기타';
  const str = String(val).trim();
  const lower = str.toLowerCase();
  if (lower === 'nan' || lower === 'null' || str === '') return '기타';
  return str;
};


const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HighlightedText: React.FC<{ text: string; keyword: string }> = ({ text, keyword }) => {
  const kw = (keyword || "").trim();
  if (!kw) return <>{text}</>;

  const re = new RegExp(`(${escapeRegExp(kw)})`, "gi");
  const parts = String(text).split(re);

  return (
    <>
      {parts.map((part, idx) => {
        const isHit = part.toLowerCase() === kw.toLowerCase();
        return isHit ? (
          <span
            key={idx}
            className="font-black text-[#c8102e]"
          >
            {part}
          </span>
        ) : (
          <span key={idx}>{part}</span>
        );
      })}
    </>
  );
};

const buildBreadcrumb = (m: any) => {
  const parts = [m.l1, m.l2, m.l3].map(cleanValue).filter(v => v && v !== '기타');
  return parts.join(' > ');
};

const sanitizeKoreanDesc = (input: any): string => {
  let s = cleanValue(input);
  if (!s || s === '기타') return '';

  // (1) 불필요 구문이 나오면 그 앞까지만 남김 (가장 강력)
  // 예: "계약관리 을 위한 역할입니다." -> "계약관리"
  // 예: "계약관리 을 위한 역할, 입니다" -> "계약관리"
  s = s.replace(/\s*(을|를)\s*위한\s*역할.*$/u, '');

  // (2) 혹시 남아있을 수 있는 꼬리 표현 추가 제거
  s = s
    .replace(/\s*,\s*입니다\.?\s*$/g, '')              // ", 입니다"
    .replace(/\s*입니다\.?\s*$/g, '')                  // "입니다"
    .replace(/\s*(을|를)\s*위한\s*역할입니다\.?\s*$/g, '') // "을/를 위한 역할입니다"
    .replace(/\s*위한\s*역할입니다\.?\s*$/g, '')        // "위한 역할입니다"
    .replace(/\s*역할입니다\.?\s*$/g, '');              // "역할입니다"

  // 공백 정리
  s = s.replace(/\s+/g, ' ').trim();

  return s && s !== '기타' ? s : '';
};


const SAP_MODULE_LABEL: Record<string, string> = {
  FI: '재무회계',
  CO: '관리회계',
  SD: '영업/유통',
  MM: '자재관리',
  PP: '생산계획',
  PM: '설비보전',
  QM: '품질관리',
  HR: '인사관리',
  HCM: '인사관리',
  LE: '물류실행',
  BW: 'BI/분석',
};

const withModuleDesc = (code: string) => {
  const c = cleanValue(code).toUpperCase();
  return SAP_MODULE_LABEL[c] ? `${c} (${SAP_MODULE_LABEL[c]})` : c;
};

const stripModulePrefix = (name: string) =>
  name.replace(/^\[(FI|CO|SD|MM|PP|PM|QM|HR|HCM|LE|BW)\]\s*/i, '').trim();

const stripAllModulePrefixes = (text: string) =>
  String(text || '').replace(/\[(FI|CO|SD|MM|PP|PM|QM|HR|HCM|LE|BW)\]\s*/gi, '').trim();


const isIASSales = (sysName: string) => cleanValue(sysName) === 'IAS_Sales';
type IntentType = "ROLE_TO_MENU" | "MENU_TO_ROLE" | "ROLE_LIST" | "UNKNOWN";
type UnifiedRole = {
  groupKey: string;
  auth_name: string;
  auth_desc: string;
  auth_code: string;
  copy_auth_name: string;
  sys_name: string;
  thirdLevels: string[];
};


// RoleWithMenus 수정
interface RoleWithMenus {
  role_key: string;
  sys_name: string;

  auth_name: string; // 표시용(이미 IAS_Sales 스왑 반영된 값이 들어올 수도 있음)
  auth_code: string; // 표시용 코드 자리
  auth_desc: string; // 표시용 설명 자리

  matchedMenus?: Menu[]; // ✅ Menu 객체로 변경
  allMenus?: Menu[];     // ✅ Menu 객체로 변경
  totalMenus?: number; // ✅ 추가

}

const splitPathParts = (path: string) =>
  String(path || '')
    .split('>')
    .map(p => cleanValue(p))
    .map(p => (p === '기타' ? '' : p)); // '기타'는 빈 값 취급

const isNullishPart = (p: string) => !p || /^null$/i.test(p);

const menuSortKey = (m: Menu) => {
  const parts = splitPathParts(m.path);

  // 채워진 레벨 수(많을수록 우선)
  const filledCount = parts.filter(p => !isNullishPart(p)).length;

  // 앞에서부터 연속으로 채워진 레벨 수(“마감 > 금융리스 > ...” 같은 정합한 경로 우선)
  let prefixFilled = 0;
  for (let i = 0; i < parts.length; i++) {
    if (isNullishPart(parts[i])) break;
    prefixFilled++;
  }

  // 완전 빈/깨진(> > ...) 여부: 앞부분부터 비어 있으면 뒤로
  const leadingNull = isNullishPart(parts[0]) ? 1 : 0;

  // 언어 우선
  const keyText = `${cleanValue(m.path)} ${cleanValue(m.menu_id)}`;
  const isKor = hasKorean(keyText) ? 0 : 1; // 0=한글, 1=영문

  const pathForCompare = cleanValue(m.path);

  return { isKor, leadingNull, prefixFilled, filledCount, pathForCompare };
};

// ✅ 요구 정렬: 한글 → (선두 null 아님) → prefixFilled desc → filledCount desc → localeCompare
const sortMenusKoreanFirst = (menus: Menu[]) => {
  const uniq = new Map<string, Menu>();
  menus.forEach(m => {
    const id = cleanValue(m.menu_id);
    if (!id) return;
    if (!uniq.has(id)) uniq.set(id, m);
  });

  const arr = Array.from(uniq.values());

  arr.sort((a, b) => {
    const A = menuSortKey(a);
    const B = menuSortKey(b);

    if (A.isKor !== B.isKor) return A.isKor - B.isKor;
    if (A.leadingNull !== B.leadingNull) return A.leadingNull - B.leadingNull; // null 앞은 뒤로
    if (A.prefixFilled !== B.prefixFilled) return B.prefixFilled - A.prefixFilled;
    if (A.filledCount !== B.filledCount) return B.filledCount - A.filledCount;

    // 같은 그룹 내 정렬
    const locale = A.isKor === 0 ? 'ko' : 'en';
    return A.pathForCompare.localeCompare(B.pathForCompare, locale);
  });

  return arr;
};


  // “더 보여줘” 페이지네이션 상태
  type MenuPagingState = {
    role_key: string;
    sortedMenus: Menu[];
    offset: number;

    // ✅ 더 보여줘에서도 role 카드에 표시할 메타
    auth_name: string;
    auth_code: string;
    auth_desc: string;
    sys_name: string;
    totalMenus?: number; // ✅ 추가

  };


  const isMoreRequest = (text: string) =>
    /더\s*보여|다음\s*20|그\s*다음|계속\s*보여|추가\s*로\s*보여|더\s*있|더\s*있어|더\s*있나|더\s*있을까|더\s*있을까요|계속|계속\s*해|계속\s*줘|이어\s*서|이어서|다음|다음\s*꺼|다음\s*것/i.test(text);


  const parseAuthLevels = (name: string) => {
    const raw = cleanValue(name);

    if (raw === '기타') {
      return { l1: '기타', l2: '', l3: '', groupKey: '기타', groupLabel: '기타' };
    }

    const parts = raw.split('>').map(p => p.trim());
    let primaryPart = parts[0] || '기타';

    let l3 = parts.slice(1).join(' > ').trim();
    l3 = cleanValue(l3) === '기타' ? '' : cleanValue(l3);

    const m = primaryPart.match(/^(.+?)\s*[\(\[]\s*(.+?)\s*[\)\]]\s*$/);

    let l1: string;
    let l2: string;

    if (m) {
      l1 = cleanValue(m[1]);
      l2 = cleanValue(m[2]);
    } else {
      l1 = cleanValue(primaryPart);
      l2 = '';
    }

    const groupLabel = l2 && l2 !== '기타' ? `${l1}(${l2})` : l1;
    const groupKey = normalize(`${l1}||${l2}`);

    return { l1, l2, l3, groupKey, groupLabel };
  };


// --- SearchableSelect Component ---
interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({ options, value, onChange, placeholder, label, icon, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() =>
    options.filter(opt =>
      normalize(opt.label).includes(normalize(searchTerm)) ||
      normalize(opt.value).includes(normalize(searchTerm))
    ), [options, searchTerm]
  );

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) setSearchTerm('');
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`flex-1 w-full space-y-2 relative ${disabled ? 'opacity-40 pointer-events-none' : ''}`} ref={containerRef}>
      <label className="text-[11px] font-black text-slate-400 flex items-center gap-2 uppercase tracking-tight ml-1">
        {icon} {label}
      </label>
      <div
        className={`relative group bg-slate-50 border border-slate-200 rounded-xl transition-all shadow-sm ${isOpen ? 'ring-4 ring-red-500/10 border-red-500 bg-white' : 'hover:bg-white cursor-pointer'}`}
        onClick={handleToggle}
      >
        <div className="flex items-center px-4 py-3.5">
          <div className="flex-1 flex items-center overflow-hidden">
            {isOpen ? (
              <input
                autoFocus
                type="text"
                className="w-full bg-transparent outline-none font-bold text-slate-700 placeholder-slate-400 text-sm"
                placeholder="검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className={`text-sm font-bold truncate ${selectedOption ? 'text-slate-800' : 'text-slate-400'}`}>
                {selectedOption ? selectedOption.label : placeholder}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isOpen && selectedOption && (
              <button onClick={(e) => { e.stopPropagation(); onChange(''); }} className="text-slate-300 hover:text-red-500 transition-colors">
                <X size={14} />
              </button>
            )}
            <ChevronDown className={`text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180 text-red-500' : ''}`} size={18} />
          </div>
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] max-h-64 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-200">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <div key={opt.value} className={`px-5 py-3 text-sm font-bold flex items-center justify-between cursor-pointer transition-colors ${value === opt.value ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => handleSelect(opt.value)}>
                  <span>{opt.label}</span>
                  {value === opt.value && <Check size={14} />}
                </div>
              ))
            ) : (
              <div className="px-5 py-10 text-center text-xs text-slate-400 font-bold">결과 없음</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const guideSteps = [
  { iconKey: 'Home', text: 'AJ포털 접속 > IT신청 > IAM', url: 'https://portal.ajnet.co.kr/', keyword: 'AJ포털 IT신청 IAM' },
  { iconKey: 'PlusCircle', text: '신청 > 애플리케이션 권한 신청', keyword: '신청 > 애플리케이션 권한 신청' },
  { iconKey: 'MousePointer2', text: '역할 신청', keyword: '역할 신청' },
  { iconKey: 'Search', text: '역할 명 검색', keyword: '역할 명 검색' },
  { iconKey: 'Send', text: '추가 > 다음', keyword: '추가 > 다음' },
  { iconKey: 'CheckCircle2', text: '신청 사유 입력', keyword: '신청 사유 입력' },
  { iconKey: 'ShieldCheck', text: '신청 완료', keyword: '신청 완료' },
];

const guideIconMap: Record<string, React.ReactNode> = {
  
  Home: <Home size={18} />,
  UserCheck: <UserCheck size={18} />,
  PlusCircle: <PlusCircle size={18} />,
  MousePointer2: <MousePointer2 size={18} />,
  Search: <Search size={18} />,
  Send: <Send size={18} />,
  CheckCircle2: <CheckCircle2 size={18} />,
  ShieldCheck: <ShieldCheck size={18} />,
};


const IAM_PORTAL_HINT = {
  title: 'IAM(권한관리) 안내',
  desc: 'IAM(Identity & Access Management)은 AJ포털에서 IT신청 메뉴를 통해 접속하여 시스템/애플리케이션 권한을 신청·승인·관리하는 권한관리 시스템입니다.',
};

// SAP 모듈 설명(목록조회용)
const SAP_MODULE_DESC: Record<string, string> = {
  FI: '재무회계',
  CO: '관리회계',
  SD: '영업/유통',
  MM: '자재관리',
  PP: '생산계획',
  PM: '설비보전',
  QM: '품질관리',
  HR: '인사관리',
  HCM: '인사관리',
  LE: '물류실행',
  BW: 'BI/분석',
  BI: 'BI/분석',
};

const formatSapModuleLabel = (label: string) => {
  const key = cleanValue(label).toUpperCase();
  const desc = SAP_MODULE_DESC[key];
  return desc ? `${key} (${desc})` : label;
};


const App: React.FC = () => {

  const isGuideQuestion = (text: string) => {
    const t = normalize(text);

    // 대표 질문 키워드
    const baseHits =
      t.includes(normalize("권한신청")) ||
      t.includes(normalize("권한 신청")) ||
      t.includes(normalize("신청 방법")) ||
      t.includes(normalize("어떻게 신청")) ||
      t.includes(normalize("iam 신청")) ||
      t.includes(normalize("iam에서 신청")) ||
      t.includes(normalize("역할 신청"));

    // guideSteps의 문구가 직접 들어와도 가이드로 처리
    const stepHits = guideSteps.some(s => normalize(s.keyword || s.text).includes(t) || t.includes(normalize(s.keyword || s.text)));

    return baseHits || stepHits;
  };

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [systems, setSystems] = useState<System[]>([]);
  const [selectedSystem, setSelectedSystem] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'chat'>('browse');

  const [fullBundle, setFullBundle] = useState<RoleBundle[]>([]);
  const [selectedRoleGroupKey, setSelectedRoleGroupKey] = useState<string>('');
  const [menuFilter, setMenuFilter] = useState<string>('');

  const [chatInput, setChatInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [activeL1Norm, setActiveL1Norm] = useState<string>('');
  const teamOptions = useMemo(() => teams.map(t => ({ value: t.team_code, label: t.team_name })), [teams]);
  const systemOptions = useMemo(() => systems.map(s => ({ value: s.sys_code, label: s.sys_name })), [systems]);

const selectedSystemName = useMemo(() => {
  const sys = systems.find(s => s.sys_code === selectedSystem);
  return sys?.sys_name || '';
}, [systems, selectedSystem]);

const isSapSystemSelected = useMemo(() => /sap/i.test(selectedSystemName), [selectedSystemName]);


  const [menuPagingMap, setMenuPagingMap] = useState<Record<string, MenuPagingState>>({});

  useEffect(() => {
    setLoading(true);
    dataService.fetchTeams()
      .then(fetchedTeams => {
        const uniqueTeamsMap = new Map<string, Team>();
        fetchedTeams.forEach(t => {
          const code = (t.team_code || '').trim();
          if (!code) return;
          const name = (t.team_name || '').trim() || code;
          const normalizedKey = normalize(code);
          if (!uniqueTeamsMap.has(normalizedKey)) {
            uniqueTeamsMap.set(normalizedKey, { team_code: code, team_name: name });
          }
        });
        const deduped = Array.from(uniqueTeamsMap.values()).sort((a, b) => a.team_name.localeCompare(b.team_name, 'ko'));
        setTeams(deduped);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedTeam) return;

    setError(null);
    setBundleLoading(true);

    // 팀 전환 시 UI 상태 초기화
    setSelectedSystem('');
    setSelectedRoleGroupKey('');
    setActiveL1Norm('');
    setSystems([]);
    setFullBundle([]);

    Promise.all([
      dataService.fetchSystemsByTeam(selectedTeam),
      dataService.fetchRoleBundle(selectedTeam),
    ])
      .then(([sys, bundle]) => {
        setSystems(sys);
        setFullBundle(bundle);
      })
      .catch((err: any) => {
        setError(err?.message || "데이터 로딩 중 오류가 발생했습니다.");
        setSystems([]);
        setFullBundle([]);
      })
      .finally(() => setBundleLoading(false));
  }, [selectedTeam]);

  useEffect(() => {
    setSelectedRoleGroupKey('');
    setActiveL1Norm('');
  }, [selectedSystem]);

  useEffect(() => {
    setActiveL1Norm('');
  }, [selectedRoleGroupKey]);


  // (App.tsx) unifiedRoles 수정
  const unifiedRoles = useMemo(() => {
    const roleMap: Record<
      string,
      {
        groupLabel: string;
        sys_name: string;
        desc: Set<string>;          // 원래 auth_desc(한글 설명) 모음
        codes: Set<string>;         // 원래 auth_code(숫자/코드) 모음
        authNameCodes: Set<string>; // 원래 auth_name(ROLE_...) 모음 (IAS_Sales 표시용)
        lv3s: Set<string>;
      }
    > = {};

    fullBundle.forEach(b => {
      if (selectedSystem && b.sys_code !== selectedSystem) return;

      const { groupKey, groupLabel, l3 } = parseAuthLevels(b.auth_name);
      const authDescRaw = sanitizeKoreanDesc(b.auth_desc);
      const authCode = cleanValue(b.auth_code);
      const authNameCode = cleanValue(b.auth_name);

      if (!roleMap[groupKey]) {
        roleMap[groupKey] = {
          groupLabel,
          sys_name: cleanValue(b.sys_name),
          desc: new Set(authDescRaw !== '기타' ? [authDescRaw] : []),
          codes: new Set([authCode]),
          authNameCodes: new Set([authNameCode]),
          lv3s: new Set(l3 ? [l3] : []),
        };
      } else {
        if (authDescRaw) roleMap[groupKey].desc.add(authDescRaw);
        roleMap[groupKey].codes.add(authCode);
        roleMap[groupKey].authNameCodes.add(authNameCode);
        if (l3) roleMap[groupKey].lv3s.add(l3);
      }
    });

    return Object.entries(roleMap)
      .map(([groupKey, data]) => {
        const ias = isIASSales(data.sys_name);
        const descArr = Array.from(data.desc)
          .map(sanitizeKoreanDesc)
          .filter(Boolean);
        const joinedDesc = Array.from(data.desc).join(' / ') || '';
        const joinedDescClean = stripAllModulePrefixes(joinedDesc);
        const joinedAuthNameCodes = Array.from(data.authNameCodes).join(', '); // 원래 auth_name(ROLE_...) 모음
        const joinedAuthCodes = Array.from(data.codes).join(', ');             // 원래 auth_code 모음

        // ✅ IAS_Sales: auth_desc(=joinedDesc)를 우선 보여주되, 비어있으면 auth_name(ROLE_...)로 fallback
        const isDescUsable = cleanValue(joinedDescClean) !== '기타' && joinedDescClean.trim().length > 0;
        const displayName = ias ? (isDescUsable ? joinedDescClean : joinedAuthNameCodes) : data.groupLabel;

        return {
          groupKey,

          // ✅ 화면 “권한명 자리”
          auth_name: displayName,

          // ✅ 화면 설명 줄(필요하면 ROLE 코드 보여주기)
          auth_desc: ias ? joinedAuthNameCodes : joinedDescClean,

          // ✅ 상단 코드 영역은 원래 auth_code 유지 (시스템 상관 없이)
          auth_code: joinedAuthCodes,

          // ✅ “팀 권한 요약” 복사용: 시스템 상관 없이 항상 원래 auth_name(ROLE_...) 복사
          copy_auth_name: joinedAuthNameCodes,

          sys_name: data.sys_name,
          thirdLevels: Array.from(data.lv3s).sort(a => (a === '기타' ? 1 : -1)),
        };
      })
      .sort((a, b) => a.auth_name.localeCompare(b.auth_name, 'ko'));
  }, [fullBundle, selectedSystem]);

  const selectedGroup = useMemo(() =>
    unifiedRoles.find(r => r.groupKey === selectedRoleGroupKey),
    [unifiedRoles, selectedRoleGroupKey]
  );

  const processedMenus = useMemo(() => {
    if (!selectedRoleGroupKey) return [];
    const targetBundles = fullBundle.filter(b => {
      if (selectedSystem && b.sys_code !== selectedSystem) return false;
      const { groupKey } = parseAuthLevels(b.auth_name);
      return groupKey === selectedRoleGroupKey;
    });
    const allMenus = targetBundles.flatMap(b => b.menus);
    const filterNorm = normalize(menuFilter);
    const seen = new Set<string>();
    const result: (Menu & { l1: string, l2: string, l3: string })[] = [];
    allMenus.forEach(m => {
      const parts = m.path.split('>').map(p => cleanValue(p));
      const l1 = parts[0] || '기타';
      const l2 = parts[1] || '기타';
      const l3 = parts[2] || parts[parts.length - 1] || '기타';
      const pathNorm = normalize(`${l1}|${l2}|${l3}`);
      if (seen.has(pathNorm)) return;
      if (!hasKorean(l3)) return;
      if (filterNorm && !normalize(m.path).includes(filterNorm)) return;
      seen.add(pathNorm);
      result.push({ ...m, l1, l2, l3 });
    });
    return result;
  }, [selectedRoleGroupKey, selectedSystem, fullBundle, menuFilter]);

  const nestedMenus = useMemo(() => {
    const tree: Record<string, Record<string, typeof processedMenus>> = {};
    const l1LabelMap: Record<string, string> = {};
    const l2LabelMap: Record<string, string> = {};
    processedMenus.forEach(m => {
      const l1Norm = normalize(m.l1);
      const l2Norm = normalize(m.l2);
      if (!tree[l1Norm]) {
        tree[l1Norm] = {};
        l1LabelMap[l1Norm] = m.l1;
      }
      if (!tree[l1Norm][l2Norm]) {
        tree[l1Norm][l2Norm] = [];
        l2LabelMap[l2Norm] = m.l2;
      }
      tree[l1Norm][l2Norm].push(m);
    });
    return { tree, l1LabelMap, l2LabelMap };
  }, [processedMenus]);

  const sortLabelWithKoreanEtcEnglish = (label: string) => {
    const v = cleanValue(label);
    const isEtc = v === '기타';

    // 기타는 최후순위
    const etcRank = isEtc ? 2 : 0;

    // 한글 우선(0), 영어/기타 외(1)
    const langRank = hasKorean(v) ? 0 : 1;

    // etcRank가 최우선: 기타는 무조건 맨 뒤
    return { etcRank, langRank, text: v };
  };

  const sortedL1NormKeys = useMemo(() =>
    Object.keys(nestedMenus.tree).sort((a, b) => {
      const A = sortLabelWithKoreanEtcEnglish(nestedMenus.l1LabelMap[a]);
      const B = sortLabelWithKoreanEtcEnglish(nestedMenus.l1LabelMap[b]);

      if (A.etcRank !== B.etcRank) return A.etcRank - B.etcRank; // 기타 맨 뒤
      if (A.langRank !== B.langRank) return A.langRank - B.langRank; // 한글 먼저
      const locale = A.langRank === 0 ? 'ko' : 'en';
      return A.text.localeCompare(B.text, locale);
    }),
    [nestedMenus]
  );

  useEffect(() => {
    if (!selectedRoleGroupKey) return;
    if (!sortedL1NormKeys || sortedL1NormKeys.length === 0) return;
    setActiveL1Norm(prev => (prev ? prev : sortedL1NormKeys[0]));
  }, [selectedRoleGroupKey, sortedL1NormKeys]);


  const handleCopyRole = (text: string) => {
    if (!text) return;
    const performCopy = async () => {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          setCopyToast(text);
          setTimeout(() => setCopyToast(null), 2000);
        } else {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          textArea.style.left = "-9999px";
          textArea.style.top = "0";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          const successful = document.execCommand('copy');
          document.body.removeChild(textArea);
          if (successful) {
            setCopyToast(text);
            setTimeout(() => setCopyToast(null), 2000);
          }
        }
      } catch (err) {
        console.error('Copy failed: ', err);
      }
    };
    performCopy();
  };

  const handleSearch = async () => {
    if (!chatInput.trim() || !selectedTeam) return;

    const originalInput = chatInput.trim();

    // ✅ 권한신청 방법 질문이면: LLM 안 타고 가이드 카드만 바로 출력
    if (isGuideQuestion(originalInput)) {
      const userMsg: ChatMessage = { role: 'user', content: originalInput };

      setMessages(prev => [
        ...prev,
        userMsg, // ✅ 사용자 질문 카드도 반드시 추가
        { role: 'assistant', content: '권한 신청 방법은 아래 순서대로 진행하시면 됩니다.' },
        { 
          role: 'assistant',
          content: '',
          data: [
            {
              auth_name: "권한 신청 방법 (IAM 이용 가이드)",
              auth_desc: guideSteps.map((s, idx) => `${idx + 1}. ${s.text}`).join('\n'),
              auth_code: '',
              allMenus: [],
              matchedMenus: [],
              guideSteps: guideSteps, 
            }
          ],
          intentType: "ROLE_LIST",
        } as any
      ]);

      setChatInput('');
      return;
    }

    // ✅ 0) "더 보여줘" 요청이면 LLM/검색 재실행 없이, 캐시된 정렬 목록에서 다음 20개 출력
    if (isMoreRequest(originalInput) && Object.keys(menuPagingMap).length > 0) {
      const userMsg: ChatMessage = { role: 'user', content: originalInput };
      setMessages(prev => [...prev, userMsg]);

      // 권한별 다음 20개 만들기
      const nextData: any[] = [];
      let anyAdded = false;

      const nextMap: Record<string, MenuPagingState> = { ...menuPagingMap };

      Object.values(menuPagingMap).forEach(paging => {
        const start = paging.offset;
        const page = paging.sortedMenus.slice(start, start + 20);

        if (page.length > 0) {
          anyAdded = true;
          
          nextData.push({
            role_key: paging.role_key,
            sys_name: paging.sys_name,
            auth_name: paging.auth_name,
            auth_code: paging.auth_code,
            auth_desc: paging.auth_desc,
            matchedMenus: [],
            allMenus: page,
            totalMenus: paging.totalMenus ?? paging.sortedMenus.length, // ✅ 추가
          });

          // 다음 offset
          nextMap[paging.role_key] = { ...paging, offset: start + 20 };
        }
      });

      if (!anyAdded) {
        setMessages(prev => [...prev, { role: 'assistant', content: '더 이상 메뉴가 없습니다.' }]);
        setChatInput('');
        return;
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: '권한별로 다음 20개씩 보여드릴게요.',
          data: nextData,
          intentType: "ROLE_TO_MENU",
        } as any
      ]);

      setMenuPagingMap(nextMap);
      setChatInput('');
      return;
    }


    const userMsg: ChatMessage = { role: 'user', content: originalInput };

    // 1) 먼저 사용자 메시지 추가
    setMessages(prev => [...prev, userMsg]);

    // 2) 입력창/로딩 처리
    setChatInput('');
    setLoading(true);

    try {
      const currentTeamData = teams.find(t => t.team_code === selectedTeam);
      const teamName = currentTeamData?.team_name || '현재 팀';
      const sysName = systems.find(s => s.sys_code === selectedSystem)?.sys_name || '미선택';

      // ✅ LLM 의도 분석
      const analysis = await analyzeIntent(
        originalInput,
        `${teamName} (${selectedTeam})`,
        selectedSystem ? `${sysName} (${selectedSystem})` : ""
      );

      // ✅ 0) 원문 기반 "권한 목록" 강제 판별 (짧은 질문 보호)
      const trimmed = originalInput.trim();
      const roleListOverride =
        /^권한$/i.test(trimmed) ||
        /권한\s*(만|만이라도|만\s*알려|만\s*보여)/.test(trimmed) ||
        /권한\s*(목록|리스트|전체|뭐|뭐야|뭐있|뭐 있어)/.test(trimmed);

      // ✅ 1) 원문 기반 "전체/접근 가능 메뉴" 판별
      const originalLower = trimmed.toLowerCase();
      const wantsAllMenus =
        /전체|모두|전부|다\s*보여|전부\s*보여|전체\s*메뉴|메뉴\s*전체|목록|리스트/.test(trimmed) ||
        /(접근|사용|열람|조회)\s*(가능|가능한|할\s*수\s*있는|할수있는)\s*메뉴/.test(trimmed) ||
        /(볼\s*수\s*있는)\s*메뉴/.test(trimmed) ||
        /all\s*menu|all\s*menus/.test(originalLower);

      // ✅ 최종 타입 결정 (forcedType을 이후 전부 사용)
      const forcedType: IntentType =
        roleListOverride ? "ROLE_LIST" :
        (wantsAllMenus ? "ROLE_TO_MENU" : (analysis.type as IntentType));

      // ✅ 2) ROLE_LIST면 "권한만" 반환 (메뉴 조회/필터링 로직 자체를 타지 않음)
      if (forcedType === "ROLE_LIST") {
        const bundles = fullBundle.filter(b => !selectedSystem || b.sys_code === selectedSystem);

        // 역할(권한)만 dedupe 해서 구성
        const roleMap = new Map<string, RoleWithMenus>();

        bundles.forEach(b => {
          const authInfo = parseAuthLevels(b.auth_name);
          const key = `${b.sys_code}|${authInfo.groupLabel}|${b.auth_code}`;

          if (!roleMap.has(key)) {
            const sysNameClean = cleanValue(b.sys_name);
            const ias = isIASSales(sysNameClean);

            const roleNameRaw = cleanValue(b.auth_name); // ROLE_XXX
            const roleDescSan = stripAllModulePrefixes(sanitizeKoreanDesc(b.auth_desc));

            const displayName = ias
              ? (roleDescSan ? roleDescSan : roleNameRaw)
              : `${authInfo.groupLabel} [${sysNameClean}]`;
            const displayDesc = ias ? roleNameRaw : roleDescSan; // (IAS는 desc에 ROLE_XXX 노출 유지)

            roleMap.set(key, {
              role_key: key,
              sys_name: sysNameClean,
              auth_name: displayName,
              auth_code: cleanValue(b.auth_code),
              auth_desc: displayDesc,
              matchedMenus: [],
              allMenus: [], // ROLE_LIST에서는 비움
            });
          }
        });

        const finalData = Array.from(roleMap.values());

        const responseContent =
          `${teamName} 팀${selectedSystem ? ` / ${sysName}` : ""}의 권한 목록을 정리해드릴게요.`;

        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            content: responseContent,
            data: finalData,
            intentType: "ROLE_LIST",
          } as any
        ]);

        return;
      }


      // ✅ 3) ROLE_TO_MENU / MENU_TO_ROLE 처리: 기존 검색 로직 유지
      const rawTokens = [
        analysis.keyword,
        ...(analysis.candidates || []),
        ...trimmed.split(/[\s_\/\-.|]+/).map(s => s.trim()),
      ].filter(Boolean);

      // "권한/메뉴" 같은 범용어는 검색어 토큰에서 제거하되,
      // ROLE_LIST는 위에서 return 처리했기 때문에 여기서는 문제 없음.
      const stopwords = new Set([
        "메뉴", "권한", "역할", "접근", "가능", "보여줘", "알려줘", "찾아줘",
        "필요", "필요한", "어떻게", "뭐", "뭐야", "뭐뭐",
        "전체", "모두", "전부", "다", "조회", "확인", "해줘", "해주세요", "주세요",
        "부탁", "관련", "내", "우리", "팀", "시스템"
      ]);

      const keywords = Array.from(
        new Set(
          rawTokens
            .flatMap(t => String(t || "").split(/[\s_\/\-.|]+/))
            .map(t => t.trim())
            .filter(t => t.length >= 2)
            .filter(t => !stopwords.has(t))
            .filter(t => !stopwords.has(normalize(t)))
            .flatMap(t => {
              const n = normalize(t);
              return n && n !== t ? [t.toLowerCase(), n] : [t.toLowerCase()];
            })
        )
      );

      // RoleWithMenus에 totalMenus 추가되어 있어야 함 (아래 2번 참고)

      const runSearch = (bundlesInput: RoleBundle[]) => {
        const resultsMap = new Map<string, RoleWithMenus>();

        bundlesInput.forEach(b => {
          const authInfo = parseAuthLevels(b.auth_name);
          const roleKey = `${b.sys_code}|${authInfo.groupLabel}|${b.auth_code}`;

          const isAllMode = wantsAllMenus;

          const isMatch =
            keywords.length > 0 &&
            keywords.some(kwd =>
              normalize(b.team_name).includes(kwd) ||
              normalize(b.sys_name).includes(kwd) ||
              normalize(b.auth_name).includes(kwd) ||
              normalize(b.auth_desc).includes(kwd) ||
              String(b.team_name || "").toLowerCase().includes(kwd) ||
              String(b.sys_name || "").toLowerCase().includes(kwd)
            );

          const matchedMenus: Menu[] = [];
          if (!isAllMode && keywords.length > 0) {
            (b.menus || []).forEach(m => {
              if (keywords.some(kwd => normalize(m.path).includes(kwd))) {
                matchedMenus.push(m);
              }
            });
          }

          const hasMenuMatch = matchedMenus.length > 0;
          const shouldInclude = isAllMode || isMatch || hasMenuMatch;
          if (!shouldInclude) return;

          // ✅ 최초 생성
          if (!resultsMap.has(roleKey)) {
            const sysNameClean = cleanValue(b.sys_name);
            const ias = isIASSales(sysNameClean);

            const roleNameRaw = cleanValue(b.auth_name);
            const roleDescRaw = stripAllModulePrefixes(cleanValue(b.auth_desc));

            const displayName = ias
              ? (roleDescRaw !== '기타' && roleDescRaw.trim().length > 0 ? roleDescRaw : roleNameRaw)
              : `${authInfo.groupLabel} [${sysNameClean}]`;

            const displayDesc = ias ? roleNameRaw : roleDescRaw;

            const all = (b.menus || []);

            resultsMap.set(roleKey, {
              role_key: roleKey,
              sys_name: sysNameClean,
              auth_name: displayName,
              auth_code: cleanValue(b.auth_code),
              auth_desc: displayDesc,
              matchedMenus: isAllMode ? [] : matchedMenus,
              allMenus: (isAllMode || forcedType === "ROLE_TO_MENU" || isMatch) ? all : [],
              totalMenus: all.length, // ✅ 추가
            });

            return; // ✅ 여기서 forEach(b) 한 바퀴 종료
          }

          // ✅ 기존 roleKey에 matchedMenus 누적(키워드 모드에서만)
          const existing = resultsMap.get(roleKey)!;
          if (!isAllMode && hasMenuMatch) {
            const merged = [...(existing.matchedMenus || []), ...matchedMenus];
            const uniq = new Map<string, Menu>();
            merged.forEach(m => uniq.set(cleanValue(m.menu_id), m));
            existing.matchedMenus = Array.from(uniq.values());
          }
        });

        return Array.from(resultsMap.values());
      };


      const bundles = fullBundle.filter(b => !selectedSystem || b.sys_code === selectedSystem);
      let finalData = runSearch(bundles);

      if (finalData.length === 0 && selectedSystem) {
        finalData = runSearch(fullBundle);
      }

      const empty = finalData.length === 0;

      let responseContent = analysis.message || "검색 결과입니다.";
      if (wantsAllMenus) {
        responseContent = `${teamName} 팀${selectedSystem ? " / " + sysName : ""}에서 접근 가능한 메뉴를 정리해드릴게요.`;
      }
      if (empty) {
        responseContent = `죄송합니다. ${teamName} 팀${selectedSystem ? `의 ${sysName} 시스템` : ""} 내에서 관련 정보를 찾지 못했습니다.`;
      }

      // ✅ ROLE_TO_MENU + wantsAllMenus(=우리팀 접근 가능 메뉴)면 권한별 20개씩 + pagingMap 저장
      if (forcedType === "ROLE_TO_MENU" && wantsAllMenus && finalData.length > 0) {
        const nextMap: Record<string, MenuPagingState> = {};

        finalData = finalData.map(role => {
          const base = role.allMenus || [];
          const sortedAll = sortMenusKoreanFirst(base);
          const firstPage = sortedAll.slice(0, 20);
          role.allMenus = firstPage;
          role.totalMenus = sortedAll.length;
          // UI에는 20개만
          role.allMenus = firstPage;
          const baseDesc = cleanValue(role.auth_desc);
          const descForUi =
            baseDesc !== '기타' && baseDesc.trim().length > 0
              ? baseDesc
              : ''; // '기타'면 공백 처리

          const ruleLine = '/ 메뉴 규칙: 한글(가나다) → 영문(A-Z), 권한별 20개씩 표시';
          const mergedDesc = descForUi ? `${descForUi}\n${ruleLine}` : ruleLine;
          // pagingMap에 권한별 전체 정렬본 + 다음 offset 저장
          nextMap[role.role_key] = {
            role_key: role.role_key,
            sortedMenus: sortedAll,
            offset: 20,
            auth_name: role.auth_name,
            auth_code: role.auth_code,
            auth_desc: mergedDesc,
            sys_name: role.sys_name,
            totalMenus: sortedAll.length, // ✅ 추가
          };

          // (선택) 첫 페이지에도 규칙 문구 넣기
          role.auth_desc = mergedDesc;

          return role;
        });

        setMenuPagingMap(nextMap);
      }


      // ✅ 기존 그대로 유지
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: responseContent,
          data: finalData,
          intentType: forcedType,
        } as any
      ]);

    } catch (e) {
      console.error(e);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: '데이터 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }
      ]);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      <header className="bg-[#c8102e] text-white shadow-xl p-5 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-5">
            <div className="bg-white p-1.5 rounded-lg shadow-inner">
              <img src={LOGO_PATH} alt="Logo" className="h-8 w-auto object-contain" onError={(e) => (e.target as any).src = 'data:image/png;base64,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'} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter leading-none text-white">IAS 시스템 권한 안내 센터</h1>
              <p className="text-[10px] font-bold opacity-60 mt-1 uppercase tracking-widest hidden sm:block">IAS Access & Permissions Guide Center</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-6 animate-fade-in">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-6 items-end">
          <SearchableSelect options={teamOptions} value={selectedTeam} onChange={setSelectedTeam} placeholder="팀 선택" label="Team" icon={<Home size={14} className="text-red-600" />} />
          <SearchableSelect options={systemOptions} value={selectedSystem} onChange={setSelectedSystem} placeholder="시스템 선택" label="System" icon={<Layout size={14} className="text-red-600" />} disabled={!selectedTeam} />
          <button onClick={() => window.location.reload()} className="p-4 text-slate-400 hover:text-red-600 border border-slate-200 rounded-xl bg-white shadow-sm transition-all active:scale-95 mb-[2px]">
            <RefreshCcw size={20} />
          </button>
        </section>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl font-bold text-sm flex items-center gap-2">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {bundleLoading && (
          <div className="bg-white border border-slate-200 p-4 rounded-2xl font-bold text-sm flex items-center gap-2 text-slate-600">
            <Loader2 className="animate-spin" size={16} />
            데이터를 불러오는 중입니다...
          </div>
        )}

        {selectedTeam ? (
          <div className="flex flex-col flex-1 space-y-6">
            <section className="bg-slate-900 text-white rounded-3xl overflow-hidden shadow-xl border border-slate-800 transition-all">
              <button onClick={() => setIsGuideOpen(!isGuideOpen)} className="w-full flex items-center justify-between p-5 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-red-600 p-1.5 rounded-lg shadow-lg">
                    <Info size={18} className="text-white" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-tight">권한 신청 방법 (IAM 이용 가이드)</span>
                </div>
                {isGuideOpen ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
              </button>
              {isGuideOpen && (
                <div className="px-6 pb-6 animate-in slide-in-from-top-2 duration-300">
                  
<div className="mb-2 px-4 py-2 rounded-2xl border border-white/10 bg-white/5">
  <div className="text-[12px] font-black text-white mb-1">{IAM_PORTAL_HINT.title}</div>
  <div className="text-[11px] font-semibold text-slate-300 leading-relaxed break-keep">
    {IAM_PORTAL_HINT.desc}
  </div>
</div>

<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {guideSteps.map((step, idx) => {
                      const stepContent = (
                        <div className={`flex flex-col items-center text-center p-3 bg-white/5 rounded-2xl border border-white/5 transition-all ${step.url ? 'hover:bg-red-600/20 hover:border-red-600/40 cursor-pointer shadow-md' : 'hover:bg-white/10'}`}>
                          <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-[10px] font-black mb-2 shadow-lg">{idx + 1}</div>
                          <div className="text-red-400 mb-1">{guideIconMap[step.iconKey] || <Info size={18} />}</div>
                          <span className="text-[10px] font-bold tracking-tighter text-slate-300 leading-tight break-keep">{step.text}</span>
                        </div>
                      );
                      return step.url ? <a key={idx} href={step.url} target="_blank" rel="noopener noreferrer" className="block outline-none">{stepContent}</a> : <div key={idx}>{stepContent}</div>;
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-slate-900 font-black text-sm uppercase tracking-tight">
                  <ClipboardCheck size={18} className="text-red-600" />
                  팀 권한 요약 <span className="text-xs text-slate-400 font-bold normal-case ml-2">(클릭하여 권한명 복사)</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {unifiedRoles.map((role) => (
                  <button
                    key={role.groupKey}
                    onClick={() => handleCopyRole((role as any).copy_auth_name || role.auth_name)} // ✅ 여기 변경
                    className="relative group bg-slate-50 hover:bg-red-50 border border-slate-100 hover:border-red-200 p-3 rounded-xl transition-all text-left flex flex-col gap-1 overflow-hidden"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-400 group-hover:text-red-400 uppercase tracking-tighter truncate w-[70%]">
                        {role.auth_code}
                      </span>
                      <Copy size={12} className="text-slate-300 group-hover:text-red-400" />
                    </div>

                    <span className="text-xs font-black text-slate-700 group-hover:text-red-700 truncate">
                      {(role as any).summary_auth_name || role.auth_name}
                    </span>

                    {copyToast === (role as any).copy_auth_name && ( // ✅ 이 비교는 그대로 두면 됨
                      <div className="absolute inset-0 bg-red-600/90 flex items-center justify-center animate-in fade-in duration-200">
                        <span className="text-white text-[10px] font-black tracking-widest uppercase">복사됨</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 flex-1 overflow-hidden min-h-[600px] flex flex-col">
              
                <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

{/* 좌측 Roles */}
                  <div className="w-full md:w-80 border-r border-slate-100 bg-slate-50/50 p-5 flex flex-col gap-4 overflow-hidden">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">
                      시스템 역할 (Roles)
                    </span>

{isSapSystemSelected && (
  <div className="px-2">
    
  </div>
)}


                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                      {unifiedRoles.length > 0 ? (
                        unifiedRoles.map((r) => (
                          <button
                            key={r.groupKey}
                            onClick={() => setSelectedRoleGroupKey(r.groupKey)}
                            className={`w-full text-left p-4 rounded-2xl border transition-all ${
                              selectedRoleGroupKey === r.groupKey
                                ? 'bg-red-600 border-red-600 text-white shadow-lg scale-[1.02]'
                                : 'bg-white border-slate-200 text-slate-600 hover:bg-red-50/30'
                            }`}
                          >
                            <div className={`font-black text-sm ${r.auth_name === '기타' ? 'opacity-50 italic' : ''}`}>
                              {r.auth_name}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-xs font-bold text-slate-400 text-center">
                          {bundleLoading ? '데이터를 불러오는 중입니다...' : '권한 데이터가 없습니다.'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 우측 상세 */}
                  <div className="flex-1 flex flex-col bg-white overflow-hidden">
                    {selectedRoleGroupKey ? (
                      <>
                        <div className="p-8 border-b border-slate-50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                          <div className="space-y-4 w-full">
                            <div className="flex items-center gap-3">
                              <h2 className="text-3xl font-black text-slate-900 tracking-tight">
                                {selectedGroup?.auth_name}
                              </h2>
                              <button
                                onClick={() => handleCopyRole(selectedGroup?.copy_auth_name ?? selectedGroup?.auth_name ?? '')}
                                className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors border border-transparent hover:border-red-100"
                              >
                                <Copy size={18} />
                              </button>
                            </div>

                            {selectedGroup?.auth_desc && (
                              <p className="text-slate-600 text-xs font-medium ml-1 leading-relaxed">
                                {stripAllModulePrefixes(selectedGroup.auth_desc)}
                              </p>
                            )}

                            <div className="flex flex-wrap gap-2 items-center">
                              {selectedGroup?.thirdLevels?.map((lv3, idx) => (
                                <span
                                  key={idx}
                                  className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-tight border border-slate-200"
                                >
                                  {lv3}
                                </span>
                              ))}

                              <div className="ml-auto relative w-full lg:w-80 mt-4 lg:mt-0">
                                <input
                                  type="text"
                                  placeholder="메뉴 검색"
                                  value={menuFilter}
                                  onChange={(e) => setMenuFilter(e.target.value)}
                                  className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-red-500/10 outline-none transition-all shadow-inner"
                                />
                                <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-50/30 custom-scrollbar">
                          {menuFilter.trim().length > 0 ? (
                            // ✅ 검색 결과 화면 (브레드크럼 + 하이라이트)
                            <div className="space-y-3">
                              {processedMenus.length > 0 ? (
                                processedMenus
                                  .slice()
                                  .sort((a, b) => buildBreadcrumb(a).localeCompare(buildBreadcrumb(b), 'ko'))
                                  .map((m, idx) => {
                                    const crumb = buildBreadcrumb(m);
                                    return (
                                      <div
                                        key={`${cleanValue(m.menu_id) || idx}`}
                                        className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm"
                                      >
                                        <div className="text-[13px] font-bold text-slate-800 leading-relaxed">
                                          <HighlightedText text={crumb} keyword={menuFilter} />
                                        </div>
                                      </div>
                                    );
                                  })
                              ) : (
                                <div className="text-center py-24 text-slate-400 font-bold">
                                  검색 결과가 없습니다.
                                </div>
                              )}
                            </div>
                          ) : (
                            // ✅ 기본 탭 화면 (기존 UI 그대로)
                            <>
                              {sortedL1NormKeys.length > 0 ? (
                                <div className="space-y-6">
                                  {/* 1레벨 탭 */}
                                  <div className="flex flex-wrap gap-2">
                                    {sortedL1NormKeys.map((l1Norm) => {
                                      const label = nestedMenus.l1LabelMap[l1Norm];
                                      const active = l1Norm === activeL1Norm;

                                      return (
                                        <button
                                          key={l1Norm}
                                          onClick={() => setActiveL1Norm(l1Norm)}
                                          className={[
                                            'px-4 py-2 font-bold rounded-full border text-sm transition-all',
                                            active
                                              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50',
                                          ].join(' ')}
                                        >
                                          {formatSapModuleLabel(label)}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  {/* 선택된 1레벨의 2/3레벨만 표시 */}
                                  {activeL1Norm && nestedMenus.tree[activeL1Norm] ? (
                                    <div className="space-y-5">
                                      {Object.keys(nestedMenus.tree[activeL1Norm])
                                        .sort((a, b) => {
                                          const A = sortLabelWithKoreanEtcEnglish(nestedMenus.l2LabelMap[a]);
                                          const B = sortLabelWithKoreanEtcEnglish(nestedMenus.l2LabelMap[b]);
                                          if (A.etcRank !== B.etcRank) return A.etcRank - B.etcRank;
                                          if (A.langRank !== B.langRank) return A.langRank - B.langRank;
                                          const locale = A.langRank === 0 ? 'ko' : 'en';
                                          return A.text.localeCompare(B.text, locale);
                                        })
                                        .map((l2Norm) => {
                                          const items = nestedMenus.tree[activeL1Norm][l2Norm];
                                          const l2Label = nestedMenus.l2LabelMap[l2Norm];

                                          return (
                                            <div key={l2Norm} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                                              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-transparent">
                                                <div className="text-sm font-bold text-slate-800">{withModuleDesc(l2Label)}</div>
                                              </div>

                                              <div className="px-4 py-3">
                                                <div className="flex flex-wrap gap-2">
                                                  {items
                                                    .slice()
                                                    .sort((a, b) => cleanValue(a.l3).localeCompare(cleanValue(b.l3), 'ko'))
                                                    .map((m, i) => (
                                                      <span
                                                        key={`${cleanValue(m.menu_id) || i}`}
                                                        title={stripModulePrefix(m.l3)}
                                                        className={[
                                                          "inline-flex items-center",
                                                          "px-3 py-1.5",
                                                          "rounded-full",
                                                          "border border-slate-200",
                                                          "bg-white",
                                                          "text-[12px] text-slate-700",
                                                          "leading-none",
                                                          "shadow-sm",
                                                          "max-w-full"
                                                        ].join(" ")}
                                                      >
                                                        <span className="break-keep">{stripModulePrefix(m.l3)}</span>
                                                      </span>
                                                    ))}
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <div className="text-center py-40 opacity-20 font-black text-xl">
                                  데이터가 존재하지 않습니다.
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center opacity-10 space-y-6">
                        <Layout size={50} strokeWidth={1} />
                        <p className="font-black text-2xl uppercase tracking-tighter">
                          권한별 접근 가능한 메뉴가 노출됩니다.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 py-48 flex flex-col items-center justify-center text-center space-y-6 mt-10 animate-fade-in">
            <div className="p-10 bg-red-50 text-red-600 rounded-full animate-pulse shadow-inner"><ShieldCheck size={64} strokeWidth={1.5}/></div>
            <div className="space-y-2">
              <p className="text-slate-500 font-bold text-lg leading-relaxed">팀을 선택하여 <br/> <span className="text-red-600">권한과 메뉴</span>를 확인하세요.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="p-10 text-center bg-white border-t border-slate-50 mt-10">
        <p className="text-[11px] font-black text-slate-300 tracking-[0.5em] uppercase opacity-60">Copyright &copy; {new Date().getFullYear()} AJ네트웍스 전략기획실 정보전략팀</p>
      </footer>
    </div>
  );
};

export default App;