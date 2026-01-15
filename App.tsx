
import React, { useState, useEffect } from 'react';
import { Search, ChevronDown, Layout, MessageSquare, AlertCircle, RefreshCcw, Loader2, Home, ListFilter } from 'lucide-react';
import * as dataService from './services/dataService';
import { Team, System, Role, RoleBundle, ChatMessage, Menu } from './types';
import { analyzeIntent } from './services/geminiService';

const LOGO_PATH = dataService.getAssetPath('assets/logo.png');

const App: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [systems, setSystems] = useState<System[]>([]);
  const [selectedSystem, setSelectedSystem] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(false);
  const [bundleLoading, setBundleLoading] = useState<boolean>(false);
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
    setError(null);
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
      
      let answer = analysis.message || '검색 결과를 찾았습니다.';
      let data: any = null;
      const searchKwd = analysis.keyword.toLowerCase();
      const filtered = fullBundle.filter(b => b.sys_code === selectedSystem);

      if (analysis.type === 'ROLE_TO_MENU') {
        const role = filtered.find(b => b.auth_name.toLowerCase().includes(searchKwd) || b.auth_code.toLowerCase() === searchKwd);
        if (role) { data = role.menus; answer = `${role.auth_name} 권한의 메뉴입니다.`; }
      } else if (analysis.type === 'MENU_TO_ROLE') {
        data = filtered.filter(b => b.menus.some(m => m.path.toLowerCase().includes(searchKwd))).map(r => ({ auth_name: r.auth_name, auth_code: r.auth_code }));
      } else if (analysis.type === 'ROLE_LIST') {
        data = roles;
      }
      setMessages(prev => [...prev, { role: 'assistant', content: answer, data }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '오류가 발생했습니다.' }]);
    } finally { setLoading(false); }
  };

  const getFilteredMenus = () => {
    const roleData = fullBundle.find(b => b.auth_code === selectedRoleId && b.sys_code === selectedSystem);
    if (!roleData) return [];
    if (!menuFilter) return roleData.menus;
    const f = menuFilter.toLowerCase();
    return roleData.menus.filter(m => m.path.toLowerCase().includes(f));
  };

  const groupMenus = (menus: Menu[]) => {
    const g: Record<string, Menu[]> = {};
    menus.forEach(m => {
      const top = m.path.split('>')[0]?.trim() || '기타';
      if (!g[top]) g[top] = [];
      g[top].push(m);
    });
    return g;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fcfcfc]">
      <header className="bg-[#c8102e] text-white shadow-md p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="bg-white p-1 rounded-sm"><img src={LOGO_PATH} alt="Logo" className="h-7 w-auto" onError={(e) => (e.target as any).src = 'https://picsum.photos/100/30'} /></div>
            <h1 className="text-lg font-black tracking-tighter">권한 가이드 센터</h1>
          </div>
          <div className="hidden sm:block text-[10px] font-bold tracking-widest opacity-60">ADMIN PERMISSION SYSTEM</div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-8 animate-fade-in">
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-[11px] font-black text-gray-400 flex items-center gap-1.5"><Home size={12} className="text-red-600"/> 소속 팀</label>
            <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 focus:ring-2 focus:ring-red-500 outline-none font-bold text-gray-700">
              <option value="">-- 팀 선택 --</option>
              {teams.map(t => <option key={t.team_code} value={t.team_code}>{t.team_name}</option>)}
            </select>
          </div>
          <div className="flex-1 w-full space-y-1.5">
            <label className="text-[11px] font-black text-gray-400 flex items-center gap-1.5"><Layout size={12} className="text-red-600"/> 대상 시스템</label>
            <select value={selectedSystem} disabled={!selectedTeam} onChange={e => setSelectedSystem(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2.5 px-4 focus:ring-2 focus:ring-red-500 outline-none disabled:bg-gray-100 font-bold text-gray-700">
              <option value="">-- 시스템 선택 --</option>
              {systems.map(s => <option key={s.sys_code} value={s.sys_code}>{s.sys_name}</option>)}
            </select>
          </div>
          <button onClick={() => window.location.reload()} className="p-3 text-gray-400 hover:text-red-600 border border-gray-200 rounded-lg bg-white"><RefreshCcw size={18}/></button>
        </section>

        {selectedTeam && selectedSystem ? (
          <div className="flex flex-col flex-1 space-y-4">
            <div className="flex bg-gray-200/50 p-1 rounded-xl w-fit">
              {['browse', 'chat'].map(t => (
                <button key={t} onClick={() => setActiveTab(t as any)} className={`px-6 py-2 rounded-lg font-black text-xs transition-all ${activeTab === t ? 'bg-white text-red-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t === 'browse' ? '메뉴 브라우저' : '스마트 검색'}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 overflow-hidden min-h-[600px] flex flex-col">
              {activeTab === 'browse' ? (
                <div className="flex flex-col md:flex-row flex-1">
                  <div className="w-full md:w-64 border-r border-gray-50 bg-[#fafafa] p-4 flex flex-col gap-3">
                    <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest px-1">Roles</span>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1.5">
                      {roles.map(r => (
                        <button key={r.auth_code} onClick={() => setSelectedRoleId(r.auth_code)} className={`w-full text-left p-3 rounded-lg border transition-all ${selectedRoleId === r.auth_code ? 'bg-red-600 border-red-600 text-white shadow-md' : 'bg-white border-gray-100 text-gray-600 hover:border-red-200'}`}>
                          <div className="font-bold text-sm leading-tight">{r.auth_name}</div>
                          <div className={`text-[10px] mt-1 opacity-60 line-clamp-1 ${selectedRoleId === r.auth_code ? 'text-white' : ''}`}>{r.auth_desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col bg-white">
                    {selectedRoleId ? (
                      <>
                        <div className="p-6 border-b border-gray-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <div className="space-y-0.5">
                            <h2 className="text-xl font-black text-gray-800">{roles.find(r => r.auth_code === selectedRoleId)?.auth_name}</h2>
                            <p className="text-xs text-gray-400 font-bold">{roles.find(r => r.auth_code === selectedRoleId)?.auth_desc}</p>
                          </div>
                          <div className="relative w-full sm:w-64">
                            <input type="text" placeholder="메뉴 필터링..." value={menuFilter} onChange={e => setMenuFilter(e.target.value)} className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold focus:ring-1 focus:ring-red-500 outline-none" />
                            <Search className="absolute left-3 top-2.5 text-gray-300" size={14}/>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-10 bg-[#fdfdfd] custom-scrollbar">
                          {Object.entries(groupMenus(getFilteredMenus())).map(([g, items]) => (
                            <div key={g} className="space-y-4">
                              <h4 className="flex items-center gap-2 text-xs font-black text-red-700 bg-red-50 w-fit px-3 py-1 rounded-full border border-red-100 uppercase tracking-tighter"><ListFilter size={12}/> {g}</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {items.map((m, i) => (
                                  <div key={i} className="bg-white border border-gray-100 p-4 rounded-lg shadow-sm hover:border-red-500 transition-colors flex items-center justify-center text-center min-h-[64px]">
                                    <span className="text-sm font-bold text-gray-700 break-keep">{getLastMenuName(m.path)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center opacity-20"><Layout size={80}/><p className="font-black mt-4">권한을 선택하세요</p></div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 bg-[#f9f9f9]">
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {messages.map((m, i) => (
                      <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-4 rounded-2xl shadow-sm border ${m.role === 'user' ? 'bg-red-700 text-white rounded-br-none border-red-800' : 'bg-white text-gray-800 rounded-bl-none border-gray-100'}`}>
                          <p className="text-sm font-bold whitespace-pre-wrap">{m.content}</p>
                          {m.data && (
                            <div className="mt-4 pt-4 border-t border-black/5 grid grid-cols-1 gap-1.5">
                              {m.data.slice(0, 15).map((d: any, j: number) => (
                                <div key={j} className="bg-black/5 p-2 rounded text-[11px] font-black flex justify-between">
                                  <span>{d.path ? getLastMenuName(d.path) : d.auth_name}</span>
                                  {d.auth_code && <span className="opacity-40 ml-2">({d.auth_code})</span>}
                                </div>
                              ))}
                              {m.data.length > 15 && <p className="text-[10px] text-center opacity-30 mt-1 italic">...외 {m.data.length - 15}건 더 있음</p>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && <div className="flex justify-start animate-pulse"><div className="bg-white border border-gray-100 p-3 rounded-xl rounded-bl-none text-[10px] font-black text-gray-400">ANALYZING...</div></div>}
                  </div>
                  <div className="p-4 bg-white border-t border-gray-50">
                    <div className="max-w-3xl mx-auto relative">
                      <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} placeholder="질문하세요 (대소문자 무시)..." className="w-full pl-5 pr-12 py-3.5 bg-gray-50 border border-gray-100 rounded-xl focus:ring-2 focus:ring-red-500 outline-none text-sm font-bold shadow-inner" />
                      <button onClick={handleSearch} className="absolute right-2 top-2 p-2.5 bg-red-700 text-white rounded-lg hover:bg-red-800 transition-all"><Search size={18}/></button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-50 py-32 flex flex-col items-center justify-center text-center space-y-6">
            <div className="p-8 bg-red-50 text-red-600 rounded-full animate-pulse"><Home size={48}/></div>
            <div>
              <h2 className="text-2xl font-black text-gray-800">조회를 시작하세요</h2>
              <p className="text-gray-400 font-bold mt-2">상단 바에서 소속 팀과 대상 시스템을 선택해 주세요.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="p-8 text-center bg-white border-t border-gray-50">
        <p className="text-[10px] font-bold text-gray-300 tracking-[0.4em] uppercase">Copyright &copy; AJ Corp System Guide</p>
      </footer>
    </div>
  );
};

export default App;
