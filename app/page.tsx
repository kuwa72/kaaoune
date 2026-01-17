'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import useSWR, { mutate } from 'swr';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Home, Search, Loader2, User, ThumbsUp, ThumbsDown, Trash2, AlertTriangle, Building, Train, Car, Ruler, History, Paintbrush, RefreshCcw, LayoutGrid, List, Eye, EyeOff, CheckCircle2, XCircle, Clock, Calendar, Settings, Plus, X, MessageSquarePlus, Smile, Calculator, Percent, Wallet, ArrowRightLeft, Check, Layers, Sparkles, Users } from 'lucide-react';
import type { PropertyWithId, UserRating, PropertyStatus, UserSettings, UserConfig } from '@/lib/storage';
import EmojiPicker, { Theme, EmojiClickData } from 'emoji-picker-react';


const fetcher = (url: string) => fetch(url).then(res => res.json());


const STATUS_LABELS: Record<PropertyStatus, { label: string, color: string, icon: any }> = {
  considering: { label: '検討中', color: 'bg-blue-600 text-white', icon: Clock },
  exterior_viewed: { label: '外観確認済み', color: 'bg-teal-600 text-white', icon: Eye },
  viewing_scheduled: { label: '内見予定', color: 'bg-purple-600 text-white', icon: Calendar },
  viewed: { label: '内見済み', color: 'bg-indigo-600 text-white', icon: Eye },
  applying: { label: '手続き中', color: 'bg-yellow-600 text-white', icon: RefreshCcw },
  contracted: { label: '契約済み', color: 'bg-green-600 text-white', icon: CheckCircle2 },
  excluded: { label: '選外', color: 'bg-slate-600 text-white', icon: XCircle },
  sold_out: { label: '物件なし', color: 'bg-red-600 text-white', icon: AlertTriangle },
};

type ViewMode = 'grid' | 'list';
type SortKey = 'newest' | 'monthly_cost' | 'area' | 'year' | 'station' | 'status';

const STATUS_ORDER: Record<PropertyStatus, number> = {
  contracted: 0,
  applying: 1,
  viewed: 2,
  viewing_scheduled: 3,
  exterior_viewed: 4,
  considering: 5,
  excluded: 6,
  sold_out: 7,
};

const SORT_OPTIONS: Record<SortKey, { label: string, icon: any }> = {
  newest: { label: '登録順', icon: Clock },
  monthly_cost: { label: '支払額が安い順', icon: Wallet },
  area: { label: '広い順', icon: Ruler },
  year: { label: '新しい順', icon: History },
  station: { label: '駅に近い順', icon: Train },
  status: { label: 'ステータス順', icon: Layers },
};

// Helper to calculate mortgage
const calculateMonthlyPayment = (priceStr: string, rate: number, years: number, downPayment: number) => {
  const priceMatch = priceStr.replace(/,/g, '').match(/(\d+)/);
  if (!priceMatch) return 0;

  let price = parseInt(priceMatch[1]) * 10000;
  const loanAmount = Math.max(0, price - downPayment);

  if (loanAmount === 0) return 0;

  const monthlyRate = (rate / 100) / 12;
  const numberOfPayments = years * 12;

  if (monthlyRate === 0) return Math.round(loanAmount / numberOfPayments);

  return Math.round(
    loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numberOfPayments)) /
    (Math.pow(1 + monthlyRate, numberOfPayments) - 1)
  );
};

const getAge = (year?: number) => year ? new Date().getFullYear() - year : null;

