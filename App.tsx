
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronDown, Layout, MessageSquare, AlertCircle, RefreshCcw, Loader2, Home, ListFilter, ShieldCheck, Check } from 'lucide-react';
import * as dataService from './services/dataService';
import { Team, System, Role, RoleBundle, ChatMessage, Menu } from './types';
import { analyzeIntent } from './services/geminiService';

const LOGO_PATH = dataService.getAssetPath('assets/logo.png');

// --- SearchableSelect 커스텀 컴포넌트 ---
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

  const filteredOptions = options.filter(opt =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className={`flex-1 w-full space-y-2 relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`} ref={containerRef}>
      <label className="text-[11px] font-black text-slate-400 flex items-center gap-2 uppercase tracking-tight ml-1">
        {icon} {label}
      </label>
      <div 
        className={`relative group bg-slate-50 border border-slate-200 rounded-xl overflow-hidden transition-all shadow-sm ${isOpen ? 'ring-4 ring-red-500/10 border-red-500 bg-white' : 'hover:bg-white'}`}
        onClick={() => !disabled && setIsOpen(true)}
      >
        <div className="flex items-center px-4 py-3.5">
          <input
            type="text"
            className="w-full bg-transparent outline-none font-bold text-slate-700 placeholder-slate-400 text-sm"
            placeholder={selectedOption ? selectedOption.label : placeholder}
            value={isOpen ? searchTerm : (selectedOption ? selectedOption.label : '')}
            onChange={(e) => setSearchTerm(e.target.value)}
            readOnly={!isOpen}
            onFocus={() => setIsOpen(true)}
          />
          <ChevronDown className={`ml-2 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-red-500' : ''}`} size={18} />
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-2xl z-[100] max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-200">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
                  className={`px-5 py-3 text-sm font-bold flex items-center justify-between cursor-pointer transition-colors ${value === opt.value ? 'bg-red-50 text-red-700' : 'text-slate-600 hover:bg-slate-50'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                >
                  {opt.label}
                  {value === opt.value && <Check size={14} />}
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-xs text-slate-400 font-bold">검색 결과가 없습니다</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- 메인 App 컴포넌트 ---
const App: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [systems, setSystems] = useState<System[]>([]);
  const [selectedSystem, setSelectedSystem] = useState<string>('');
  
  const [loading, setLoading] = useState(false);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'chat'>('browse');
  
  const [roles, setRoles] = useState<Role[]>([]);
  const [fullBundle, setFullBundle] = useState<RoleBundle[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [menuFilter, setMenuFilter] = useState<string>('');

  const [chatInput, setChatInput] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setLoading(true);
    dataService.fetchTeams()
      .then(setTeams)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedTeam) return;
    setBundleLoading(true);
    dataService.fetchSystemsByTeam(selectedTeam).then(setSystems).catch(err => setError(err.message));
    dataService.fetchRoleBundle(selectedTeam).then(setFullBundle).catch(() => setFullBundle([])).finally(() => setBundleLoading(false));
    setSelectedSystem('');
    setSelectedRoleId('');
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam || !selectedSystem) { setRoles([]); return; }
    dataService.fetchRolesByTeamSys(selectedTeam, selectedSystem).then(setRoles).catch(err => setError(err.message));
    setSelectedRoleId('');
  }, [selectedTeam, selectedSystem]);

  const getLastMenuName = (path: string) => {
    const parts = path.split('>');
    return parts[parts.length - 1]?.trim() || path;
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
      
      const searchKwd = analysis.keyword.toLowerCase();
      const filtered = fullBundle.filter(b => b.sys_code === selectedSystem);
      let resultData: any = null;
      let finalMessage = analysis.message;

      if (analysis.type === 'ROLE_TO_MENU') {
        const target = filtered.find(b => 
          b.auth_name.toLowerCase().includes(searchKwd) || 
          b.auth_code.toLowerCase() === searchKwd
        );
        if (target) resultData = target.menus;
        else finalMessage = `'${analysis.keyword}' 권한을 찾을 수 없습니다.`;
      } else if (analysis.type === 'MENU_TO_ROLE') {
        resultData = filtered.filter(b => 
          b.menus.some(m => m.path.toLowerCase().includes(searchKwd))
        ).map(r => ({ auth_name: r.auth_name, auth_code: r.auth_code }));
        if (!resultData.length) finalMessage = `'${analysis.keyword}' 메뉴에 대한 권한 정보가 없습니다.`;
      } else if (analysis.type === 'ROLE_LIST') {
        resultData = roles;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: finalMessage || '결과를 확인하세요.', data: resultData }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '분석 중 오류가 발생했습니다.' }]);
    } finally {
      setLoading(false);
    }
  };

  const filteredMenus = useMemo(() => {
    const roleData = fullBundle.find(b => b.auth_code === selectedRoleId && b.sys_code === selectedSystem);
    if (!roleData) return [];
    if (!menuFilter) return roleData.menus;
    const filterText = menuFilter.toLowerCase();
    return roleData.menus.filter(m => m.path.toLowerCase().includes(filterText));
  }, [selectedRoleId, selectedSystem, fullBundle, menuFilter]);

  const groupedMenus = useMemo(() => {
    const groups: Record<string, Menu[]> = {};
    filteredMenus.forEach(m => {
      const root = m.path.split('>')[0]?.trim() || '기타';
      if (!groups[root]) groups[root] = [];
      groups[root].push(m);
    });
    return groups;
  }, [filteredMenus]);

  const teamOptions = teams.map(t => ({ value: t.team_code, label: t.team_name }));
  const systemOptions = systems.map(s => ({ value: s.sys_code, label: s.sys_name }));

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      <header className="bg-[#c8102e] text-white shadow-xl p-5 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-5">
            <div className="bg-white p-1.5 rounded-lg shadow-inner">
              <img 
                src={LOGO_PATH} 
                alt="Logo" 
                className="h-8 w-auto object-contain" 
                onError={(e) => (e.target as any).src = 'https://picsum.photos/120/40?grayscale'} 
              />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tighter leading-none">권한/메뉴 안내 센터</h1>
              <p className="text-[10px] font-bold opacity-60 mt-1 uppercase tracking-widest hidden sm:block">Permission Intelligence System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <div className="bg-white/10 px-3 py-1.5 rounded-full border border-white/20 hidden md:flex items-center gap-2">
                <ShieldCheck size={14} className="text-red-200" />
                <span className="text-[10px] font-black uppercase">AJ Safe Access</span>
             </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-8 animate-fade-in">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 flex flex-col md:flex-row gap-6 items-end">
          <SearchableSelect
            options={teamOptions}
            value={selectedTeam}
            onChange={setSelectedTeam}
            placeholder="소속 팀을 검색하거나 선택하세요"
            label="My Team"
            icon={<Home size={14} className="text-red-600"/>}
          />

          <SearchableSelect
            options={systemOptions}
            value={selectedSystem}
            onChange={setSelectedSystem}
            placeholder="시스템을 검색하거나 선택하세요"
            label="Target System"
            icon={<Layout size={14} className="text-red-600"/>}
            disabled={!selectedTeam}
          />

          <button 
            onClick={() => window.location.reload()} 
            className="p-4 text-slate-400 hover:text-red-600 border border-slate-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-all active:scale-95 mb-[2px]"
            title="초기화"
          >
            <RefreshCcw size={20}/>
          </button>
        </section>

        {selectedTeam && selectedSystem ? (
          <div className="flex flex-col flex-1 space-y-6">
            <div className="flex bg-slate-200/50 p-1.5 rounded-2xl w-fit shadow-inner">
              <button 
                onClick={() => setActiveTab('browse')} 
                className={`flex items-center gap-2 px-8 py-2.5 rounded-xl font-black text-sm transition-all ${activeTab === 'browse' ? 'bg-white text-red-700 shadow-lg scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Layout size={18}/> 권한별 메뉴 조회
              </button>
              <button 
                onClick={() => setActiveTab('chat')} 
                className={`flex items-center gap-2 px-8 py-2.5 rounded-xl font-black text-sm transition-all ${activeTab === 'chat' ? 'bg-white text-red-700 shadow-lg scale-[1.02]' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <MessageSquare size={18}/> AI 스마트 검색
              </button>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 flex-1 overflow-hidden min-h-[650px] flex flex-col">
              {activeTab === 'browse' ? (
                <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
                  <div className="w-full md:w-80 border-r border-slate-100 bg-slate-50/50 p-5 flex flex-col gap-4 overflow-hidden">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">Role List</span>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                      {roles.length > 0 ? roles.map(r => (
                        <button 
                          key={r.auth_code} 
                          onClick={() => setSelectedRoleId(r.auth_code)} 
                          className={`w-full text-left p-4 rounded-2xl border transition-all duration-300 ${selectedRoleId === r.auth_code ? 'bg-red-600 border-red-600 text-white shadow-xl scale-[1.02]' : 'bg-white border-slate-200 text-slate-600 hover:border-red-300 hover:bg-red-50/30'}`}
                        >
                          <div className={`font-black text-sm leading-tight ${selectedRoleId === r.auth_code ? 'text-white' : 'text-slate-900'}`}>{r.auth_name}</div>
                          <div className={`text-[10px] mt-2 opacity-70 line-clamp-2 leading-relaxed ${selectedRoleId === r.auth_code ? 'text-red-50' : 'text-slate-500'}`}>{r.auth_desc}</div>
                        </button>
                      )) : (
                        <div className="py-20 text-center opacity-30">
                           <Loader2 className="animate-spin mx-auto text-slate-400" size={32}/>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col bg-white overflow-hidden">
                    {selectedRoleId ? (
                      <>
                        <div className="p-8 border-b border-slate-50 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                          <div className="space-y-1">
                            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{roles.find(r => r.auth_code === selectedRoleId)?.auth_name}</h2>
                            <p className="text-sm text-slate-400 font-medium">{roles.find(r => r.auth_code === selectedRoleId)?.auth_desc}</p>
                          </div>
                          <div className="relative w-full lg:w-80">
                            <input 
                              type="text" 
                              placeholder="메뉴명 필터링 (대소문자 무시)..." 
                              value={menuFilter} 
                              onChange={e => setMenuFilter(e.target.value)} 
                              className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all shadow-inner"
                            />
                            <Search className="absolute left-4 top-3.5 text-slate-400" size={18}/>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-8 space-y-12 bg-slate-50/30 custom-scrollbar">
                          {bundleLoading ? (
                             <div className="py-32 flex flex-col items-center justify-center gap-4 text-slate-300">
                                <Loader2 className="animate-spin" size={48}/>
                                <span className="font-black text-xs uppercase tracking-widest">Loading Bundle</span>
                             </div>
                          ) : Object.keys(groupedMenus).length > 0 ? (
                            Object.entries(groupedMenus).map(([group, items]) => (
                              <div key={group} className="space-y-6">
                                <h4 className="flex items-center gap-3 text-sm font-black text-red-700 bg-red-50 w-fit px-5 py-2 rounded-2xl border border-red-100 uppercase tracking-tighter">
                                  <ListFilter size={16}/> {group}
                                  <span className="bg-red-200/50 px-2 py-0.5 rounded text-[10px] ml-1">{items.length}</span>
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                  {items.map((m, i) => (
                                    <div key={i} className="menu-card bg-white border border-slate-100 p-5 rounded-2xl shadow-sm flex items-center justify-center text-center min-h-[85px]">
                                      <span className="text-sm font-bold text-slate-800 break-keep leading-snug">{getLastMenuName(m.path)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-40 opacity-20 space-y-4">
                              <Search size={64} className="mx-auto"/>
                              <p className="font-black text-xl">검색 결과가 없습니다</p>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center opacity-10 space-y-6">
                        <div className="p-10 border-4 border-dashed border-slate-300 rounded-full">
                          <Layout size={100} strokeWidth={1}/>
                        </div>
                        <p className="font-black text-2xl tracking-tighter uppercase">Select a role to inspect</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 bg-slate-50/50">
                  <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                    {messages.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-8 max-w-sm mx-auto opacity-50 mt-10">
                        <div className="p-10 bg-white rounded-full shadow-xl text-red-600 border border-slate-100">
                          <MessageSquare size={64} strokeWidth={1}/>
                        </div>
                        <div className="space-y-3">
                          <p className="font-black text-slate-900 text-2xl tracking-tight leading-tight">AI 권한 어시스턴트</p>
                          <p className="text-sm text-slate-500 font-bold leading-relaxed">
                            "admin 권한이 보는 메뉴 알려줘"<br/>
                            "정산 메뉴를 보려면 어떤 권한이 필요해?"<br/>
                            대소문자 구분 없이 질문해 보세요.
                          </p>
                        </div>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                        <div className={`max-w-[85%] p-5 rounded-3xl shadow-md border ${m.role === 'user' ? 'bg-red-700 text-white rounded-br-none border-red-800' : 'bg-white text-slate-800 rounded-bl-none border-slate-100'}`}>
                          <p className="text-[15px] font-bold whitespace-pre-wrap leading-relaxed">{m.content}</p>
                          {m.data && Array.isArray(m.data) && m.data.length > 0 && (
                            <div className="mt-5 pt-5 border-t border-black/5 grid grid-cols-1 gap-2">
                              {m.data.slice(0, 15).map((d: any, j: number) => (
                                <div key={j} className="bg-black/5 hover:bg-black/10 transition-colors p-3.5 rounded-xl text-[12px] font-black flex justify-between items-center">
                                  <span>{d.path ? getLastMenuName(d.path) : d.auth_name}</span>
                                  {d.auth_code && <span className="text-[10px] opacity-40 font-mono tracking-tighter">[{d.auth_code}]</span>}
                                </div>
                              ))}
                              {m.data.length > 15 && <p className="text-[10px] text-center opacity-30 mt-2 font-bold italic">...외 {m.data.length - 15}건의 데이터가 더 있습니다.</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex justify-start animate-pulse">
                        <div className="bg-white border border-slate-100 p-4 rounded-3xl rounded-bl-none shadow-sm flex items-center gap-3">
                           <div className="flex gap-1">
                              <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce"></span>
                              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                              <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                           </div>
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Thinking</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-6 bg-white border-t border-slate-100">
                    <div className="max-w-4xl mx-auto relative group">
                      <input 
                        type="text" 
                        value={chatInput} 
                        onChange={e => setChatInput(e.target.value)} 
                        onKeyDown={e => e.key === 'Enter' && handleSearch()} 
                        placeholder="궁금한 내용을 입력하세요 (대소문자 구분 없음)..." 
                        className="w-full pl-7 pr-16 py-5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none text-[15px] font-bold shadow-inner group-hover:bg-white transition-all" 
                      />
                      <button 
                        onClick={handleSearch} 
                        disabled={loading || !chatInput.trim()}
                        className="absolute right-3 top-3 p-3 bg-red-700 text-white rounded-xl hover:bg-red-800 transition-all shadow-lg active:scale-95 disabled:bg-slate-300 disabled:shadow-none"
                      >
                        <Search size={22}/>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 py-48 flex flex-col items-center justify-center text-center space-y-8 mt-10">
            <div className="p-12 bg-red-50 text-red-600 rounded-full animate-pulse shadow-inner">
              <Home size={72} strokeWidth={1.5}/>
            </div>
            <div className="space-y-4 px-6">
              <h2 className="text-4xl font-black text-slate-900 tracking-tight">서비스 시작하기</h2>
              <p className="text-slate-500 font-bold text-xl leading-relaxed">
                상단 바에서 <span className="text-red-600">소속 팀</span>과 <span className="text-red-600">대상 시스템</span>을 선택하시면<br/>
                맞춤형 권한 가이드 및 AI 검색 기능을 제공합니다.
              </p>
            </div>
          </div>
        )}
      </main>

      <footer className="p-10 text-center bg-white border-t border-slate-50 mt-10">
        <p className="text-[11px] font-black text-slate-300 tracking-[0.5em] uppercase opacity-60">
          Copyright &copy; {new Date().getFullYear()} AJ Corp Group Intelligence Division
        </p>
      </footer>
    </div>
  );
};

export default App;
