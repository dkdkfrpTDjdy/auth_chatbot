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
  };


  const isMoreRequest = (text: string) =>
    /더\s*보여|다음\s*20|그\s*다음|계속\s*보여|추가\s*로\s*보여/i.test(text);


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
  let l1, l2;
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
  { icon: <UserCheck size={18} />, text: 'IAM 접속 및 로그인', url: 'https://iam.ajnetworks.co.kr' },
  { icon: <PlusCircle size={18} />, text: '신청 > 애플리케이션 권한 신청' },
  { icon: <MousePointer2 size={18} />, text: '역할 신청' },
  { icon: <Search size={18} />, text: '역할 명 검색' },
  { icon: <Send size={18} />, text: '추가 > 다음' },
  { icon: <CheckCircle2 size={18} />, text: '신청 사유 입력' },
  { icon: <ShieldCheck size={18} />, text: '신청 완료' },
];

const App: React.FC = () => {
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

  const [collapsedL1s, setCollapsedL1s] = useState<Set<string>>(new Set());
  const [chatInput, setChatInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const teamOptions = useMemo(() => teams.map(t => ({ value: t.team_code, label: t.team_name })), [teams]);
  const systemOptions = useMemo(() => systems.map(s => ({ value: s.sys_code, label: s.sys_name })), [systems]);
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
    setCollapsedL1s(new Set());
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
    setCollapsedL1s(new Set());
  }, [selectedSystem]);

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
      const authDesc = cleanValue(b.auth_desc);
      const authCode = cleanValue(b.auth_code);
      const authNameCode = cleanValue(b.auth_name);

      if (!roleMap[groupKey]) {
        roleMap[groupKey] = {
          groupLabel,
          sys_name: cleanValue(b.sys_name),
          desc: new Set(authDesc !== '기타' ? [authDesc] : []),
          codes: new Set([authCode]),
          authNameCodes: new Set([authNameCode]),
          lv3s: new Set(l3 ? [l3] : []),
        };
      } else {
        if (authDesc !== '기타') roleMap[groupKey].desc.add(authDesc);
        roleMap[groupKey].codes.add(authCode);
        roleMap[groupKey].authNameCodes.add(authNameCode);
        if (l3) roleMap[groupKey].lv3s.add(l3);
      }
    });

    return Object.entries(roleMap)
      .map(([groupKey, data]) => {
        const ias = isIASSales(data.sys_name);

        const joinedDesc = Array.from(data.desc).join(' / ') || '';
        const joinedAuthNameCodes = Array.from(data.authNameCodes).join(', '); // 원래 auth_name(ROLE_...) 모음
        const joinedAuthCodes = Array.from(data.codes).join(', ');             // 원래 auth_code 모음

        // ✅ IAS_Sales: auth_desc(=joinedDesc)를 우선 보여주되, 비어있으면 auth_name(ROLE_...)로 fallback
        const isDescUsable = cleanValue(joinedDesc) !== '기타' && joinedDesc.trim().length > 0;
        const displayName = ias ? (isDescUsable ? joinedDesc : joinedAuthNameCodes) : data.groupLabel;

        return {
          groupKey,

          // ✅ 화면 “권한명 자리”
          auth_name: displayName,

          // ✅ 화면 설명 줄(필요하면 ROLE 코드 보여주기)
          auth_desc: ias ? joinedAuthNameCodes : joinedDesc,

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

  const sortedL1NormKeys = useMemo(() =>
    Object.keys(nestedMenus.tree).sort((a, b) => nestedMenus.l1LabelMap[a].localeCompare(nestedMenus.l1LabelMap[b])),
    [nestedMenus]
  );

  const toggleL1Collapse = (l1Norm: string) => {
    setCollapsedL1s(prev => {
      const next = new Set(prev);
      if (next.has(l1Norm)) next.delete(l1Norm);
      else next.add(l1Norm);
      return next;
    });
  };

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
            const roleDescRaw = cleanValue(b.auth_desc); // 설명

            // ✅ IAS_Sales: title(auth_name)은 설명 우선, 없으면 ROLE_XXX
            const displayName = ias
              ? (roleDescRaw !== '기타' && roleDescRaw.trim().length > 0 ? roleDescRaw : roleNameRaw)
              : `${authInfo.groupLabel} [${sysNameClean}]`;

            // ✅ IAS_Sales: desc(auth_desc)에는 ROLE_XXX를 노출
            const displayDesc = ias ? roleNameRaw : roleDescRaw;

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

          // ✅ matchedMenus: Menu[] 로 수집
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

            const roleNameRaw = cleanValue(b.auth_name); // ROLE_XXX
            const roleDescRaw = cleanValue(b.auth_desc); // 설명

            const displayName = ias
              ? (roleDescRaw !== '기타' && roleDescRaw.trim().length > 0 ? roleDescRaw : roleNameRaw)
              : `${authInfo.groupLabel} [${sysNameClean}]`;

            const displayDesc = ias ? roleNameRaw : roleDescRaw;

            resultsMap.set(roleKey, {
              role_key: roleKey,
              sys_name: sysNameClean,
              auth_name: displayName,
              auth_code: cleanValue(b.auth_code),
              auth_desc: displayDesc,
              matchedMenus: isAllMode ? [] : matchedMenus,
              allMenus:
                (isAllMode || forcedType === "ROLE_TO_MENU" || isMatch)
                  ? (b.menus || [])
                  : [],
            });
            return;
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
        responseContent = `${teamName} 팀${selectedSystem ? ` / ${sysName}` : ""}에서 접근 가능한 메뉴를 정리해드릴게요.`;
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
              <img src={LOGO_PATH} alt="Logo" className="h-8 w-auto object-contain" onError={(e) => (e.target as any).src = 'https://cdn.imweb.me/thumbnail/20230807/71e6f8a836628.png'} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter leading-none text-white">IAS 시스템 권한 안내 센터</h1>
              <p className="text-[10px] font-bold opacity-60 mt-1 uppercase tracking-widest hidden sm:block">IAS System Auth Guidance Center</p>
            </div>
          </div>
          <div className="bg-white/10 px-3 py-1.5 rounded-full border border-white/20 hidden md:flex items-center gap-2">
            <ShieldCheck size={14} className="text-red-200" />
            <span className="text-[10px] font-black uppercase tracking-tight">AJ네트웍스</span>
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                    {guideSteps.map((step, idx) => {
                      const stepContent = (
                        <div className={`flex flex-col items-center text-center p-3 bg-white/5 rounded-2xl border border-white/5 transition-all ${step.url ? 'hover:bg-red-600/20 hover:border-red-600/40 cursor-pointer shadow-md' : 'hover:bg-white/10'}`}>
                          <div className="w-7 h-7 rounded-full bg-red-600 flex items-center justify-center text-[10px] font-black mb-2 shadow-lg">{idx + 1}</div>
                          <div className="text-red-400 mb-1">{step.icon}</div>
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
                      {role.auth_name}
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

            <div className="flex bg-slate-200/50 p-1.5 rounded-2xl w-fit shadow-inner">
              <button onClick={() => setActiveTab('browse')} className={`px-8 py-2.5 rounded-xl font-black text-sm transition-all ${activeTab === 'browse' ? 'bg-white text-red-700 shadow-lg' : 'text-slate-500'}`}>목록 조회</button>
              <button onClick={() => setActiveTab('chat')} className={`px-8 py-2.5 rounded-xl font-black text-sm transition-all ${activeTab === 'chat' ? 'bg-white text-red-700 shadow-lg' : 'text-slate-500'}`}>AI 검색</button>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 flex-1 overflow-hidden min-h-[600px] flex flex-col">
              {activeTab === 'browse' ? (
                <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
                  <div className="w-full md:w-80 border-r border-slate-100 bg-slate-50/50 p-5 flex flex-col gap-4 overflow-hidden">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">시스템 역할 (Roles)</span>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                      {unifiedRoles.length > 0 ? unifiedRoles.map(r => (
                        <button key={r.groupKey} onClick={() => setSelectedRoleGroupKey(r.groupKey)} className={`w-full text-left p-4 rounded-2xl border transition-all ${selectedRoleGroupKey === r.groupKey ? 'bg-red-600 border-red-600 text-white shadow-lg scale-[1.02]' : 'bg-white border-slate-200 text-slate-600 hover:bg-red-50/30'}`}>
                          <div className={`font-black text-sm ${r.auth_name === '기타' ? 'opacity-50 italic' : ''}`}>{r.auth_name}</div>
                        </button>
                      )) : (
                        <div className="p-4 text-xs font-bold text-slate-400 text-center">
                          {bundleLoading ? "데이터를 불러오는 중입니다..." : "권한 데이터가 없습니다."}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col bg-white overflow-hidden">
                    {selectedRoleGroupKey ? (
                      <>
                        <div className="p-8 border-b border-slate-50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                          <div className="space-y-4 w-full">
                            <div className="flex items-center gap-3">
                              <h2 className="text-3xl font-black text-slate-900 tracking-tight">{selectedGroup?.auth_name}</h2>
                              <button onClick={() => handleCopyRole(selectedGroup?.auth_name || '')} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors border border-transparent hover:border-red-100"><Copy size={18} /></button>
                            </div>
                            {selectedGroup?.auth_desc && (
                              <p className="text-slate-600 text-xs font-medium ml-1 leading-relaxed">
                                {selectedGroup.auth_desc}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 items-center">
                              {selectedGroup?.thirdLevels && selectedGroup.thirdLevels.length > 0 && selectedGroup.thirdLevels.map((lv3, idx) => (
                                <span key={idx} className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-tight border border-slate-200">{lv3}</span>
                              ))}
                              <div className="ml-auto relative w-full lg:w-80 mt-4 lg:mt-0">
                                <input type="text" placeholder="메뉴 검색" value={menuFilter} onChange={e => setMenuFilter(e.target.value)} className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-red-500/10 outline-none transition-all shadow-inner" />
                                <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/30 custom-scrollbar">
                          {sortedL1NormKeys.length > 0 ? (
                            sortedL1NormKeys.map(l1Norm => {
                              const isCollapsed = collapsedL1s.has(l1Norm);
                              const l1Label = nestedMenus.l1LabelMap[l1Norm];
                              const l2Data = nestedMenus.tree[l1Norm];
                              const totalItems = Object.values(l2Data).reduce((sum, items) => sum + items.length, 0);
                              return (
                                <div key={l1Norm} className="space-y-4">
                                  <button onClick={() => toggleL1Collapse(l1Norm)} className="w-full flex items-center gap-4 group hover:opacity-80 transition-all">
                                    <div className={`h-[2px] flex-1 transition-all ${isCollapsed ? 'bg-slate-200' : 'bg-red-200'}`}></div>
                                    <div className="flex items-center gap-3 px-2">
                                      <div className={`p-1 rounded-lg transition-all ${isCollapsed ? 'bg-slate-100 text-slate-400' : 'bg-red-50 text-red-600'}`}>
                                        <ChevronDown size={14} className={`transition-transform duration-300 ${isCollapsed ? '-rotate-90' : ''}`} />
                                      </div>
                                      <h3 className={`text-sm font-black uppercase tracking-widest whitespace-nowrap ${l1Label === '기타' ? 'text-slate-400 italic' : 'text-slate-900'}`}>{l1Label}<span className="ml-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 group-hover:bg-red-100 group-hover:text-red-600 transition-colors">{totalItems}</span></h3>
                                    </div>
                                    <div className={`h-[2px] flex-1 transition-all ${isCollapsed ? 'bg-slate-200' : 'bg-red-200'}`}></div>
                                  </button>
                                  {!isCollapsed && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
                                      {Object.keys(l2Data).sort((a, b) => nestedMenus.l2LabelMap[a].localeCompare(nestedMenus.l2LabelMap[b])).map(l2Norm => (
                                        <div key={l2Norm} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                                          <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-50 flex items-center justify-between">
                                            <div className="flex items-center gap-3"><Layers size={14} className="text-red-500" /><h4 className={`text-xs font-black uppercase tracking-tight ${nestedMenus.l2LabelMap[l2Norm] === '기타' ? 'text-slate-400 italic' : 'text-slate-700'}`}>{nestedMenus.l2LabelMap[l2Norm]}</h4></div>
                                            <span className="text-[10px] font-bold text-slate-400">{l2Data[l2Norm].length} Items</span>
                                          </div>
                                          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                            {l2Data[l2Norm].map((m, i) => (
                                              <div
                                                key={i}
                                                className={`menu-card p-3 rounded-2xl flex items-center justify-center text-center min-h-[44px] border transition-all ${
                                                  m.l3 === '기타'
                                                    ? 'bg-slate-50/30 border-slate-100 grayscale-[0.5]'
                                                    : 'bg-white border-slate-100 shadow-sm hover:border-red-200 hover:shadow-md'
                                                }`}
                                              >
                                                <span className={`text-sm font-bold break-keep leading-tight ${
                                                  m.l3 === '기타' ? 'text-slate-400 italic' : 'text-slate-800'
                                                }`}>
                                                  {m.l3}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-center py-40 opacity-20 font-black text-xl">데이터가 존재하지 않습니다.</div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center opacity-10 space-y-6">
                        <Layout size={100} strokeWidth={1} />
                        <p className="font-black text-2xl uppercase tracking-tighter">Select a role to inspect</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 bg-slate-50/50">
                  <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                    {messages.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
                        <div className="p-6 bg-white rounded-full shadow-lg text-red-600 border border-red-100"><MessageSquare size={44} /></div>
                        <p className="font-black text-slate-900 text-2xl">AI 스마트 검색</p>
                        <p className="text-sm font-semibold text-slate-600">권한/메뉴 관련 질문을 입력해 주세요.</p>
                        <div className="mt-2 w-full max-w-md space-y-2">
                          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-left shadow-sm">
                            <ul className="mt-2 space-y-1 text-sm text-slate-600">
                              <li>우리 팀 접근 가능 메뉴 보여줘</li>
                              <li>우리 팀 권한으로 “견적” 메뉴 접근 가능할까?</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                        <div className={`max-w-[90%] p-5 rounded-3xl shadow-md border ${m.role === 'user' ? 'bg-red-700 text-white rounded-br-none border-red-800' : 'bg-white text-slate-800 rounded-bl-none border-slate-100'}`}>
                          <p className="text-[15px] font-bold whitespace-pre-wrap">{m.content}</p>
                          {m.data && Array.isArray(m.data) && (m.data as any[]).length > 0 && (
                            <div className="mt-4 pt-4 border-t border-black/10 grid grid-cols-1 gap-4">
                              {(m.data as any[]).map((d: any, j: number) => (
                                <div key={j} className="bg-black/5 p-4 rounded-2xl flex flex-col gap-3">
                                  <div className="flex justify-between items-start gap-4">
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-2">
                                        <ShieldCheck size={14} className="text-red-600" />
                                        <span className="text-[14px] font-black text-slate-900 leading-tight">{d.auth_name}</span>
                                      </div>
                                      {d.auth_desc && (
                                        <span className="text-[11px] text-slate-500 font-medium leading-tight mt-1 ml-5">
                                          {d.auth_desc}
                                        </span>
                                      )}
                                    </div>
                                    {d.auth_code && (
                                      <span className="text-[10px] font-mono opacity-50 bg-black/10 px-2 py-0.5 rounded-md whitespace-nowrap">
                                        [{d.auth_code}]
                                      </span>
                                    )}
                                  </div>

                                  {(m as any).intentType !== "ROLE_LIST" &&
                                    ((d.matchedMenus && d.matchedMenus.length > 0) || (d.allMenus && d.allMenus.length > 0)) && (
                                    <div className="flex flex-col gap-1.5 border-t border-black/5 pt-3 ml-5">
                                      <div className="flex items-center gap-2 mb-1">
                                        <Layers size={12} className="text-slate-400" />
                                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                                          {d.matchedMenus?.length ? 'Matched Menus' : 'Role Menus'}
                                        </span>
                                      </div>
                                      <div className="flex flex-col gap-1">
                                        {(d.matchedMenus?.length ? d.matchedMenus : d.allMenus)?.slice(0, 20).map((menu: Menu, k: number) => (
                                          <div key={cleanValue(menu.menu_id) || k} className="text-[11px] font-bold text-slate-700 bg-white/60 px-2.5 py-1.5 rounded-lg border border-white/40 shadow-sm leading-tight">
                                            <span className="opacity-60 mr-2">{k + 1}.</span>
                                            <span>{cleanValue(menu.path)}</span>
                                            <span className="ml-2 font-mono opacity-60">({cleanValue(menu.menu_id)})</span>
                                          </div>
                                        ))}
                                        {(d.matchedMenus?.length ? d.matchedMenus : d.allMenus).length > 20 && (
                                          <span className="text-[10px] text-slate-400 font-bold ml-2 italic">외 {(d.matchedMenus?.length ? d.matchedMenus : d.allMenus).length - 20}개의 메뉴가 더 있습니다.</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && <div className="flex justify-start animate-pulse"><div className="bg-white p-4 rounded-3xl shadow-sm font-black text-[10px] text-slate-400 uppercase tracking-widest">Processing Data...</div></div>}
                  </div>
                  <div className="p-6 bg-white border-t border-slate-100">
                    <div className="max-w-4xl mx-auto relative group">
                      <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="질문을 입력하세요 (예: 정보전략팀 메뉴 알려줘)" className="w-full pl-7 pr-16 py-5 bg-slate-50 border border-slate-200 rounded-2xl outline-none text-[15px] font-bold shadow-inner focus:bg-white transition-all" />
                      <button onClick={handleSearch} className="absolute right-3 top-3 p-3 bg-red-700 text-white rounded-xl shadow-lg active:scale-95 disabled:opacity-50" disabled={loading || !chatInput.trim()}><Search size={22}/></button>
                    </div>
                  </div>
                </div>
              )}
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
        <p className="text-[11px] font-black text-slate-300 tracking-[0.5em] uppercase opacity-60">Copyright &copy; {new Date().getFullYear()} AJ네트웍스 전략기획실</p>
      </footer>
    </div>
  );
};

export default App;