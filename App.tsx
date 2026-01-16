
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown, ChevronRight, Layout, MessageSquare, AlertCircle, RefreshCcw, Loader2, Home, ListFilter, ShieldCheck, Check, X, Layers, Copy, ClipboardCheck, Info, ExternalLink, MousePointer2, UserCheck, PlusCircle, Send, CheckCircle2, ChevronUp } from 'lucide-react';
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

const compareEtcLast = (a: string, b: string) => {
  if (a === '기타' && b !== '기타') return 1;
  if (a !== '기타' && b === '기타') return -1;
  return a.localeCompare(b);
};

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
      normalize(opt.label).includes(normalize(searchTerm))
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
          <div className="flex-1 flex items-center">
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
              <span className={`text-sm font-bold ${selectedOption ? 'text-slate-800' : 'text-slate-400'}`}>
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
                  {opt.label}
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

// --- Main App Component ---
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

  useEffect(() => {
    setLoading(true);
    dataService.fetchTeams()
      .then(fetchedTeams => {
        const uniqueTeamsMap = new Map<string, Team>();
        fetchedTeams.forEach(t => {
          const name = (t.team_name || '').trim();
          if (!name) return;
          const normalizedName = normalize(name);
          if (!uniqueTeamsMap.has(normalizedName)) {
            uniqueTeamsMap.set(normalizedName, { ...t, team_name: name });
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
    setBundleLoading(true);
    dataService.fetchSystemsByTeam(selectedTeam).then(setSystems).catch(err => setError(err.message));
    dataService.fetchRoleBundle(selectedTeam).then(setFullBundle).catch(() => setFullBundle([])).finally(() => setBundleLoading(false));
    setSelectedSystem('');
    setSelectedRoleGroupKey('');
    setCollapsedL1s(new Set());
  }, [selectedTeam]);

  useEffect(() => {
    setSelectedRoleGroupKey('');
    setCollapsedL1s(new Set());
  }, [selectedSystem]);

  const unifiedRoles = useMemo(() => {
    const roleMap: Record<string, { groupLabel: string, desc: Set<string>, codes: Set<string>, lv3s: Set<string> }> = {};
    
    fullBundle.forEach(b => {
      if (b.sys_code !== selectedSystem) return;
      const { groupKey, groupLabel, l3 } = parseAuthLevels(b.auth_name);
      const authDesc = cleanValue(b.auth_desc);
      
      if (!roleMap[groupKey]) {
        roleMap[groupKey] = {
          groupLabel,
          desc: new Set(authDesc !== '기타' ? [authDesc] : []),
          codes: new Set([cleanValue(b.auth_code)]),
          lv3s: new Set(l3 ? [l3] : [])
        };
      } else {
        if (authDesc !== '기타') roleMap[groupKey].desc.add(authDesc);
        roleMap[groupKey].codes.add(cleanValue(b.auth_code));
        if (l3) roleMap[groupKey].lv3s.add(l3);
      }
    });

    return Object.entries(roleMap).map(([groupKey, data]) => ({
      groupKey,
      auth_name: data.groupLabel,
      auth_desc: Array.from(data.desc).join(' / ') || '', // '기타' 대신 빈 문자열 반환
      auth_code: Array.from(data.codes).join(', '),
      thirdLevels: Array.from(data.lv3s).sort(compareEtcLast)
    })).sort((a, b) => compareEtcLast(a.auth_name, b.auth_name));
  }, [fullBundle, selectedSystem]);

  const selectedGroup = useMemo(() => 
    unifiedRoles.find(r => r.groupKey === selectedRoleGroupKey), 
    [unifiedRoles, selectedRoleGroupKey]
  );

  const processedMenus = useMemo(() => {
    if (!selectedRoleGroupKey) return [];
    const targetBundles = fullBundle.filter(b => {
      if (b.sys_code !== selectedSystem) return false;
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
    Object.keys(nestedMenus.tree).sort((a, b) => compareEtcLast(nestedMenus.l1LabelMap[a], nestedMenus.l1LabelMap[b])), 
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
    if (!chatInput.trim() || !selectedTeam || !selectedSystem) return;
    const userMsg: ChatMessage = { role: 'user', content: chatInput };
    setMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setLoading(true);
    try {
      const teamName = teams.find(t => t.team_code === selectedTeam)?.team_name || '';
      const sysName = systems.find(s => s.sys_code === selectedSystem)?.sys_name || '';
      const analysis = await analyzeIntent(userMsg.content, teamName, sysName);
      const kwd = normalize(analysis.keyword);
      const bundles = fullBundle.filter(b => b.sys_code === selectedSystem);
      let resData: any = null;
      if (analysis.type === 'ROLE_TO_MENU') {
        const matches = bundles.filter(b => normalize(parseAuthLevels(b.auth_name).groupLabel).includes(kwd));
        const seen = new Set<string>();
        resData = matches.flatMap(b => b.menus).filter(m => {
          const name = cleanValue(m.path.split('>').pop());
          if (!hasKorean(name) || seen.has(normalize(name))) return false;
          seen.add(normalize(name));
          return true;
        });
      } else if (analysis.type === 'MENU_TO_ROLE') {
        const seen = new Set<string>();
        resData = bundles.filter(b => b.menus.some(m => normalize(m.path).includes(kwd)))
          .map(b => ({ auth_name: parseAuthLevels(b.auth_name).groupLabel, auth_code: b.auth_code }))
          .filter(r => {
            const n = normalize(r.auth_name);
            if (seen.has(n)) return false;
            seen.add(n);
            return true;
          });
      } else if (analysis.type === 'ROLE_LIST') {
        resData = unifiedRoles;
      }
      setMessages(prev => [...prev, { role: 'assistant', content: analysis.message || '결과를 확인하세요.', data: resData }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '분석 중 오류가 발생했습니다.' }]);
    } finally {
      setLoading(false);
    }
  };

  const teamOptions = useMemo(() => teams.map(t => ({ value: t.team_code, label: t.team_name })), [teams]);
  const systemOptions = useMemo(() => systems.map(s => ({ value: s.sys_code, label: s.sys_name })), [systems]);

  const guideSteps = [
    { icon: <MousePointer2 size={16}/>, text: "AJ 포털 > IAM 신청", url: "https://iam.ajias.co.kr/" },
    { icon: <Layers size={16}/>, text: "애플리케이션 권한 신청" },
    { icon: <UserCheck size={16}/>, text: "본인 신청 체크" },
    { icon: <PlusCircle size={16}/>, text: "원하는 시스템 역할 신청" },
    { icon: <Copy size={16}/>, text: "역할 명 입력" },
    { icon: <Send size={16}/>, text: "신청사유 입력 후 다음" },
    { icon: <CheckCircle2 size={16}/>, text: "승인 시 권한 부여 완료" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      <header className="bg-[#c8102e] text-white shadow-xl p-5 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-5">
            <div className="bg-white p-1.5 rounded-lg shadow-inner">
              <img src={LOGO_PATH} alt="Logo" className="h-8 w-auto object-contain" onError={(e) => (e.target as any).src = 'https://picsum.photos/120/40?grayscale'} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter leading-none text-white">권한/메뉴 안내 센터</h1>
              <p className="text-[10px] font-bold opacity-60 mt-1 uppercase tracking-widest hidden sm:block">AJ Core Intelligence Division</p>
            </div>
          </div>
          <div className="bg-white/10 px-3 py-1.5 rounded-full border border-white/20 hidden md:flex items-center gap-2">
            <ShieldCheck size={14} className="text-red-200" />
            <span className="text-[10px] font-black uppercase tracking-tight">AJ System Trusted</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-6 animate-fade-in">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-6 items-end">
          <SearchableSelect options={teamOptions} value={selectedTeam} onChange={setSelectedTeam} placeholder="팀 선택" label="My Team" icon={<Home size={14} className="text-red-600"/>} />
          <SearchableSelect options={systemOptions} value={selectedSystem} onChange={setSelectedSystem} placeholder="시스템 선택" label="Target System" icon={<Layout size={14} className="text-red-600"/>} disabled={!selectedTeam} />
          <button onClick={() => window.location.reload()} className="p-4 text-slate-400 hover:text-red-600 border border-slate-200 rounded-xl bg-white shadow-sm transition-all active:scale-95 mb-[2px]">
            <RefreshCcw size={20}/>
          </button>
        </section>

        {selectedTeam && selectedSystem ? (
          <div className="flex flex-col flex-1 space-y-6">
            <section className="bg-slate-900 text-white rounded-3xl overflow-hidden shadow-xl border border-slate-800 transition-all">
              <button onClick={() => setIsGuideOpen(!isGuideOpen)} className="w-full flex items-center justify-between p-5 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-red-600 p-1.5 rounded-lg shadow-lg">
                    <Info size={18} className="text-white" />
                  </div>
                  <span className="text-sm font-black uppercase tracking-tight">권한 신청 방법 (IAM 이용 가이드)</span>
                </div>
                {isGuideOpen ? <ChevronUp size={20} className="text-slate-400"/> : <ChevronDown size={20} className="text-slate-400"/>}
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
                  <div className="mt-4 pt-4 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <p className="text-[10px] text-slate-500 font-bold">* 권한 부여 후에도 메뉴가 보이지 않을 경우 IT운영팀 권한 담당자에게 문의 바랍니다.</p>
                    <div className="flex items-center gap-4">
                       <span className="text-[10px] px-3 py-1 rounded-full bg-white/10 text-slate-400 font-bold italic">담당자: IT운영팀 권한관리센터</span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2 text-slate-900 font-black text-sm uppercase tracking-tight">
                  <ClipboardCheck size={18} className="text-red-600" />
                  신청 가능 권한 목록 <span className="text-xs text-slate-400 font-bold normal-case ml-2">(클릭하여 권한명 복사)</span>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {unifiedRoles.map((role) => (
                  <button key={role.groupKey} onClick={() => handleCopyRole(role.auth_name)} className="relative group bg-slate-50 hover:bg-red-50 border border-slate-100 hover:border-red-200 p-3 rounded-xl transition-all text-left flex flex-col gap-1 overflow-hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-slate-400 group-hover:text-red-400 uppercase tracking-tighter truncate w-[70%]">{role.auth_code}</span>
                      <Copy size={12} className="text-slate-300 group-hover:text-red-400" />
                    </div>
                    <span className="text-xs font-black text-slate-700 group-hover:text-red-700 truncate">{role.auth_name}</span>
                    {copyToast === role.auth_name && (
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
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Primary Roles</span>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                      {unifiedRoles.map(r => (
                        <button key={r.groupKey} onClick={() => setSelectedRoleGroupKey(r.groupKey)} className={`w-full text-left p-4 rounded-2xl border transition-all ${selectedRoleGroupKey === r.groupKey ? 'bg-red-600 border-red-600 text-white shadow-lg scale-[1.02]' : 'bg-white border-slate-200 text-slate-600 hover:bg-red-50/30'}`}>
                          <div className={`font-black text-sm ${r.auth_name === '기타' ? 'opacity-50 italic' : ''}`}>{r.auth_name}</div>
                        </button>
                      ))}
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
                            
                            {/* 상세 권한 설명 노출 영역 */}
                            <div className="bg-red-50/50 p-5 rounded-2xl border border-red-100/50 shadow-sm">
                                <p className="text-slate-700 font-bold text-[15px] leading-relaxed">
                                    {selectedGroup?.auth_desc ? selectedGroup.auth_desc : `${selectedGroup?.auth_name} 권한에 대한 상세 설명이 등록되어 있지 않습니다.`}
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2 items-center">
                              {selectedGroup?.thirdLevels && selectedGroup.thirdLevels.length > 0 && selectedGroup.thirdLevels.map((lv3, idx) => (
                                <span key={idx} className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-tight border border-slate-200">{lv3}</span>
                              ))}
                              <div className="ml-auto relative w-full lg:w-80 mt-4 lg:mt-0">
                                <input type="text" placeholder="메뉴 경로 검색..." value={menuFilter} onChange={e => setMenuFilter(e.target.value)} className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-red-500/10 outline-none transition-all shadow-inner" />
                                <Search className="absolute left-4 top-3.5 text-slate-400" size={18}/>
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
                                      {Object.keys(l2Data).sort((a, b) => compareEtcLast(nestedMenus.l2LabelMap[a], nestedMenus.l2LabelMap[b])).map(l2Norm => (
                                        <div key={l2Norm} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                                          <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-50 flex items-center justify-between">
                                            <div className="flex items-center gap-3"><Layers size={14} className="text-red-500" /><h4 className={`text-xs font-black uppercase tracking-tight ${nestedMenus.l2LabelMap[l2Norm] === '기타' ? 'text-slate-400 italic' : 'text-slate-700'}`}>{nestedMenus.l2LabelMap[l2Norm]}</h4></div>
                                            <span className="text-[10px] font-bold text-slate-400">{l2Data[l2Norm].length} Items</span>
                                          </div>
                                          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                            {l2Data[l2Norm].map((m, i) => (
                                              <div key={i} className={`menu-card p-4 rounded-2xl flex items-center justify-center text-center min-h-[70px] border transition-all ${m.l3 === '기타' ? 'bg-slate-50/30 border-slate-100 grayscale-[0.5]' : 'bg-white border-slate-100 shadow-sm hover:border-red-200 hover:shadow-md'}`}>
                                                <span className={`text-sm font-bold break-keep leading-snug ${m.l3 === '기타' ? 'text-slate-400 italic' : 'text-slate-800'}`}>{m.l3}</span>
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
                        <Layout size={100} strokeWidth={1}/>
                        <p className="font-black text-2xl uppercase tracking-tighter">Select a role to inspect</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 bg-slate-50/50">
                  <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                    {messages.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                        <div className="p-8 bg-white rounded-full shadow-lg text-red-600"><MessageSquare size={48}/></div>
                        <p className="font-black text-slate-900 text-xl">AI 스마트 검색</p>
                        <p className="text-sm font-bold italic">계층 구조를 기반으로 권한과 메뉴를 분석합니다.</p>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                        <div className={`max-w-[85%] p-5 rounded-3xl shadow-md border ${m.role === 'user' ? 'bg-red-700 text-white rounded-br-none border-red-800' : 'bg-white text-slate-800 rounded-bl-none border-slate-100'}`}>
                          <p className="text-[15px] font-bold whitespace-pre-wrap">{m.content}</p>
                          {m.data && Array.isArray(m.data) && (m.data as any[]).length > 0 && (
                            <div className="mt-4 pt-4 border-t border-black/5 grid grid-cols-1 gap-2">
                              {(m.data as any[]).slice(0, 15).map((d: any, j: number) => (
                                <div key={j} className="bg-black/5 p-3 rounded-xl text-[12px] font-black flex justify-between items-center">
                                  <span>{d.path ? cleanValue(d.path.split('>').pop()) : d.auth_name}</span>
                                  {d.auth_code && <span className="opacity-40 font-mono text-[10px]">[{d.auth_code}]</span>}
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
                      <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="질문을 입력하세요..." className="w-full pl-7 pr-16 py-5 bg-slate-50 border border-slate-200 rounded-2xl outline-none text-[15px] font-bold shadow-inner focus:bg-white transition-all" />
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
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">AJ Access Portal</h2>
              <p className="text-slate-500 font-bold text-lg leading-relaxed">팀과 시스템을 선택하여 <br/> <span className="text-red-600">계층형 권한 구조</span>를 확인하세요.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="p-10 text-center bg-white border-t border-slate-50 mt-10">
        <p className="text-[11px] font-black text-slate-300 tracking-[0.5em] uppercase opacity-60">Copyright &copy; {new Date().getFullYear()} AJ Networks DX Division</p>
      </footer>
    </div>
  );
};

export default App;