export default function Page() {
  const [url, setUrl] = useState('');
  const { data: properties = [], error: fetchError } = useSWR<PropertyWithId[]>('/api/properties', fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
  });

  const { data: settings, mutate: mutateSettings } = useSWR<UserSettings>('/api/settings', fetcher);

  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [showExcluded, setShowExcluded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'users' | 'loan'>('users');

  // Selection for comparison
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showCompareModal, setShowCompareModal] = useState(false);

  const [cardUserSelections, setCardUserSelections] = useState<Record<string, string>>({});
  const [activeEmojiPickerUserId, setActiveEmojiPickerUserId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<PropertyWithId>>({});
  const pickerRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(false);
  const isComposing = useRef(false);

  useEffect(() => {
    setMounted(true);
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setActiveEmojiPickerUserId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);


  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', id }),
      });
      if (res.ok) mutate('/api/properties');
    } catch (err) {
      console.error("Refresh failed", err);
    } finally {
      setRefreshingId(null);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch data');
      mutate('/api/properties');
      setUrl('');
    } catch (err: any) {
      setError(err.message || 'Error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleRate = async (id: string, userId: string, score: 'good' | 'bad' | null, comment: string) => {
    await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rate', id, userId, rating: { score, comment } })
    });
    mutate('/api/properties');
  };

  const handleCommentUpdate = async (id: string, userId: string, comment: string) => {
    const property = properties.find(p => p.id === id);
    if (!property) return;
    const rating = property.ratings.find(r => r.userId === userId);
    handleRate(id, userId, rating ? rating.score : null, comment);
  };

  const handleStatusUpdate = async (id: string, status: PropertyStatus) => {
    console.log(`[UI] Updating status: id=${id}, status=${status}`);
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'status', id, status }),
      });
      if (res.ok) {
        console.log(`[UI] Status update success: ${id}`);
        mutate('/api/properties');
      } else {
        const errorData = await res.json();
        console.error(`[UI] Status update failed:`, errorData);
        setError(`ステータスの更新に失敗しました: ${errorData.error}`);
      }
    } catch (err) {
      console.error(`[UI] Status update error:`, err);
      setError('ステータスの更新中にエラーが発生しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当にこの物件を削除しますか？')) return;
    await fetch(`/api/properties?id=${id}`, { method: 'DELETE' });
    mutate('/api/properties');
  };

  const handleUpdateProperty = async (id: string, updates: Partial<PropertyWithId>) => {
    try {
      const res = await fetch('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id, updates }),
      });
      if (res.ok) {
        mutate('/api/properties');
        setEditingId(null);
      }
    } catch (err) {
      console.error("Update failed", err);
    }
  };

  const updateSettings = async (updates: Partial<UserSettings>) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    mutateSettings();
  };

  const handleAddUser = () => {
    if (!settings) return;
    updateSettings({
      users: [...settings.users, { id: crypto.randomUUID(), name: `User ${settings.users.length + 1}`, icon: '👤' }]
    });
  };

  const handleDeleteUser = (id: string) => {
    if (!settings || settings.users.length <= 1) return;
    if (!confirm('本当に削除しますか？')) return;
    updateSettings({ users: settings.users.filter(u => u.id !== id) });
  };

  const handleUserUpdate = (id: string, updates: Partial<UserConfig>) => {
    if (!settings) return;
    updateSettings({ users: settings.users.map(u => u.id === id ? { ...u, ...updates } : u) });
  };

  const handleLoanUpdate = (field: keyof UserSettings['loan'], value: number) => {
    if (!settings) return;
    updateSettings({ loan: { ...settings.loan, [field]: value } });
  };

  const toggleSelectProperty = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const sortedProperties = useMemo(() => {
    return [...properties].sort((a, b) => {
      switch (sortKey) {
        case 'monthly_cost': {
          const m1 = calculateMonthlyPayment(a.price, settings?.loan.interestRate || 0.5, settings?.loan.termYears || 35, settings?.loan.downPayment || 0) + (a.fees?.management || 0) + (a.fees?.repair || 0);
          const m2 = calculateMonthlyPayment(b.price, settings?.loan.interestRate || 0.5, settings?.loan.termYears || 35, settings?.loan.downPayment || 0) + (b.fees?.management || 0) + (b.fees?.repair || 0);
          return m1 - m2;
        }
        case 'area':
          return (b.area || 0) - (a.area || 0);
        case 'year':
          return (b.yearBuilt || 0) - (a.yearBuilt || 0);
        case 'station':
          return (a.stationMinute || 999) - (b.stationMinute || 999);
        case 'status':
          const orderA = STATUS_ORDER[a.status || 'considering'];
          const orderB = STATUS_ORDER[b.status || 'considering'];
          if (orderA !== orderB) return orderA - orderB;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'newest':
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
  }, [properties, sortKey, settings]);

  const selectedProperties = useMemo(() => properties.filter(p => selectedIds.includes(p.id)), [properties, selectedIds]);

  if (!mounted) return null;

  return (
    <main className="min-h-screen p-8 pb-32 font-sans text-slate-200">
      <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-[20%] right-[-10%] w-[30%] h-[50%] bg-blue-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSettings(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-6 max-h-[90vh] flex flex-col">
              <div className="flex items-center gap-4 mb-6 border-b border-white/10 pb-2">
                <button onClick={() => setSettingsTab('users')} className={`pb-2 text-sm font-bold transition-all ${settingsTab === 'users' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>ユーザー設定</button>
                <button onClick={() => setSettingsTab('loan')} className={`pb-2 text-sm font-bold transition-all ${settingsTab === 'loan' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>ローン・計算設定</button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2">
                {settingsTab === 'users' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-500 font-bold uppercase">Contributors</span>
                      <button onClick={handleAddUser} className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-400/20 rounded-lg text-xs font-bold transition-all">
                        <Plus className="w-3.5 h-3.5" /> 追加
                      </button>
                    </div>
                    {settings?.users.map((u) => (
                      <div key={u.id} className="p-4 bg-white/5 border border-white/10 rounded-xl flex items-center gap-4">
                        <div className="relative">
                          <button onClick={() => setActiveEmojiPickerUserId(activeEmojiPickerUserId === u.id ? null : u.id)} className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center text-xl border border-white/5">{u.icon}</button>
                          {activeEmojiPickerUserId === u.id && (
                            <div ref={pickerRef} className="absolute top-12 left-0 z-[110] shadow-2xl">
                              <EmojiPicker onEmojiClick={(data) => { handleUserUpdate(u.id, { icon: data.emoji }); setActiveEmojiPickerUserId(null); }} theme={Theme.DARK} width={280} height={350} />
                            </div>
                          )}
                        </div>
                        <input
                          key={`${u.id}`}
                          type="text"
                          defaultValue={u.name}
                          onCompositionStart={() => { isComposing.current = true; }}
                          onCompositionEnd={(e) => {
                            isComposing.current = false;
                            handleUserUpdate(u.id, { name: (e.target as HTMLInputElement).value });
                          }}
                          onBlur={(e) => {
                            handleUserUpdate(u.id, { name: e.target.value });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isComposing.current) {
                              handleUserUpdate(u.id, { name: (e.target as HTMLInputElement).value });
                            }
                          }}
                          className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                        />
                        <button onClick={() => handleDeleteUser(u.id)} disabled={settings.users.length <= 1} className="p-2 text-slate-500 hover:text-red-400 disabled:opacity-0"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><Percent className="w-3.5 h-3.5" /> 想定金利 (%)</label>
                      <input type="number" step="0.01" value={settings?.loan.interestRate} onChange={(e) => handleLoanUpdate('interestRate', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><Clock className="w-3.5 h-3.5" /> 借入期間 (年)</label>
                      <input type="number" value={settings?.loan.termYears} onChange={(e) => handleLoanUpdate('termYears', parseInt(e.target.value))} className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><Wallet className="w-3.5 h-3.5" /> 頭金 (円)</label>
                      <input type="number" step="100000" value={settings?.loan.downPayment} onChange={(e) => handleLoanUpdate('downPayment', parseInt(e.target.value))} className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                      <p className="text-[10px] text-slate-500 text-right">現在の頭金: {(settings?.loan.downPayment || 0).toLocaleString()}円</p>
                    </div>
                  </div>
                )}
              </div>

              <button onClick={() => setShowSettings(false)} className="w-full mt-6 bg-white hover:bg-slate-200 text-black font-bold py-3 rounded-xl transition-all">完了</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Comparison Modal */}
      <AnimatePresence>
        {showCompareModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCompareModal(false)} className="absolute inset-0 bg-black/80 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 40 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 40 }} className="relative w-full max-w-7xl bg-slate-900 border border-white/10 rounded-3xl shadow-3xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/50 sticky top-0 z-10">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3"><ArrowRightLeft className="w-6 h-6 text-blue-400" /> 物件を比較 ({selectedProperties.length}件)</h2>
                <button onClick={() => setShowCompareModal(false)} className="p-2 hover:bg-white/10 rounded-full transition-all"><X className="w-6 h-6" /></button>
              </div>

              <div className="flex-1 overflow-auto p-6">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/10 text-left min-w-[140px]">項目</th>
                      {selectedProperties.map(p => (
                        <th key={p.id} className="p-4 border-b border-white/10 min-w-[280px] align-top">
                          <div className="space-y-3">
                            <div className="aspect-video rounded-xl overflow-hidden border border-white/10">
                              <img src={p.images?.[0]} alt="" className="w-full h-full object-cover" />
                            </div>
                            <div className="text-left">
                              <div className="text-xs font-bold text-blue-400 mb-1">{STATUS_LABELS[p.status || 'considering'].label}</div>
                              <div className="text-sm font-bold text-white leading-tight line-clamp-2">{p.title}</div>
                            </div>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {/* Price Section */}
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">価格</td>
                      {selectedProperties.map(p => (
                        <td key={p.id} className="p-4 border-b border-white/5 font-mono text-lg text-white font-bold">{p.price}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">月々の合計 (目安)</td>
                      {selectedProperties.map(p => {
                        const mortgage = calculateMonthlyPayment(p.price, settings?.loan.interestRate || 0.5, settings?.loan.termYears || 35, settings?.loan.downPayment || 0);
                        const total = mortgage + (p.fees?.management || 0) + (p.fees?.repair || 0);
                        return (
                          <td key={p.id} className="p-4 border-b border-white/5">
                            <div className="text-blue-400 font-bold text-lg">¥{total.toLocaleString()}</div>
                            <div className="text-[10px] text-slate-500">ローン: {mortgage.toLocaleString()} + 管理・修繕: {((p.fees?.management || 0) + (p.fees?.repair || 0)).toLocaleString()}</div>
                          </td>
                        );
                      })}
                    </tr>

                    {/* Specs Section */}
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">専有面積</td>
                      {selectedProperties.map(p => (
                        <td key={p.id} className="p-4 border-b border-white/5">{p.area ? `${p.area}m²` : '-'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">駅徒歩</td>
                      {selectedProperties.map(p => (
                        <td key={p.id} className="p-4 border-b border-white/5">{p.stationMinute ? `${p.station} 徒歩${p.stationMinute}分` : (p.station || '-')}</td>
                      ))}
                    </tr>
                    <tr>
                      {selectedProperties.map(p => {
                        const age = getAge(p.yearBuilt);
                        return (
                          <td key={p.id} className="p-4 border-b border-white/5">{p.yearBuilt ? `${p.yearBuilt}年` : '-'} {age && <span className="text-[10px] opacity-60">(築{age}年)</span>}</td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">総戸数</td>
                      {selectedProperties.map(p => (
                        <td key={p.id} className="p-4 border-b border-white/5">{p.units ? `${p.units}戸` : '-'}</td>
                      ))}
                    </tr>
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">リノベーション</td>
                      {selectedProperties.map(p => (
                        <td key={p.id} className="p-4 border-b border-white/5">
                          {p.renovated ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/20 text-amber-400 text-xs font-bold">
                              <Sparkles className="w-3.5 h-3.5" /> あり
                            </span>
                          ) : '-'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/5 font-bold text-slate-400">駐車場</td>
                      {selectedProperties.map(p => (
                        <td key={p.id} className="p-4 border-b border-white/5">
                          <div className="text-xs">{p.parkingStatus || '-'}</div>
                          {p.fees?.parking && <div className="text-[10px] text-slate-500 font-mono">¥{p.fees.parking.toLocaleString()}/月</div>}
                        </td>
                      ))}
                    </tr>

                    {/* User Ratings Section */}
                    {settings?.users.map(user => (
                      <tr key={user.id}>
                        <td className="sticky left-0 z-20 bg-slate-900 p-4 border-b border-white/10 font-bold text-slate-400">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{user.icon}</span>
                            <span className="truncate max-w-[80px]">{user.name}</span>
                          </div>
                        </td>
                        {selectedProperties.map(p => {
                          const rating = p.ratings.find(r => r.userId === user.id);
                          return (
                            <td key={p.id} className="p-4 border-b border-white/10 align-top">
                              <div className="space-y-2">
                                {rating?.score && (
                                  <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold ${rating.score === 'good' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {rating.score === 'good' ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}
                                    {rating.score === 'good' ? '高評価' : '低評価'}
                                  </div>
                                )}
                                <p className={`text-xs text-slate-300 italic ${!rating?.comment ? 'opacity-30' : ''}`}>
                                  {rating?.comment || '未コメント'}
                                </p>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-6 bg-white/5 border-t border-white/10 flex justify-end gap-4">
                <button onClick={() => { setSelectedIds([]); setShowCompareModal(false); }} className="px-6 py-2 text-slate-400 hover:text-white transition-all text-sm font-bold">選択リセット</button>
                <button onClick={() => setShowCompareModal(false)} className="px-8 py-2.5 bg-white text-black rounded-xl font-bold hover:bg-slate-200 transition-all">閉じる</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <header className="mb-12 flex flex-col md:flex-row items-center justify-between max-w-7xl mx-auto gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-500/20 rounded-xl border border-blue-400/20 shadow-lg shadow-blue-500/10"><Home className="w-6 h-6 text-blue-400" /></div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Kaoune</h1>
        </div>
        <div className="flex bg-slate-800/50 p-1 rounded-xl border border-white/5 backdrop-blur-sm gap-4 items-center px-4 h-12">
          {/* Sort Selector */}
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-slate-500 rotate-90" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-transparent text-xs font-bold text-slate-300 outline-none border-none cursor-pointer hover:text-white transition-colors"
            >
              {Object.entries(SORT_OPTIONS).map(([key, { label }]) => (
                <option key={key} value={key} className="bg-slate-900 text-white">{label}</option>
              ))}
            </select>
          </div>

          <div className="w-px h-4 bg-white/10" />

          <div className="flex bg-slate-900/50 p-1 rounded-lg border border-white/5 gap-1">
            <button onClick={() => setShowExcluded(!showExcluded)} className={`p-1.5 rounded-md transition-all flex items-center gap-1.5 px-2 ${showExcluded ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{showExcluded ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}<span className="text-[10px] font-bold">選外</span></button>
            <div className="w-px h-3 bg-white/10 my-auto mx-0.5" />
            <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><LayoutGrid className="w-4 h-4" /></button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><List className="w-4 h-4" /></button>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all outline-none"><Settings className="w-5 h-5" /></button>
        </div>
      </header>

      <section className="max-w-2xl mx-auto mb-16 px-4">
        <form onSubmit={handleAdd} className="relative group max-w-xl mx-auto">
          <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition duration-700" />
          <div className="glass p-2 pl-6 rounded-full flex items-center gap-3 relative z-10 bg-black/40 border-white/10 ring-1 ring-white/5">
            <Search className="w-5 h-5 text-slate-500" />
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URLを貼り付け..." className="bg-transparent border-none focus:outline-none flex-1 py-3 text-base placeholder-slate-500 text-white" />
            <button type="submit" disabled={loading} className="bg-white hover:bg-slate-200 text-black px-6 py-3 rounded-full font-semibold transition-all hover:scale-105 disabled:opacity-50 min-w-[100px] flex justify-center">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '追加'}</button>
          </div>
          {error && <p className="text-red-400 mt-4 text-center text-sm bg-red-500/10 border border-red-500/20 p-2 rounded-lg">{error}</p>}
        </form>
      </section>

      <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto px-4" : "flex flex-col gap-4 max-w-4xl mx-auto px-4"}>
        <AnimatePresence mode="popLayout">
          {sortedProperties.filter(p => showExcluded || p.status !== 'excluded').map((prop) => {
            const age = getAge(prop.yearBuilt);
            const isOldBuilding = prop.yearBuilt && prop.yearBuilt <= 1981;
            const isSmallArea = prop.area && prop.area < 50;
            const isLeasehold = prop.isFreehold === false;
            const isNoParking = ((prop.parkingStatus?.includes('無') && !prop.parkingStatus?.includes('無料')) || prop.parkingStatus?.includes('なし') || (!prop.parkingStatus && !prop.fees?.parking)) && !prop.parkingStatus?.includes('空有') && !prop.parkingStatus?.includes('空きあり');

            const hasWarnings = isOldBuilding || isSmallArea || isLeasehold || isNoParking;
            const activeUserId = cardUserSelections[prop.id] || (settings?.users[0]?.id || null);
            const activeUser = settings?.users.find(u => u.id === activeUserId);
            const myRating = prop.ratings.find(r => r.userId === activeUserId);

            const isSelected = selectedIds.includes(prop.id);

            // Mortgage calculation
            const monthlyMortgage = settings ? calculateMonthlyPayment(prop.price, settings.loan.interestRate, settings.loan.termYears, settings.loan.downPayment) : 0;
            const totalMonthly = monthlyMortgage + (prop.fees?.management || 0) + (prop.fees?.repair || 0);

            return (
              <motion.div key={prop.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={`glass-card flex group relative overflow-hidden p-0 bg-slate-900/40 border transition-all ${isSelected ? 'border-blue-500/50 shadow-2xl shadow-blue-500/10 ring-1 ring-blue-500/20' : 'border-white/5'} ${viewMode === 'list' ? 'flex-row h-auto min-h-[24rem]' : 'flex-col h-full'}`}>

                {/* Selection Overlay/Checkbox */}
                <button
                  onClick={() => toggleSelectProperty(prop.id)}
                  className={`absolute top-4 left-4 z-[40] w-6 h-6 rounded-md border flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-400 scale-110' : 'bg-black/40 border-white/20 hover:border-white/40 opacity-0 group-hover:opacity-100'}`}
                >
                  {isSelected && <Check className="w-4 h-4 text-white" />}
                </button>

                <div className={`relative bg-slate-800 overflow-hidden flex-shrink-0 cursor-pointer ${viewMode === 'list' ? 'w-72' : 'h-48 w-full'}`} onClick={() => toggleSelectProperty(prop.id)}>
                  {prop.images && prop.images[0] ? <img src={prop.images[0]} alt={prop.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : <div className="w-full h-full flex items-center justify-center text-slate-600"><Home className="w-12 h-12 opacity-20" /></div>}
                  <div className="absolute bottom-2 left-2 z-10">
                    <select value={prop.status || 'considering'} onClick={(e) => e.stopPropagation()} onChange={(e) => handleStatusUpdate(prop.id, e.target.value as PropertyStatus)} className={`text-[10px] font-bold px-2 py-1 rounded-md border-none outline-none appearance-none backdrop-blur-md shadow-lg transition-all ${STATUS_LABELS[prop.status || 'considering'].color}`}>
                      {Object.entries(STATUS_LABELS).map(([value, { label }]) => <option key={value} value={value} className="bg-slate-900 text-white">{label}</option>)}
                    </select>
                  </div>
                  <div className="absolute top-2 right-2 flex gap-2 transition-opacity opacity-0 group-hover:opacity-100 z-10" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => handleRefresh(prop.id)} disabled={refreshingId === prop.id} className="bg-black/50 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-sm disabled:opacity-50"><RefreshCcw className={`w-4 h-4 ${refreshingId === prop.id ? 'animate-spin' : ''}`} /></button>
                    <button onClick={() => {
                      setEditingId(prop.id);
                      setEditValues({
                        price: prop.price,
                        area: prop.area,
                        yearBuilt: prop.yearBuilt,
                        units: prop.units,
                        fees: { ...prop.fees },
                        station: prop.station,
                        stationMinute: prop.stationMinute,
                        parkingStatus: prop.parkingStatus
                      });
                    }} className="bg-black/50 hover:bg-yellow-600 text-white p-2 rounded-full backdrop-blur-sm"><Settings className="w-4 h-4" /></button>
                    <a href={prop.url} target="_blank" rel="noopener noreferrer" className="bg-black/50 hover:bg-blue-600 text-white p-2 rounded-full backdrop-blur-sm"><ExternalLink className="w-4 h-4" /></a>
                    <button onClick={() => handleDelete(prop.id)} className="bg-black/50 hover:bg-red-500/80 text-white p-2 rounded-full backdrop-blur-sm"><Trash2 className="w-4 h-4" /></button>
                  </div>
                  {hasWarnings && <div className="absolute top-2 left-2 bg-red-500/90 text-white text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg backdrop-blur-sm ml-8"><AlertTriangle className="w-3 h-3" /> 要確認</div>}
                </div>

                <div className="p-6 flex-1 flex flex-col">
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className="text-lg font-bold text-white leading-snug line-clamp-2 flex-1" title={prop.title}>{prop.title || 'Untitled'}</h3>
                      {prop.renovated && (
                        <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 text-[10px] font-bold border border-amber-500/20">
                          <Sparkles className="w-3 h-3" /> リノベ済
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 mb-4">
                      <div className="flex items-center gap-1">
                        <span className="text-2xl font-bold text-white">{prop.price}</span>
                        {prop.manuallyEditedFields?.includes('price') && <span className="text-[10px] text-yellow-500" title="手動入力済み">✏️</span>}
                      </div>
                      {totalMonthly > 0 && (
                        <div className="flex items-center gap-1 text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
                          <Wallet className="w-3.5 h-3.5" />
                          <span className="text-sm font-bold">月々 {(totalMonthly / 10000).toFixed(1)}万円〜</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {totalMonthly > 0 && prop.fees && (
                    <div className="mb-4 p-3 bg-white/5 border border-white/5 rounded-xl space-y-1.5 overflow-hidden">
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>住宅ローン (想定)</span>
                        <span className="font-mono text-slate-300">¥{(monthlyMortgage).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <div className="flex items-center gap-1">
                          <span>管理・修繕費</span>
                          {(prop.manuallyEditedFields?.includes('fees.management') || prop.manuallyEditedFields?.includes('fees.repair')) && <span className="text-[9px] text-yellow-500">✏️</span>}
                        </div>
                        <span className="font-mono text-slate-300">¥{((prop.fees.management || 0) + (prop.fees.repair || 0)).toLocaleString()}</span>
                      </div>
                      <div className="pt-1 mt-1 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">合計目安</span>
                        <span className="text-sm font-bold text-white font-mono">¥{totalMonthly.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">/月</span></span>
                      </div>
                    </div>
                  )}

                  {editingId === prop.id ? (
                    <div className="space-y-4 bg-white/5 p-4 rounded-2xl border border-white/10 mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">価格 (例: 5,480万円)</label>
                          <input type="text" value={editValues.price || ''} onChange={(e) => setEditValues(v => ({ ...v, price: e.target.value }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" placeholder="5,480万円" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">専有面積 (m²)</label>
                          <input type="number" step="0.01" min="0" value={editValues.area || ''} onChange={(e) => setEditValues(v => ({ ...v, area: parseFloat(e.target.value) || 0 }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">駅名</label>
                          <input type="text" value={editValues.station || ''} onChange={(e) => setEditValues(v => ({ ...v, station: e.target.value }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">駅徒歩 (分)</label>
                          <input type="number" min="0" value={editValues.stationMinute || ''} onChange={(e) => setEditValues(v => ({ ...v, stationMinute: parseInt(e.target.value) || 0 }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">築年 (西暦)</label>
                          <input type="number" min="1900" max={new Date().getFullYear()} value={editValues.yearBuilt || ''} onChange={(e) => setEditValues(v => ({ ...v, yearBuilt: parseInt(e.target.value) || 0 }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">管理費 (円)</label>
                          <input type="number" min="0" value={editValues.fees?.management || ''} onChange={(e) => setEditValues(v => ({ ...v, fees: { ...v.fees, management: parseInt(e.target.value) || 0 } }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">修繕費 (円)</label>
                          <input type="number" min="0" value={editValues.fees?.repair || ''} onChange={(e) => setEditValues(v => ({ ...v, fees: { ...v.fees, repair: parseInt(e.target.value) || 0 } }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">駐車場 (円)</label>
                          <input type="number" min="0" value={editValues.fees?.parking || ''} onChange={(e) => setEditValues(v => ({ ...v, fees: { ...v.fees, parking: parseInt(e.target.value) || 0 } }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">総戸数</label>
                          <input type="number" min="0" value={editValues.units || ''} onChange={(e) => setEditValues(v => ({ ...v, units: parseInt(e.target.value) || 0 }))} className="w-full bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:ring-1 focus:ring-blue-500/50 outline-none" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingId(null)} className="flex-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-xs font-bold transition-all border border-white/5">キャンセル</button>
                        <button onClick={() => handleUpdateProperty(prop.id, editValues)} className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-500/20">保存</button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                      <div className={`p-2 rounded-lg border flex items-center gap-2 ${prop.area && prop.area < 50 ? 'bg-red-500/20 border-red-500/50 text-red-200' : 'bg-white/5 border-white/5 text-slate-300'}`}>
                        <Ruler className="w-4 h-4 opacity-70 flex-shrink-0" />
                        <span className="truncate">{prop.area ? `${prop.area}m²` : '-'}</span>
                        {prop.manuallyEditedFields?.includes('area') && <span className="text-[10px] text-yellow-500 ml-auto">✏️</span>}
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-slate-300 flex items-center gap-2 min-w-0 overflow-hidden" title={`${prop.station || ''} ${prop.stationMinute ? `${prop.stationMinute}分` : ''}`}>
                        <Train className="w-4 h-4 opacity-70 flex-shrink-0" />
                        <div className="flex items-baseline gap-1 min-w-0 flex-1 overflow-hidden">
                          <span className="truncate text-[11px] md:text-xs">
                            {prop.station || '-'}
                          </span>
                          {prop.stationMinute && (
                            <span className="shrink-0 text-[10px] opacity-80 whitespace-nowrap">
                              {prop.stationMinute}分
                            </span>
                          )}
                        </div>
                        {(prop.manuallyEditedFields?.includes('station') || prop.manuallyEditedFields?.includes('stationMinute')) && <span className="text-[10px] text-yellow-500 ml-auto">✏️</span>}
                      </div>
                      <div className={`p-2 rounded-lg border flex items-center gap-2 overflow-hidden ${prop.yearBuilt && prop.yearBuilt <= 1981 ? 'bg-red-500/20 border-red-500/50 text-red-200' : 'bg-white/5 border-white/5 text-slate-300'}`}>
                        <History className="w-4 h-4 opacity-70 flex-shrink-0" />
                        <div className="flex items-baseline gap-1 min-w-0 flex-1 overflow-hidden">
                          <span className="text-[11px] md:text-xs font-mono">{prop.yearBuilt ? `${prop.yearBuilt}年` : '-'}</span>
                          {age && <span className="shrink-0 text-[9px] opacity-60">({age}y)</span>}
                        </div>
                        {prop.manuallyEditedFields?.includes('yearBuilt') && <span className="text-[10px] text-yellow-500 ml-auto">✏️</span>}
                      </div>
                      <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-slate-300 flex items-center gap-2 truncate whitespace-nowrap">
                        <Users className="w-4 h-4 opacity-70 flex-shrink-0" />
                        <span className="truncate">{prop.units ? `${prop.units}戸` : '-'}</span>
                        {prop.manuallyEditedFields?.includes('units') && <span className="text-[10px] text-yellow-500 ml-auto">✏️</span>}
                      </div>
                      <div className={`p-2 rounded-lg border flex items-center gap-2 truncate ${prop.isFreehold === false ? 'bg-red-500/20 border-red-500/50 text-red-200' : 'bg-white/5 border-white/5 text-slate-300'}`}>
                        <Building className="w-4 h-4 opacity-70" />{prop.isFreehold === false ? '借地' : '所有'}
                      </div>
                      <div className={`p-2 rounded-lg border flex items-center gap-2 truncate ${isNoParking ? 'bg-red-500/20 border-red-500/50 text-red-200' : 'bg-white/5 border-white/5 text-slate-300'}`} title={prop.parkingStatus || (prop.fees?.parking ? `¥${prop.fees.parking.toLocaleString()}` : '-')}>
                        <Car className="w-4 h-4 opacity-70 flex-shrink-0" />
                        <span className="truncate text-[11px] md:text-xs">{prop.parkingStatus || (prop.fees?.parking ? `¥${(prop.fees.parking / 1000).toFixed(0)}k` : '-')}</span>
                        {prop.manuallyEditedFields?.includes('fees.parking') && <span className="text-[10px] text-yellow-500 ml-auto">✏️</span>}
                      </div>
                    </div>
                  )}

                  <div className="mt-auto space-y-4">
                    <div className="space-y-3 max-h-40 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-white/10">
                      {prop.ratings.map((rating) => {
                        const rUser = settings?.users.find(u => u.id === rating.userId);
                        if (!rUser && !rating.comment) return null;
                        return (
                          <div key={rating.userId} className="flex items-start gap-2.5">
                            <div className="text-lg bg-white/5 w-8 h-8 rounded-lg flex items-center justify-center border border-white/5 shrink-0">{rUser?.icon || '👤'}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-bold text-slate-400 truncate">{rUser?.name || '不明'}</span>
                                {rating.score && <span className={`p-1 rounded-md ${rating.score === 'good' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{rating.score === 'good' ? <ThumbsUp className="w-3 h-3" /> : <ThumbsDown className="w-3 h-3" />}</span>}
                              </div>
                              {rating.comment && <p className="text-xs text-slate-300 bg-white/5 p-2 rounded-lg border border-white/5 line-clamp-3">{rating.comment}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-4 border-t border-white/5 bg-blue-500/5 -mx-6 px-6 -mb-6 pb-6 mt-2 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-white/5 overflow-x-auto no-scrollbar max-w-[160px]">
                          {settings?.users.map(u => (
                            <button key={u.id} onClick={() => setCardUserSelections(prev => ({ ...prev, [prop.id]: u.id }))} className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-all ${activeUserId === u.id ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>{u.icon}</button>
                          ))}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => activeUserId && handleRate(prop.id, activeUserId, myRating?.score === 'good' ? null : 'good', myRating?.comment || '')} className={`p-1.5 rounded-md transition-all ${myRating?.score === 'good' ? 'bg-green-500/20 text-green-400 ring-1 ring-green-500/50' : 'text-slate-600 hover:bg-white/10'}`}><ThumbsUp className="w-4 h-4" /></button>
                          <button onClick={() => activeUserId && handleRate(prop.id, activeUserId, myRating?.score === 'bad' ? null : 'bad', myRating?.comment || '')} className={`p-1.5 rounded-md transition-all ${myRating?.score === 'bad' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/50' : 'text-slate-600 hover:bg-white/10'}`}><ThumbsDown className="w-4 h-4" /></button>
                        </div>
                      </div>
                      <div className="relative">
                        <div className="relative">
                          <input
                            key={`${prop.id}-${activeUserId}`}
                            type="text"
                            placeholder={`${activeUser?.name || '誰か'}としてコメント...`}
                            defaultValue={myRating?.comment || ''}
                            onCompositionStart={() => { isComposing.current = true; }}
                            onCompositionEnd={(e) => {
                              isComposing.current = false;
                              if (activeUserId) {
                                handleCommentUpdate(prop.id, activeUserId, (e.target as HTMLInputElement).value);
                              }
                            }}
                            onBlur={(e) => {
                              if (activeUserId) {
                                handleCommentUpdate(prop.id, activeUserId, e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !isComposing.current && activeUserId) {
                                handleCommentUpdate(prop.id, activeUserId, (e.target as HTMLInputElement).value);
                              }
                            }}
                            className="w-full bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 transition-all pl-10"
                          />
                          <div className="absolute left-3 top-2.5 text-sm opacity-50">{activeUser?.icon || '👤'}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence >
      </div >

      {/* Floating Comparison Toolbar */}
      <AnimatePresence>
        {
          selectedIds.length > 0 && (
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }} className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4">
              <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 p-4 rounded-3xl shadow-2xl flex items-center justify-between gap-4 ring-4 ring-black/40">
                <div className="flex items-center gap-3 ml-2">
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg shadow-blue-500/30">
                    {selectedIds.length}
                  </div>
                  <div className="text-sm font-bold text-white">物件を選択中</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedIds([])} className="p-3 text-slate-400 hover:text-white transition-all"><Trash2 className="w-5 h-5" /></button>
                  <button
                    onClick={() => setShowCompareModal(true)}
                    disabled={selectedIds.length < 2}
                    className={`px-6 py-2.5 rounded-2xl font-bold flex items-center gap-2 transition-all ${selectedIds.length >= 2 ? 'bg-white text-black hover:scale-105 active:scale-95' : 'bg-white/10 text-slate-500 cursor-not-allowed'}`}
                  >
                    <ArrowRightLeft className="w-4 h-4" /> 比較する
                  </button>
                </div>
              </div>
            </motion.div>
          )
        }
      </AnimatePresence >
    </main >
  );
}
