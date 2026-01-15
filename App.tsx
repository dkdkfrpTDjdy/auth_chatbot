
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
    if (!selectedTeam) {
      setSystems([]);
      setFullBundle([]);
      return;
    }

    setBundleLoading(true);
    setError(null);
    
    dataService.fetchSystemsByTeam(selectedTeam)
      .then(setSystems)
      .catch(err => setError(err.message));

    dataService.fetchRoleBundle(selectedTeam)
      .then(setFullBundle)
      .catch(err => {
        console.warn('Bundle load failed:', err);
        setFullBundle([]);
      })
      .finally(() => setBundleLoading(false));

    setSelectedSystem('');
    setSelectedRoleId('');
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam || !selectedSystem) {
      setRoles([]);
      return;
    }
    dataService.fetchRolesByTeamSys(selectedTeam, selectedSystem)
      .then(setRoles)
      .catch(err => setError(err.message));
    
    setSelectedRoleId('');
  }, [selectedTeam, selectedSystem]);

  const handleSearch = async () => {
    if (!chatInput.trim()) return;
    if (!selectedTeam || !selectedSystem) {
      setMessages(prev => [...prev, 
        { role: 'user', content: chatInput },
        { role: 'assistant', content: '먼저 상단에서 팀과 시스템을 선택해주세요.' }
      ]);
      setChatInput('');
      return;
    }

    const newUserMsg: ChatMessage = { role: 'user', content: chatInput };
    setMessages(prev => [...prev, newUserMsg]);
    setChatInput('');
    setLoading(true);

    try {
      const teamName = teams.find(t => t.team_code === selectedTeam)?.team_name || '';
      const systemName = systems.find(s => s.sys_code === selectedSystem)?.sys_name || '';
      
      const analysis = await analyzeIntent(chatInput, teamName, systemName);
      let answer = analysis.message || '검색 결과입니다.';
      let data: any = null;

      const filteredBundle = fullBundle.filter(b => b.sys_code === selectedSystem);

      if (analysis.type === 'ROLE_TO_MENU') {
        const targetRole = filteredBundle.find(b => 
          b.auth_name.toLowerCase().includes(analysis.keyword.toLowerCase()) ||
          b.auth_code === analysis.keyword
        );
        if (targetRole) {
          answer = `${targetRole.auth_name} 권한으로 접근 가능한 메뉴 목록입니다.`;
          data = targetRole.menus;
        } else {
          answer = `찾으시는 '${analysis.keyword}' 권한을 해당 시스템에서 찾을 수 없습니다.`;
        }
      } else if (analysis.type === 'MENU_TO_ROLE') {
        const matchingRoles = filteredBundle.filter(b => 
          b.menus.some(m => m.path.toLowerCase().includes(analysis.keyword.toLowerCase()))
        );
        if (matchingRoles.length > 0) {
          answer = `'${analysis.keyword}' 메뉴가 포함된 권한 리스트입니다.`;
          data = matchingRoles.map(r => ({ auth_name: r.auth_name, auth_code: r.auth_code, auth_desc: r.auth_desc }));
        } else {
          answer = `'${analysis.keyword}' 메뉴를 포함한 권한이 없습니다.`;
        }
      } else if (analysis.type === 'ROLE_LIST') {
        answer = `${teamName} - ${systemName} 의 전체 권한 목록입니다.`;
        data = roles;
      }

      setMessages(prev => [...prev, { role: 'assistant', content: answer, data }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '죄송합니다. 처리 중 오류가 발생했습니다.' }]);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredMenus = () => {
    const roleData = fullBundle.find(b => 
      b.auth_code === selectedRoleId && 
      b.sys_code === selectedSystem
    );
    
    if (!roleData) return [];
    if (!menuFilter) return roleData.menus;
    
    const filterLower = menuFilter.toLowerCase();
    return roleData.menus.filter(m => 
      m.path.toLowerCase().includes(filterLower) || 
      m.menu_id.toLowerCase().includes(filterLower)
    );
  };

  const groupMenus = (menus: Menu[]) => {
    const groups: Record<string, Menu[]> = {};
    menus.forEach(m => {
      const firstLevel = m.path.split('>')[0]?.trim() || '기타';
      if (!groups[firstLevel]) groups[firstLevel] = [];
      groups[firstLevel].push(m);
    });
    return groups;
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-red-700 text-white shadow-lg p-4 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="bg-white p-1.5 rounded-md shadow-inner">
              <img 
                src={LOGO_PATH} 
                alt="Logo" 
                className="h-8 w-auto object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://picsum.photos/100/40?grayscale';
                }}
              />
            </div>
            <h1 className="text-xl font-bold tracking-tight">권한/메뉴 안내 센터</h1>
          </div>
          <div className="hidden md:block text-xs opacity-75 font-medium tracking-widest">
            CORPORATE PERMISSION GUIDE SYSTEM
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row gap-6 items-end">
          <div className="flex-1 w-full space-y-2">
            <label className="text-xs font-bold text-gray-500 flex items-center gap-1.5 px-1">
              <Home size={14} className="text-red-600" /> 소속 팀 선택
            </label>
            <div className="relative">
              <select
                value={selectedTeam}
                onChange={(e) => setSelectedTeam(e.target.value)}
                className="w-full appearance-none bg-white border border-gray-300 rounded-xl py-3 px-4 focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none shadow-sm font-medium text-gray-700"
              >
                <option value="">-- 팀을 선택하세요 --</option>
                {teams.map(t => (
                  <option key={t.team_code} value={t.team_code}>{t.team_name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-4 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>

          <div className="flex-1 w-full space-y-2">
            <label className="text-xs font-bold text-gray-500 flex items-center gap-1.5 px-1">
              <Layout size={14} className="text-red-600" /> 대상 시스템
            </label>
            <div className="relative">
              <select
                value={selectedSystem}
                disabled={!selectedTeam}
                onChange={(e) => setSelectedSystem(e.target.value)}
                className="w-full appearance-none bg-white border border-gray-300 rounded-xl py-3 px-4 focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none disabled:bg-gray-100 disabled:text-gray-400 shadow-sm font-medium text-gray-700"
              >
                <option value="">-- 시스템을 선택하세요 --</option>
                {systems.map(s => (
                  <option key={s.sys_code} value={s.sys_code}>{s.sys_name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-4 text-gray-400 pointer-events-none" size={18} />
            </div>
          </div>

          <button 
            onClick={() => window.location.reload()}
            className="p-3 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all border border-gray-200 bg-white shadow-sm"
            title="새로고침"
          >
            <RefreshCcw size={20} />
          </button>
        </section>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="text-red-500 mt-0.5" size={20} />
            <div className="flex-1">
              <p className="text-red-800 font-bold text-sm">오류가 발생했습니다</p>
              <p className="text-red-700 text-xs mt-1">{error}</p>
            </div>
          </div>
        )}

        {selectedTeam && selectedSystem && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <div className="flex bg-gray-200/50 p-1 rounded-xl w-full md:w-fit shadow-inner">
              <button
                onClick={() => setActiveTab('browse')}
                className={`flex-1 md:flex-none px-8 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  activeTab === 'browse' ? 'bg-white text-red-700 shadow-md scale-[1.02]' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Layout size={18} /> 권한별 메뉴 조회
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 md:flex-none px-8 py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  activeTab === 'chat' ? 'bg-white text-red-700 shadow-md scale-[1.02]' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <MessageSquare size={18} /> AI 스마트 검색
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 min-h-[500px] overflow-hidden">
              {activeTab === 'browse' ? (
                <div className="flex flex-col md:flex-row h-[600px]">
                  <div className="w-full md:w-80 border-r border-gray-100 p-4 flex flex-col gap-4 bg-gray-50/50">
                    <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-widest px-2">권한 목록</h3>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                      {roles.length > 0 ? roles.map(role => (
                        <button
                          key={role.auth_code}
                          onClick={() => setSelectedRoleId(role.auth_code)}
                          className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                            selectedRoleId === role.auth_code 
                            ? 'bg-red-600 border-red-600 shadow-lg scale-[1.02] text-white' 
                            : 'bg-white border-gray-200 text-gray-700 hover:border-red-300 hover:bg-red-50/30'
                          }`}
                        >
                          <div className={`font-bold text-sm ${selectedRoleId === role.auth_code ? 'text-white' : 'text-gray-800'}`}>{role.auth_name}</div>
                          <div className={`text-xs mt-1.5 line-clamp-1 opacity-80 ${selectedRoleId === role.auth_code ? 'text-red-50' : 'text-gray-500'}`}>{role.auth_desc}</div>
                        </button>
                      )) : (
                        <div className="text-center py-10">
                          <Loader2 className="animate-spin text-gray-300 mx-auto" size={24} />
                          <p className="text-gray-400 text-xs mt-2 font-medium">권한을 불러오고 있습니다...</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 p-0 flex flex-col bg-white">
                    {!selectedRoleId ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4 opacity-40">
                        <div className="p-6 bg-gray-50 rounded-full">
                          <Layout size={64} strokeWidth={1.5} />
                        </div>
                        <p className="font-bold">좌측에서 권한을 선택하면 메뉴 정보가 표시됩니다.</p>
                      </div>
                    ) : (
                      <>
                        <div className="p-6 border-b border-gray-100 bg-white sticky top-0 z-10">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <h2 className="text-xl font-black text-gray-900 leading-none">
                                  {roles.find(r => r.auth_code === selectedRoleId)?.auth_name}
                                </h2>
                              </div>
                              <p className="text-sm text-gray-500 mt-2 font-medium">
                                {roles.find(r => r.auth_code === selectedRoleId)?.auth_desc}
                              </p>
                            </div>
                            <div className="relative w-full md:w-72">
                              <input
                                type="text"
                                placeholder="메뉴명 또는 ID로 필터링..."
                                value={menuFilter}
                                onChange={(e) => setMenuFilter(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 outline-none transition-all shadow-inner"
                              />
                              <Search className="absolute left-4 top-3.5 text-gray-400" size={16} />
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8 bg-gray-50/30">
                          {bundleLoading ? (
                             <div className="flex flex-col items-center justify-center py-20 gap-4">
                                <Loader2 className="animate-spin text-red-600" size={32} />
                                <p className="text-sm font-bold text-gray-500">메뉴 상세 데이터를 불러오는 중...</p>
                             </div>
                          ) : Object.keys(groupMenus(getFilteredMenus())).length > 0 ? (
                            Object.entries(groupMenus(getFilteredMenus())).map(([group, groupItems]) => (
                              <div key={group} className="space-y-3">
                                <h4 className="flex items-center gap-2 text-[13px] font-black text-red-700 px-3 py-1 bg-red-50 rounded-lg w-fit border border-red-100">
                                  <ListFilter size={14} /> {group}
                                </h4>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {groupItems.map(menu => (
                                    <div key={menu.menu_id} className="group bg-white border border-gray-200 p-4 rounded-xl shadow-sm hover:shadow-md hover:border-red-200 transition-all duration-200">
                                      <div className="flex justify-between items-start gap-2">
                                        <p className="text-sm text-gray-800 font-bold leading-snug group-hover:text-red-700 transition-colors">{menu.path}</p>
                                        <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono uppercase tracking-tighter">ID: {menu.menu_id}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-center py-20 space-y-3 opacity-50">
                              <Search size={40} className="mx-auto text-gray-300" />
                              <p className="text-gray-500 font-bold">검색 결과가 없거나 데이터가 준비되지 않았습니다.</p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-[600px] bg-gray-50">
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {messages.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-sm mx-auto opacity-80">
                        <div className="p-6 bg-red-100 rounded-full text-red-600 shadow-sm">
                          <MessageSquare size={48} strokeWidth={1.5} />
                        </div>
                        <div>
                          <p className="font-black text-gray-900 text-lg">AI 권한 어시스턴트</p>
                          <p className="text-sm text-gray-500 mt-2 font-medium leading-relaxed">
                            "ROLE_ADMIN 권한은 어떤 메뉴를 보나요?"<br/>
                            "사용자 관리 메뉴를 보려면 어떤 권한이 필요해?"<br/>
                            질문을 던져보세요.
                          </p>
                        </div>
                      </div>
                    )}
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-4 shadow-md ${
                          msg.role === 'user' 
                          ? 'bg-red-700 text-white rounded-br-none' 
                          : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none'
                        }`}>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap font-bold">{msg.content}</p>
                          {msg.data && (
                            <div className="mt-4 pt-4 border-t border-gray-100/20">
                              {Array.isArray(msg.data) && msg.data.length > 0 ? (
                                <div className="grid grid-cols-1 gap-2">
                                  {msg.data.slice(0, 15).map((item: any, i: number) => (
                                    <div key={i} className={`text-xs p-2.5 rounded-lg border ${msg.role === 'user' ? 'bg-red-800/40 border-red-500/30' : 'bg-gray-50 border-gray-100'}`}>
                                      {item.path ? (
                                        <div className="flex justify-between items-center">
                                          <span className="font-bold opacity-90">{item.path}</span>
                                          <span className="text-[9px] opacity-40 font-mono">{item.menu_id}</span>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          <span className="font-black text-red-700">{item.auth_name}</span>
                                          <span className="text-[10px] opacity-50">({item.auth_code})</span>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {msg.data.length > 15 && <p className="text-[10px] text-center opacity-40 italic mt-1">외 {msg.data.length - 15}건 더 있음...</p>}
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && (
                       <div className="flex justify-start">
                        <div className="bg-white border border-gray-100 text-gray-500 p-3 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-3">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce"></span>
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                          </div>
                          <span className="text-xs font-black text-gray-400 uppercase tracking-tighter">AI Thinking</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 bg-white border-t border-gray-100">
                    <div className="relative max-w-4xl mx-auto">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="질문을 입력하세요..."
                        className="w-full pr-14 pl-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-medium shadow-inner"
                      />
                      <button
                        onClick={handleSearch}
                        disabled={loading || !chatInput.trim()}
                        className="absolute right-2.5 top-2.5 p-2.5 bg-red-700 text-white rounded-xl hover:bg-red-800 transition-all shadow-md disabled:bg-gray-300 disabled:shadow-none"
                      >
                        <Search size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!selectedTeam && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-20 flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-24 h-24 bg-red-50 text-red-600 rounded-full flex items-center justify-center shadow-inner animate-pulse">
              <Home size={48} strokeWidth={1.5} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">서비스 시작하기</h2>
              <p className="text-gray-500 font-medium max-w-md">상단에서 소속 팀과 조회할 시스템을 선택하면<br/>맞춤형 권한 및 메뉴 안내가 시작됩니다.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-gray-100 p-6 text-center">
        <p className="text-[10px] text-gray-300 font-black uppercase tracking-[0.3em]">
          &copy; {new Date().getFullYear()} AJ Corp Internal Support System
        </p>
      </footer>
    </div>
  );
};

export default App;
