import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Users, Eye, Zap, Activity, Settings as SettingsIcon, 
  Shield, Menu, X, Key, MessageSquare, Clock, Heart, Search, RefreshCw, 
  Play, Pause, Trash2, AlertTriangle, CheckCircle2, Power, Terminal, Sliders, Check, ExternalLink, Send, Plus,
  ShieldCheck, Sparkles
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { LearningPerformanceView } from '../LearningPerformanceView';
import { AdminUserNotificationSection } from './AdminUserNotificationSection';

// ----------------------------------------------------
// Toast Component
// ----------------------------------------------------
const Toast = ({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center gap-2.5 shadow-2xl animate-fade-in">
      <div className={`p-1 rounded-full ${type === 'success' ? 'bg-zinc-800 text-zinc-200' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
        {type === 'success' ? <Check className="w-4 h-4 stroke-[2.5]" /> : <AlertTriangle className="w-4 h-4" />}
      </div>
      <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{message}</span>
      <button onClick={onClose} className="ml-2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-white transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ----------------------------------------------------
// 1. Dashboard Subpage
// ----------------------------------------------------
const DashboardPage = ({ fetchWithAuth }: { fetchWithAuth: any }) => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/stats');
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Admin stats: Received non-JSON response:", text);
        throw new Error(`Server returned non-JSON response: ${text.substring(0, 50)}...`);
      }
      
      const json = await res.json();
      if (json.success) {
        setStats(json.stats);
        setError(null);
      } else {
        setError(json.error || "Failed to load statistics.");
      }
    } catch (err: any) {
      setError(err.message || "Network error fetching statistics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const statCards = [
    { label: "Total Active Watchers", value: stats?.activeWatchers || 0, desc: "Scanners actively running in background", icon: Eye, color: "text-zinc-900 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700" },
    { label: "Total Pairs Being Monitored", value: stats?.totalPairsMonitored || 0, desc: "Unique currency and crypto trading pairs", icon: Activity, color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    { label: "Total Signals Sent", value: stats?.totalSignalsSent || 0, desc: "Total alerts processed historically", icon: Zap, color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
    { label: "Last Scan Time", value: stats?.lastCronRun ? new Date(stats.lastCronRun).toLocaleTimeString() : "Never", desc: stats?.lastCronRun ? new Date(stats.lastCronRun).toLocaleDateString() : "No scan executed yet", icon: Clock, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { label: "Total Registered Users", value: stats?.totalUsers || 0, desc: "Users in profiles database", icon: Users, color: "text-zinc-400 bg-zinc-800/10 border-zinc-800/20" },
    { label: "Telegram Connected Users", value: stats?.telegramConnected || 0, desc: "Profiles with push alerts active", icon: MessageSquare, color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header section */}
      <div className="flex justify-between items-center pb-2 border-b border-zinc-200 dark:border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-zinc-950 dark:text-white font-display">Overview Stats</h3>
          <p className="text-xs text-zinc-500">Real-time statistics fetched from Supabase using Service Role privilege</p>
        </div>
        <button onClick={fetchStats} className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer" title="Refresh Stats">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          [1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-zinc-50 dark:bg-zinc-950 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-900 animate-pulse space-y-3">
              <div className="flex justify-between items-start">
                <div className="space-y-2">
                  <div className="h-3 w-28 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                  <div className="h-8 w-20 bg-zinc-200 dark:bg-zinc-800 rounded"></div>
                </div>
                <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>
              </div>
              <div className="h-2.5 w-36 bg-zinc-100 dark:bg-zinc-900 rounded"></div>
            </div>
          ))
        ) : (
          statCards.map((card, i) => (
            <div key={i} className={`bg-zinc-50 dark:bg-zinc-950 p-5 rounded-2xl border flex flex-col justify-between shadow-sm dark:shadow-lg relative overflow-hidden transition-all hover:scale-[1.01] ${card.color.split(' ')[2]}`}>
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{card.label}</span>
                  <p className="text-3xl font-extrabold text-zinc-950 dark:text-white mt-1.5 font-display">{card.value}</p>
                </div>
                <div className={`p-2.5 rounded-xl ${card.color.split(' ')[1]} ${card.color.split(' ')[0]}`}>
                  <card.icon className="w-5 h-5 stroke-[1.8]" />
                </div>
              </div>
              <span className="text-[10px] text-zinc-500 mt-4">{card.desc}</span>
            </div>
          ))
        )}
      </div>

      {/* Auxiliary Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div className="bg-zinc-50 dark:bg-zinc-950 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-900/80">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-500 dark:text-sky-400" /> Cron Status
          </h4>
          <div className="space-y-3.5">
            <div className="flex justify-between items-center py-2 border-b border-zinc-200 dark:border-zinc-900/60">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">System Status</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700">OPERATIONAL</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-200 dark:border-zinc-900/60">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Last Scanner Run</span>
              <span className="text-xs font-mono text-zinc-800 dark:text-zinc-200">{stats?.lastCronRun ? new Date(stats.lastCronRun).toLocaleString() : "None"}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Server Host Ingress</span>
              <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500">Port 3000 / Cloud Run</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-950 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-900/80">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-4 flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-500" /> Administrative Info
          </h4>
          <div className="space-y-3.5">
            <div className="flex justify-between items-center py-2 border-b border-zinc-200 dark:border-zinc-900/60">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Primary Database</span>
              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Supabase (PostgreSQL)</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-200 dark:border-zinc-900/60">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Authorized Admin</span>
              <span className="text-xs font-mono text-sky-600 dark:text-sky-400 font-semibold">gaks6535@gmail.com</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Active API Key Mode</span>
              <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500">Server proxy via /api/*</span>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Send Test Notification card */}
      <div className="mt-6">
        <SendTestNotificationCard fetchWithAuth={fetchWithAuth} />
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 1b. Send Test Notification Card Component
// ----------------------------------------------------
const SendTestNotificationCard = ({ fetchWithAuth }: { fetchWithAuth: any }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  
  const [targetType, setTargetType] = useState<'list' | 'email' | 'telegram'>('list');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [emailQuery, setEmailQuery] = useState('');
  const [telegramQuery, setTelegramQuery] = useState('');
  
  const [symbol, setSymbol] = useState('BTCUSD');
  const [timeframe, setTimeframe] = useState('1H');
  
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const fetchUsersList = async () => {
      setUsersLoading(true);
      try {
        const res = await fetchWithAuth('/api/admin/users');
        const json = await res.json();
        if (json.success) {
          setUsers(json.users || []);
        }
      } catch (err) {
        console.error("Error loading users for selector:", err);
      } finally {
        setUsersLoading(false);
      }
    };
    fetchUsersList();
  }, []);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setStatus(null);

    const payload: any = {
      symbol: symbol || "BTCUSD",
      timeframe: timeframe || "1H"
    };

    if (targetType === 'list') {
      if (!selectedUserId) {
        setStatus({ type: 'error', message: 'Please select a registered user.' });
        setSending(false);
        return;
      }
      payload.userId = selectedUserId;
    } else if (targetType === 'email') {
      if (!emailQuery.trim()) {
        setStatus({ type: 'error', message: 'Please enter an email address to search.' });
        setSending(false);
        return;
      }
      payload.email = emailQuery.trim();
    } else if (targetType === 'telegram') {
      if (!telegramQuery.trim()) {
        setStatus({ type: 'error', message: 'Please enter a Telegram username to search.' });
        setSending(false);
        return;
      }
      payload.telegramUsername = telegramQuery.trim();
    }

    try {
      const response = await fetchWithAuth('/api/admin/send-test-alert', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) {
        setStatus({
          type: 'success',
          message: `Test alert successfully delivered to Telegram chat for user: ${data.user}`
        });
      } else {
        setStatus({
          type: 'error',
          message: data.error || 'Failed to send test alert.'
        });
      }
    } catch (err: any) {
      setStatus({
        type: 'error',
        message: err.message || 'Network error encountered during send.'
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-900/80 shadow-sm dark:shadow-none">
      <div className="flex items-center gap-2 mb-2">
        <Send className="w-4.5 h-4.5 text-sky-600 dark:text-sky-400" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-950 dark:text-zinc-400 font-display">
          Send Test Notification
        </h4>
      </div>
      <p className="text-[11px] text-zinc-500 mb-5 leading-relaxed">
        Send a simulated market signal to any connected user to verify Telegram delivery.
      </p>

      <form onSubmit={handleSendTest} className="space-y-4">
        {/* Target selection tabs */}
        <div className="grid grid-cols-3 gap-1 p-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-[10px]">
          <button
            type="button"
            onClick={() => { setTargetType('list'); setStatus(null); }}
            className={`py-1.5 rounded-lg font-bold uppercase transition-all cursor-pointer ${targetType === 'list' ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
          >
            User List
          </button>
          <button
            type="button"
            onClick={() => { setTargetType('email'); setStatus(null); }}
            className={`py-1.5 rounded-lg font-bold uppercase transition-all cursor-pointer ${targetType === 'email' ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
          >
            Email
          </button>
          <button
            type="button"
            onClick={() => { setTargetType('telegram'); setStatus(null); }}
            className={`py-1.5 rounded-lg font-bold uppercase transition-all cursor-pointer ${targetType === 'telegram' ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
          >
            Telegram
          </button>
        </div>

        {/* Dynamic target input */}
        <div>
          {targetType === 'list' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Select Registered User</label>
              {usersLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                  <RefreshCw className="w-3 h-3 animate-spin text-sky-500" /> Loading users list...
                </div>
              ) : (
                <select
                  value={selectedUserId}
                  onChange={(e) => { setSelectedUserId(e.target.value); setStatus(null); }}
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-950 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                >
                  <option value="">-- Choose registered user --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || 'No Name'} ({u.email})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {targetType === 'email' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Search by User Email</label>
              <input
                type="email"
                placeholder="user@example.com"
                value={emailQuery}
                onChange={(e) => { setEmailQuery(e.target.value); setStatus(null); }}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-950 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          )}

          {targetType === 'telegram' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Search by Telegram Username</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-zinc-500 text-xs font-semibold">@</span>
                <input
                  type="text"
                  placeholder="username"
                  value={telegramQuery}
                  onChange={(e) => { setTelegramQuery(e.target.value); setStatus(null); }}
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-950 dark:text-white rounded-xl pl-7 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Optional fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Symbol (Optional)</label>
            <input
              type="text"
              placeholder="BTCUSD"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-950 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Timeframe (Optional)</label>
            <input
              type="text"
              placeholder="1H"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-950 dark:text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div className={`p-3 rounded-xl text-xs flex items-start gap-2.5 border ${
            status.type === 'success' 
              ? 'bg-zinc-800 border-zinc-700 text-zinc-200' 
              : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
          }`}>
            {status.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{status.message}</span>
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={sending}
          className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-sky-500/50 text-black font-extrabold text-xs uppercase tracking-wider py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 mt-2 shadow-sm"
        >
          {sending ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Sending Test Alert...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Send Test Alert
            </>
          )}
        </button>
      </form>
    </div>
  );
};


// ----------------------------------------------------
// 2. Users Subpage
// ----------------------------------------------------
const UsersPage = ({ fetchWithAuth, showToast }: { fetchWithAuth: any; showToast: any }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiStatusFilter, setAiStatusFilter] = useState('ALL');
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
    setCurrentPage(1);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/users');
      const json = await res.json();
      if (json.success) {
        setUsers(json.users);
        setError(null);
      } else {
        setError(json.error || "Failed to load users list.");
      }
    } catch (err: any) {
      setError(err.message || "Network error fetching users.");
    } finally {
      setLoading(false);
    }
  };

  const handleUserAction = async (userId: string, action: 'pause' | 'resume' | 'delete') => {
    if (action === 'delete' && !window.confirm("Are you absolutely sure you want to STOP and DELETE this user's active watcher? This cannot be undone.")) {
      return;
    }

    setActionLoading(userId);
    try {
      const res = await fetchWithAuth('/api/admin/users/action', {
        method: 'POST',
        body: JSON.stringify({ userId, action })
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message || `Action ${action} executed successfully!`, 'success');
        // Refresh local list
        fetchUsers();
        if (selectedUser && selectedUser.id === userId) {
          setSelectedUser((prev: any) => ({ ...prev, watcher_status: action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped' }));
        }
      } else {
        showToast(json.error || "Failed executing user action.", 'error');
      }
    } catch (err: any) {
      showToast(err.message || "Action request failed.", 'error');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.id?.includes(searchQuery);

    if (aiStatusFilter === 'ALL') return matchesSearch;
    const uStatus = user.gemini_status || 'READY';
    return matchesSearch && uStatus === aiStatusFilter;
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let valA = a[sortField] || '';
    let valB = b[sortField] || '';
    
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedUsers.length / itemsPerPage);
  const currentUsers = sortedUsers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-200 dark:border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-zinc-950 dark:text-white font-display">User Accounts</h3>
          <p className="text-xs text-zinc-500">Audit registered users, check integration status, or manage their market scanners.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select 
            value={aiStatusFilter}
            onChange={e => setAiStatusFilter(e.target.value)}
            className="bg-white dark:bg-zinc-950 text-xs text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-800 cursor-pointer"
          >
            <option value="ALL">All AI Statuses</option>
            <option value="READY">READY</option>
            <option value="NEEDS_ATTENTION">NEEDS_ATTENTION</option>
            <option value="INVALID_KEY">INVALID_KEY</option>
            <option value="QUOTA_EXHAUSTED">QUOTA_EXHAUSTED</option>
            <option value="BILLING_REQUIRED">BILLING_REQUIRED</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 dark:text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search by email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-white dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-900 rounded-xl pl-9 pr-4 py-2 w-48 sm:w-64 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-800"
            />
          </div>
          <button onClick={fetchUsers} className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer" title="Refresh Users">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <span className="text-xs font-semibold">Fetching Gaks AI registered user profiles...</span>
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="p-12 text-center text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-900 rounded-2xl bg-zinc-50 dark:bg-zinc-950/20">
          <Search className="w-8 h-8 mx-auto mb-2 text-zinc-300 dark:text-zinc-700" />
          <p className="text-xs font-semibold">No users found matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-2xl overflow-hidden shadow-sm dark:shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 dark:bg-zinc-950/50">
                  <th className="py-4 px-5 cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-300" onClick={() => handleSort('email')}>User Profile / ID</th>
                  <th className="py-4 px-5 text-center">Integrations</th>
                  <th className="py-4 px-5 text-center cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-300" onClick={() => handleSort('gemini_status')}>AI Status</th>
                  <th className="py-4 px-5 text-center cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-300" onClick={() => handleSort('watcher_status')}>Watcher Status</th>
                  <th className="py-4 px-5">Selected Setup</th>
                  <th className="py-4 px-5 cursor-pointer hover:text-zinc-950 dark:hover:text-zinc-300" onClick={() => handleSort('created_at')}>Joined</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentUsers.map(user => (
                  <tr key={user.id} className="border-b border-zinc-200 dark:border-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-900/30 transition-colors">
                    <td className="py-4 px-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{user.email}</span>
                        <span className="text-[10px] font-mono text-zinc-500 mt-1">{user.full_name || "No name set"}</span>
                        <span className="text-[9px] text-zinc-400 dark:text-zinc-600 font-mono mt-0.5">{user.id}</span>
                      </div>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex justify-center items-center gap-3">
                        <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${user.telegram_connected ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/10' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-900'}`}>
                          TG
                        </span>
                        <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${user.gemini_configured ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/10' : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-900'}`}>
                          Gemini
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        (!user.gemini_status || user.gemini_status === 'READY') ? 'bg-zinc-800 text-zinc-200 border-zinc-700' :
                        user.gemini_status === 'QUOTA_EXHAUSTED' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' :
                        user.gemini_status === 'INVALID_KEY' ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' :
                        user.gemini_status === 'BILLING_REQUIRED' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' :
                        'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                      }`}>
                        {user.gemini_status || 'READY'}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        user.watcher_status === 'active' ? 'bg-zinc-800 text-zinc-200 border-zinc-700' :
                        user.watcher_status === 'paused' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                        'bg-zinc-100 dark:bg-zinc-900 text-zinc-500 border-zinc-200 dark:border-zinc-900'
                      }`}>
                        {user.watcher_status || 'N/A'}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex flex-col text-[10px]">
                        <span className="text-zinc-700 dark:text-zinc-300 font-semibold">{user.selected_pair} ({user.selected_timeframe})</span>
                        <span className="text-zinc-500 mt-1">Strategy: {user.selected_strategy}</span>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-[10px] text-zinc-500 font-mono">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex items-center justify-end gap-2.5">
                        <button 
                          onClick={() => setSelectedUser(user)}
                          className="px-2.5 py-1 text-[10px] font-bold bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer"
                        >
                          View
                        </button>
                        
                        {user.watcher_status === 'active' ? (
                          <button 
                            onClick={() => handleUserAction(user.id, 'pause')}
                            disabled={actionLoading !== null}
                            className="p-1.5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Pause Scanner"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleUserAction(user.id, 'resume')}
                            disabled={actionLoading !== null}
                            className="p-1.5 text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                            title="Resume Scanner"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button 
                          onClick={() => handleUserAction(user.id, 'delete')}
                          disabled={actionLoading !== null}
                          className="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete Watcher"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-5 py-4 bg-zinc-100 dark:bg-zinc-950/80 border-t border-zinc-200 dark:border-zinc-900 flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Page {currentPage} of {totalPages}</span>
              <div className="flex items-center gap-2">
                <button 
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[10px] font-bold text-zinc-400 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  Previous
                </button>
                <button 
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  className="px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-[10px] font-bold text-zinc-400 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* User details Modal overlay */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-fade-in text-zinc-950 dark:text-white">
            <div className="flex justify-between items-start border-b border-zinc-100 dark:border-zinc-900 pb-3">
              <div>
                <h4 className="text-sm font-bold text-zinc-950 dark:text-white">User Inspection details</h4>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{selectedUser.id}</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Email Address</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{selectedUser.email}</span>
                </div>
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Registration Date</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{new Date(selectedUser.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Telegram Connected</span>
                  <span className={`font-bold ${selectedUser.telegram_connected ? 'text-sky-600 dark:text-sky-400' : 'text-zinc-400'}`}>
                    {selectedUser.telegram_connected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Gemini Configured</span>
                  <span className={`font-bold ${selectedUser.gemini_configured ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}>
                    {selectedUser.gemini_configured ? 'Key Set' : 'Missing'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-900/40 space-y-2">
                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block">Watcher Information</span>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                  <span>Status: <strong className="text-zinc-800 dark:text-zinc-200 uppercase">{selectedUser.watcher_status}</strong></span>
                  <span>Trading Pair: <strong className="text-zinc-800 dark:text-zinc-200">{selectedUser.selected_pair}</strong></span>
                  <span>Timeframe: <strong className="text-zinc-800 dark:text-zinc-200">{selectedUser.selected_timeframe}</strong></span>
                  <span>Strategy: <strong className="text-zinc-800 dark:text-zinc-200">{selectedUser.selected_strategy}</strong></span>
                </div>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-100 dark:border-zinc-900/40 text-[10px] font-mono flex justify-between items-center text-zinc-500">
                <span>Last Scan execution</span>
                <span>{selectedUser.last_scan_at ? new Date(selectedUser.last_scan_at).toLocaleString() : 'Never Scanned'}</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              {selectedUser.watcher_status === 'active' ? (
                <button 
                  onClick={() => handleUserAction(selectedUser.id, 'pause')}
                  className="flex-1 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all cursor-pointer"
                >
                  Pause Scanner
                </button>
              ) : (
                <button 
                  onClick={() => handleUserAction(selectedUser.id, 'resume')}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-bold hover:bg-zinc-700 transition-all cursor-pointer"
                >
                  Activate Scanner
                </button>
              )}
              <button 
                onClick={() => handleUserAction(selectedUser.id, 'delete')}
                className="py-2 px-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-500/20 transition-all cursor-pointer flex items-center justify-center"
                title="Delete Scanner"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Notifications Section */}
      <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800">
        <AdminUserNotificationSection fetchWithAuth={fetchWithAuth} showToast={showToast} />
      </div>
    </div>
  );
};

// ----------------------------------------------------
// 3. Watchers Subpage
// ----------------------------------------------------
const WatchersPage = ({ fetchWithAuth, showToast }: { fetchWithAuth: any; showToast: any }) => {
  const [watchers, setWatchers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanWatcherId, setScanWatcherId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [scanningStatus, setScanningStatus] = useState<string>('');
  const [foundSignals, setFoundSignals] = useState<any[] | null>(null);

  // Add custom pair state variables for administrators
  const [showAddPairModal, setShowAddPairModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addSymbol, setAddSymbol] = useState('EURUSD');
  const [addTimeframe, setAddTimeframe] = useState('H1');
  const [addLoading, setAddLoading] = useState(false);

  const handleAddPair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail.trim()) {
      showToast("User email is required.", "error");
      return;
    }
    setAddLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/watchers/action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add_pair',
          email: addEmail.trim(),
          symbol: addSymbol,
          timeframe: addTimeframe
        })
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message || "Watcher added successfully!", "success");
        setShowAddPairModal(false);
        setAddEmail('');
        fetchWatchers();
      } else {
        showToast(json.error || "Failed to add watcher.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Request failed.", "error");
    } finally {
      setAddLoading(false);
    }
  };

  const fetchWatchers = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/watchers');
      const json = await res.json();
      if (json.success) {
        setWatchers(json.watchers);
        setError(null);
      } else {
        setError(json.error || "Failed to load watchers.");
      }
    } catch (err: any) {
      setError(err.message || "Network error fetching watchers.");
    } finally {
      setLoading(false);
    }
  };

  const handleWatcherAction = async (watcherId: string, action: 'restart' | 'stop' | 'force_scan' | 'delete') => {
    if (action === 'force_scan') {
      setScanWatcherId(watcherId);
      setScanningStatus("Initializing Twelve Data price feed and launching Gemini model analysis...");
      setFoundSignals(null);
      try {
        const res = await fetchWithAuth('/api/admin/watchers/action', {
          method: 'POST',
          body: JSON.stringify({ watcherId, action })
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message || "Force scan completed successfully!", 'success');
          setScanningStatus("Scan complete. Displaying results.");
          setFoundSignals(json.signals || []);
          fetchWatchers();
        } else {
          showToast(json.error || "Failed to force scan.", 'error');
          setScanWatcherId(null);
        }
      } catch (err: any) {
        showToast(err.message || "Error during scanning process.", 'error');
        setScanWatcherId(null);
      }
      return;
    }

    setActionLoading(watcherId);
    try {
      const res = await fetchWithAuth('/api/admin/watchers/action', {
        method: 'POST',
        body: JSON.stringify({ watcherId, action })
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message || `Watcher status updated to ${action}!`, 'success');
        fetchWatchers();
      } else {
        showToast(json.error || "Failed watcher operation.", 'error');
      }
    } catch (err: any) {
      showToast(err.message || "Request failed.", 'error');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    fetchWatchers();
  }, []);

  return (
    <div className="p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex justify-between items-center pb-2 border-b border-zinc-200 dark:border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-zinc-950 dark:text-white font-display">Active Scanners</h3>
          <p className="text-xs text-zinc-500">Autonomous market watchers currently registered in Supabase.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowAddPairModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-sm"
            title="Add Custom Watcher"
          >
            <Plus className="w-3.5 h-3.5" /> Add Pair
          </button>
          <button onClick={fetchWatchers} className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors cursor-pointer" title="Refresh Watchers">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <span className="text-xs font-semibold">Loading active scanner processes...</span>
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      ) : watchers.length === 0 ? (
        <div className="p-12 text-center text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-900 rounded-2xl bg-zinc-50 dark:bg-zinc-950/20">
          <Eye className="w-8 h-8 mx-auto mb-2 text-zinc-300 dark:text-zinc-700" />
          <p className="text-xs font-semibold">No scanner entries in database.</p>
        </div>
      ) : (
        <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-2xl overflow-hidden shadow-sm dark:shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 dark:bg-zinc-950/50">
                  <th className="py-4 px-5">User Account</th>
                  <th className="py-4 px-5">Pair</th>
                  <th className="py-4 px-5">Timeframe</th>
                  <th className="py-4 px-5">Status</th>
                  <th className="py-4 px-5">Gemini Health</th>
                  <th className="py-4 px-5">Last Scan</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {watchers.map(watcher => {
                  const gStatus = watcher.gemini_status || 'READY';
                  const gStatusLabel = 
                    gStatus === 'QUOTA_EXHAUSTED' ? 'WAITING FOR QUOTA' :
                    gStatus === 'INVALID_KEY' ? 'INVALID KEY' :
                    gStatus === 'TEMP_ERROR' ? 'TEMP ERROR' : 'READY';
                  
                  const gBadgeColor = 
                    gStatus === 'READY' ? 'bg-zinc-800 text-zinc-200 border-zinc-700' :
                    gStatus === 'QUOTA_EXHAUSTED' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' :
                    gStatus === 'TEMP_ERROR' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' :
                    'bg-rose-500/10 text-rose-400 border-rose-500/10';

                  return (
                    <tr key={watcher.id} className="border-b border-zinc-200 dark:border-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-900/30 transition-colors">
                      <td className="py-4 px-5">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{watcher.email}</span>
                          <span className="text-[9px] font-mono text-zinc-400 dark:text-zinc-600 mt-0.5">Watcher ID: {watcher.id.substring(0, 8)}...</span>
                        </div>
                      </td>
                      <td className="py-4 px-5 font-bold text-xs text-zinc-700 dark:text-zinc-300">{watcher.selected_pair}</td>
                      <td className="py-4 px-5 text-xs text-zinc-500 dark:text-zinc-400 font-semibold">{watcher.selected_timeframe}</td>
                      <td className="py-4 px-5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                          watcher.status === 'active' ? 'bg-zinc-800 text-zinc-200 border-zinc-700' :
                          watcher.status === 'paused' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' :
                          'bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-900'
                        }`}>
                          {watcher.status}
                        </span>
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border w-fit ${gBadgeColor}`}>
                            {gStatusLabel}
                          </span>
                          {watcher.next_gemini_retry_at && (
                            <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                              Retry: {new Date(watcher.next_gemini_retry_at).toLocaleTimeString()}
                            </span>
                          )}
                          {watcher.last_gemini_error && (
                            <span className="text-[9px] font-mono text-rose-600 dark:text-rose-400 max-w-[200px] truncate" title={watcher.last_gemini_error}>
                              Err: {watcher.last_gemini_error}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-5 text-xs text-zinc-400 font-mono">
                        {watcher.last_scan_at ? new Date(watcher.last_scan_at).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-4 px-5">
                        <div className="flex items-center justify-end gap-3">
                          <button 
                            onClick={() => handleWatcherAction(watcher.id, 'force_scan')}
                            className="px-2.5 py-1 text-[10px] font-bold bg-sky-500/10 border border-sky-500/20 rounded-lg hover:bg-sky-500/20 text-sky-400 transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Zap className="w-3 h-3" /> Force Scan
                          </button>

                          <button 
                            onClick={() => handleWatcherAction(watcher.id, 'restart')}
                            disabled={actionLoading === watcher.id}
                            className="p-1.5 text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                            title="Restart / Start Watcher"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>

                          <button 
                            onClick={() => handleWatcherAction(watcher.id, 'stop')}
                            disabled={actionLoading === watcher.id}
                            className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Stop Scanner"
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>

                          <button 
                            onClick={() => {
                              if (window.confirm(`Are you sure you want to delete the ${watcher.selected_pair} watcher for ${watcher.email}?`)) {
                                handleWatcherAction(watcher.id, 'delete');
                              }
                            }}
                            disabled={actionLoading === watcher.id}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Delete Watcher"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Force Scan Interactive Modal */}
      {scanWatcherId && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-900 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-5 animate-fade-in text-zinc-950 dark:text-white">
            <div className="flex justify-between items-start border-b border-zinc-100 dark:border-zinc-900 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <h4 className="text-sm font-bold text-zinc-950 dark:text-white">Force Scan Interactive Shell</h4>
              </div>
              {foundSignals !== null && (
                <button onClick={() => setScanWatcherId(null)} className="text-zinc-500 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {foundSignals === null ? (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <RefreshCw className="w-10 h-10 animate-spin text-sky-500" />
                <div className="space-y-1">
                  <h5 className="text-xs font-bold text-zinc-300">Market Scanner Executing</h5>
                  <p className="text-[11px] text-zinc-500 max-w-sm leading-relaxed">{scanningStatus}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl flex items-center gap-2.5 text-xs font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Gemini Market Analysis complete! logged {foundSignals.length} signals.</span>
                </div>

                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {foundSignals.length === 0 ? (
                    <div className="p-6 text-center text-xs text-zinc-500 bg-zinc-950 rounded-xl border border-zinc-900">
                      Market setup did not match strategy requirements. No signals generated.
                    </div>
                  ) : (
                    foundSignals.map((sig, idx) => (
                      <div key={idx} className="p-4 bg-zinc-950 rounded-xl border border-zinc-900 space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-extrabold text-white text-sm">{sig.pair}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${sig.direction === 'BUY' ? 'bg-zinc-800 text-zinc-100' : 'bg-rose-500/10 text-rose-400'}`}>
                            {sig.direction}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400 font-mono">
                          <span>Entry Price: {sig.entryPrice}</span>
                          <span>Stop Loss: {sig.stopLoss}</span>
                          <span>Take Profit: {sig.takeProfit}</span>
                          <span>Risk/Reward: {sig.riskRewardRatio}</span>
                        </div>
                        <div className="pt-2 border-t border-zinc-900/60 flex items-center justify-between">
                          <span className="text-[10px] font-semibold text-sky-400">Confidence Score: {sig.confidenceScore}%</span>
                        </div>
                        <p className="text-[10px] text-zinc-500 italic leading-relaxed mt-1">" {sig.aiReasoning} "</p>
                      </div>
                    ))
                  )}
                </div>

                <button 
                  onClick={() => setScanWatcherId(null)}
                  className="w-full py-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 rounded-xl text-zinc-300 font-bold text-xs transition-colors cursor-pointer"
                >
                  Close Console
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Pair Modal */}
      {showAddPairModal && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-fade-in text-zinc-950 dark:text-white">
            <div className="flex justify-between items-start border-b border-zinc-100 dark:border-zinc-900 pb-3">
              <div>
                <h4 className="text-sm font-bold text-zinc-950 dark:text-white font-display">Add Custom Watcher</h4>
                <p className="text-[10px] text-zinc-500">Quickly spin up a background watcher for any registered user profile.</p>
              </div>
              <button 
                onClick={() => setShowAddPairModal(false)} 
                className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-950 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddPair} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">User Email Address</label>
                <input 
                  type="email" 
                  required 
                  placeholder="e.g. client@domain.com"
                  value={addEmail} 
                  onChange={e => setAddEmail(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3.5 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors shadow-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">Trading Pair</label>
                  <select 
                    value={addSymbol} 
                    onChange={e => setAddSymbol(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors cursor-pointer shadow-sm"
                  >
                    <option value="EURUSD">EURUSD</option>
                    <option value="GBPUSD">GBPUSD</option>
                    <option value="XAUUSD">XAUUSD</option>
                    <option value="BTCUSD">BTCUSD</option>
                    <option value="NAS100">NAS100</option>
                    <option value="US30">US30</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">Timeframe</label>
                  <select 
                    value={addTimeframe} 
                    onChange={e => setAddTimeframe(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-700 transition-colors cursor-pointer shadow-sm"
                  >
                    <option value="M1">M1 (1 Minute)</option>
                    <option value="M5">M5 (5 Minutes)</option>
                    <option value="M15">M15 (15 Minutes)</option>
                    <option value="M30">M30 (30 Minutes)</option>
                    <option value="H1">H1 (1 Hour)</option>
                    <option value="H4">H4 (4 Hours)</option>
                    <option value="D1">D1 (Daily)</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-900/60 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowAddPairModal(false)}
                  className="px-4 py-2.5 border border-zinc-200 dark:border-zinc-900 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300 text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={addLoading}
                  className="px-5 py-2.5 bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-400 text-white dark:text-black text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                >
                  {addLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>Add Watcher</>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------
// 4. Signals Subpage
// ----------------------------------------------------
const SignalsPage = ({ fetchWithAuth }: { fetchWithAuth: any }) => {
  const [signals, setSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSignals = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/signals');
      const json = await res.json();
      if (json.success) {
        setSignals(json.signals);
        setError(null);
      } else {
        setError(json.error || "Failed to load signals.");
      }
    } catch (err: any) {
      setError(err.message || "Network error fetching signals.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignals();
  }, []);

  const filteredSignals = signals.filter(sig => 
    sig.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sig.pair?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sig.signal_type?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-white font-display">Signals Log</h3>
          <p className="text-xs text-zinc-500">History of signals generated by the AI agent and delivered to users.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search by pair or user..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-zinc-950 text-xs text-zinc-200 border border-zinc-900 rounded-xl pl-9 pr-4 py-2 w-48 sm:w-64 focus:outline-none focus:border-zinc-800"
            />
          </div>
          <button onClick={fetchSignals} className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer" title="Refresh Signals">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <span className="text-xs font-semibold">Loading signal logs...</span>
        </div>
      ) : error ? (
        <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-sm font-semibold">{error}</span>
        </div>
      ) : filteredSignals.length === 0 ? (
        <div className="p-12 text-center text-zinc-500 border border-dashed border-zinc-900 rounded-2xl bg-zinc-950/20">
          <Zap className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
          <p className="text-xs font-semibold">
            {searchQuery ? `No signals found matching "${searchQuery}"` : "Signal history is not persisted in the current MVP architecture."}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-950/50">
                  <th className="py-4 px-5">User Account</th>
                  <th className="py-4 px-5">Pair</th>
                  <th className="py-4 px-5 text-center">Signal Type</th>
                  <th className="py-4 px-5 text-center">Confidence</th>
                  <th className="py-4 px-5 text-center">Delivery Status</th>
                  <th className="py-4 px-5 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {filteredSignals.map(sig => (
                  <tr key={sig.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 transition-colors">
                    <td className="py-4 px-5 text-xs font-semibold text-zinc-300">{sig.email}</td>
                    <td className="py-4 px-5 font-bold text-xs text-white">{sig.pair}</td>
                    <td className="py-4 px-5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold ${
                        sig.signal_type === 'BUY' ? 'bg-zinc-800 text-zinc-100 border border-zinc-700' :
                        sig.signal_type === 'SELL' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/10' :
                        'bg-zinc-900 text-zinc-400 border border-zinc-800'
                      }`}>
                        {sig.signal_type}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-bold text-sky-400 font-mono">{sig.confidence || 0}%</span>
                        <div className="w-16 bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-1 border border-zinc-800/40">
                          <div 
                            className={`h-full rounded-full ${sig.confidence >= 80 ? 'bg-zinc-200' : sig.confidence >= 70 ? 'bg-amber-400' : 'bg-zinc-600'}`}
                            style={{ width: `${sig.confidence || 0}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-bold ${
                        sig.delivery_status === 'delivered' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/10' :
                        'bg-zinc-900 text-zinc-500 border border-zinc-900'
                      }`}>
                        {sig.delivery_status === 'delivered' ? 'Telegram' : 'Local Only'}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-right text-xs text-zinc-500 font-mono">
                      {new Date(sig.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------
// 5. System Health Subpage
// ----------------------------------------------------
const SystemHealthPage = ({ fetchWithAuth }: { fetchWithAuth: any }) => {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);

  const checkHealth = async (silent = false) => {
    if (!silent) setLoading(true);
    const start = Date.now();
    try {
      const res = await fetchWithAuth('/api/admin/system-health');
      const json = await res.json();
      const backend_latency_ms = Date.now() - start;
      if (res.ok) {
        setHealth({ ...json, backend_latency_ms });
        setError(null);
      } else {
        setError(json.error || "Failed to retrieve production health telemetry.");
      }
    } catch (err: any) {
      setError(err.message || "Network exception fetching system health metrics.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          checkHealth(true);
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleManualRefresh = () => {
    setCountdown(30);
    checkHealth();
  };

  const isDbAlert = health?.database === 'offline';
  const isCronAlert = health?.cron === 'stopped';
  const isGeminiAlert = health && health.gemini !== 'healthy';
  const isTelegramAlert = health && health.telegram !== 'healthy';
  const isLearningAlert = health?.learning_engine === 'Database Error';

  const hasCriticalAlerts = isDbAlert || isCronAlert || isGeminiAlert || isTelegramAlert || isLearningAlert;

  const getAlertMessages = () => {
    const alerts = [];
    if (isDbAlert) alerts.push("Database is OFFLINE");
    if (isCronAlert) alerts.push("Cron Scheduler is STOPPED");
    if (isGeminiAlert) alerts.push(`Gemini API is unavailable (${health.gemini})`);
    if (isTelegramAlert) alerts.push(`Telegram Bot is offline/error (${health.telegram})`);
    if (isLearningAlert) alerts.push("Learning Engine failure (Database Error)");
    return alerts;
  };

  return (
    <div id="system-health-page" className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-2 border-b border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-white font-display">Production Health Monitoring</h3>
          <p className="text-xs text-zinc-500">Autonomous platform diagnostics, latency checks, and metric tracking.</p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-zinc-950 px-3.5 py-1.5 rounded-xl border border-zinc-900 font-mono text-[11px] text-zinc-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-500" />
            <span>Refreshes in <b className="text-white">{countdown}s</b></span>
          </div>
          <button 
            onClick={handleManualRefresh}
            className="p-2.5 bg-zinc-950 border border-zinc-900 rounded-xl hover:bg-zinc-900 text-zinc-300 hover:text-white transition-all cursor-pointer"
            title="Refresh Diagnostics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Critical Alerts Banner */}
      {hasCriticalAlerts && (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/20 text-red-200 shadow-lg animate-pulse">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold uppercase tracking-wider font-display">Critical System Warning</h4>
              <ul className="list-disc list-inside text-xs space-y-1 text-red-400/90 font-mono">
                {getAlertMessages().map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <span className="text-xs font-semibold tracking-wider font-mono">RETRIEVING PRODUCTION METRICS...</span>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-4">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold">Failed to Fetch Health Telemetry</h4>
            <p className="text-xs text-red-400/80">{error}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status Indicators Grid */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Service Health Indicators</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              
              {/* Backend Status */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-900/60 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Backend API</span>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="w-2 h-2 rounded-full bg-white"></span>
                    <span className="text-xs font-bold text-zinc-200">HEALTHY</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono mt-3">Latency: {health?.backend_latency_ms || 0}ms</span>
              </div>

              {/* Database Status */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-900/60 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Database</span>
                  <div className="flex items-center gap-2 mt-2">
                    {health?.database === 'healthy' ? <span className="w-2 h-2 rounded-full bg-white"></span> : <span>{health?.database === 'slow' ? '🟡' : '🔴'}</span>}
                    <span className="text-xs font-bold text-zinc-200 uppercase">{health?.database}</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono mt-3">Latency: {health?.database_latency_ms || 0}ms</span>
              </div>

              {/* Telegram Status */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-900/60 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Telegram Bot</span>
                  <div className="flex items-center gap-2 mt-2">
                    {health?.telegram === 'healthy' ? <span className="w-2 h-2 rounded-full bg-white"></span> : <span>{health?.telegram === 'warning' ? '🟡' : '🔴'}</span>}
                    <span className="text-xs font-bold text-zinc-200 uppercase">{health?.telegram}</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono mt-3">Latency: {health?.telegram_latency_ms || 0}ms</span>
              </div>

              {/* Gemini Status */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-900/60 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Gemini AI</span>
                  <div className="flex items-center gap-2 mt-2">
                    {health?.gemini === 'healthy' ? <span className="w-2 h-2 rounded-full bg-white"></span> : <span>🔴</span>}
                    <span className="text-xs font-bold text-zinc-200 uppercase truncate max-w-[80px] block" title={health?.gemini}>{health?.gemini}</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono mt-3">Latency: {health?.gemini_latency_ms || 0}ms</span>
              </div>

              {/* Cron Status */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-900/60 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Cron Jobs</span>
                  <div className="flex items-center gap-2 mt-2">
                    {health?.cron === 'running' ? <span className="w-2 h-2 rounded-full bg-white"></span> : <span>🔴</span>}
                    <span className="text-xs font-bold text-zinc-200 uppercase">{health?.cron}</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono mt-3">Watcher: {health?.watchers || 0}</span>
              </div>

              {/* Learning Engine Status */}
              <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-900/60 flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Learning Core</span>
                  <div className="flex items-center gap-2 mt-2">
                    {health?.learning_engine === 'healthy' ? <span className="w-2 h-2 rounded-full bg-white"></span> : <span>🔴</span>}
                    <span className="text-xs font-bold text-zinc-200 uppercase truncate max-w-[80px] block" title={health?.learning_engine}>{health?.learning_engine === 'healthy' ? 'healthy' : 'Database Error'}</span>
                  </div>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono mt-3">History tracked</span>
              </div>

            </div>
          </div>

          {/* Metrics Dashboard Grid */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">System Performance Metrics</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              
              {/* Card 1: Users & Watchers */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80 flex flex-col justify-between shadow-lg">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Active Ecosystem</span>
                <div className="mt-2.5 space-y-1.5 font-mono">
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Active Users:</span>
                    <span className="text-xl font-bold text-white">{health?.active_users || 0}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Active Watchers:</span>
                    <span className="text-xl font-bold text-sky-400">{health?.watchers || 0}</span>
                  </div>
                </div>
                <span className="text-[9px] text-zinc-500 mt-3 font-semibold">Running autonomous scanners</span>
              </div>

              {/* Card 2: Scans & Signals */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80 flex flex-col justify-between shadow-lg">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Activity Overview (Today)</span>
                <div className="mt-2.5 space-y-1.5 font-mono">
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Total Scans:</span>
                    <span className="text-xl font-bold text-white">{health?.today_scans || 0}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Signals Sent:</span>
                    <span className="text-xl font-bold text-white">{health?.today_signals || 0}</span>
                  </div>
                </div>
                <span className="text-[9px] text-zinc-500 mt-3 font-semibold">Signals detected and pushed</span>
              </div>

              {/* Card 3: Failed Scans & Last Run */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80 flex flex-col justify-between shadow-lg">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Scheduler Failures</span>
                <div className="mt-2.5 space-y-1.5 font-mono">
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Failed Scans:</span>
                    <span className="text-xl font-bold text-red-400">{health?.today_failures || 0}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Last Scan Run:</span>
                    <span className="text-xs font-bold text-zinc-300 truncate max-w-[120px]" title={health?.last_scan ? new Date(health.last_scan).toLocaleTimeString() : 'N/A'}>
                      {health?.last_scan ? new Date(health.last_scan).toLocaleTimeString() : 'Never'}
                    </span>
                  </div>
                </div>
                <span className="text-[9px] text-zinc-500 mt-3 font-semibold">Scan outcomes failing criteria</span>
              </div>

              {/* Card 4: System Uptime & Version */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80 flex flex-col justify-between shadow-lg">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Ecosystem Telemetry</span>
                <div className="mt-2.5 space-y-1.5 font-mono">
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">Server Uptime:</span>
                    <span className="text-sm font-bold text-white">{health?.uptime || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-zinc-500 text-xs">System Version:</span>
                    <span className="text-sm font-bold text-zinc-400 font-bold">v{health?.version || '1.0.0'}</span>
                  </div>
                </div>
                <span className="text-[9px] text-zinc-500 mt-3 font-semibold">Running on container cluster</span>
              </div>

            </div>

            {/* Response Time Breakdown Card */}
            <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80 mt-5 shadow-lg">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-3">Average Latency Profile</h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs font-mono">
                <div className="p-3 bg-zinc-900/40 border border-zinc-900 rounded-xl">
                  <span className="text-zinc-500 text-[10px] block mb-1">Average Scan Speed</span>
                  <span className="text-lg font-bold text-white">{health?.average_scan_ms || 0} ms</span>
                </div>
                <div className="p-3 bg-zinc-900/40 border border-zinc-900 rounded-xl">
                  <span className="text-zinc-500 text-[10px] block mb-1">Average Gemini Latency</span>
                  <span className="text-lg font-bold text-amber-400">{health?.average_gemini_ms || 0} ms</span>
                </div>
                <div className="p-3 bg-zinc-900/40 border border-zinc-900 rounded-xl">
                  <span className="text-zinc-500 text-[10px] block mb-1">Average Telegram Dispatch</span>
                  <span className="text-lg font-bold text-sky-400">{health?.average_telegram_ms || 0} ms</span>
                </div>
                <div className="p-3 bg-zinc-900/40 border border-zinc-900 rounded-xl">
                  <span className="text-zinc-500 text-[10px] block mb-1">Direct Database Read</span>
                  <span className="text-lg font-bold text-white">{health?.database_latency_ms || 0} ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* Historical Check Logs */}
          <div className="bg-zinc-950 rounded-2xl border border-zinc-900 shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-900 bg-zinc-900/10 flex justify-between items-center">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide font-display">Diagnostic Audit History</span>
              <span className="text-[10px] font-mono text-zinc-500">Showing last 50 health events</span>
            </div>

            {(!health?.history || health.history.length === 0) ? (
              <div className="p-12 text-center text-xs text-zinc-500 font-mono">
                Waiting for rolling telemetry checks. The system collects historical logs every 30 seconds.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[450px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-900 bg-zinc-950 text-zinc-500 font-bold font-mono text-[9px] uppercase tracking-wider">
                      <th className="p-4">Timestamp</th>
                      <th className="p-4">Component</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Latency</th>
                      <th className="p-4">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/40 font-mono text-zinc-300">
                    {health.history.map((log: any, idx: number) => {
                      const isSuccess = log.status === 'healthy' || log.status === 'running' || log.status === 'success';
                      return (
                        <tr key={idx} className="hover:bg-zinc-900/10 transition-colors">
                          <td className="p-4 text-zinc-500 text-[11px] whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="p-4 font-bold text-white whitespace-nowrap">
                            {log.component}
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                              isSuccess 
                                ? 'bg-zinc-800 text-zinc-200 border-zinc-700' 
                                : 'bg-red-500/10 text-red-400 border-red-500/10'
                            }`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="p-4 text-zinc-400 whitespace-nowrap">
                            {log.latency > 0 ? `${log.latency}ms` : 'N/A'}
                          </td>
                          <td className="p-4 text-[11px] text-zinc-400" title={log.message}>
                            {log.message}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------
// 6. Settings Subpage
// ----------------------------------------------------
const SettingsPage = ({ fetchWithAuth, showToast }: { fetchWithAuth: any; showToast: any }) => {
  const [settings, setSettings] = useState<any>({
    defaultStrategy: "",
    defaultGeminiModel: "gemini-3.5-flash-lite",
    scanInterval: 15,
    maintenanceMode: false
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/settings');
      const json = await res.json();
      if (json.success && json.settings) {
        setSettings(json.settings);
      }
    } catch (err: any) {
      console.error("Failed fetching settings:", err);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ settings })
      });
      const json = await res.json();
      if (json.success) {
        showToast(json.message || "Settings saved successfully!", "success");
      } else {
        showToast(json.error || "Failed to save settings.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Failed saving settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
        <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
        <span className="text-xs font-semibold">Loading system settings...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl text-white">
      {/* Header */}
      <div className="pb-2 border-b border-zinc-900">
        <h3 className="text-lg font-bold text-white font-display">System Configuration</h3>
        <p className="text-xs text-zinc-500">Configure global app defaults and toggle system settings.</p>
      </div>

      <div className="space-y-6">
        {/* Dropdown models */}
        <div className="p-5 bg-zinc-950 rounded-2xl border border-zinc-900 space-y-2">
          <label className="text-xs font-extrabold text-zinc-400 uppercase tracking-wide block">Default Gemini Model</label>
          <span className="text-[10px] text-zinc-500 block mb-2">Configure default neural network for scanner evaluations.</span>
          <select 
            value={settings.defaultGeminiModel}
            onChange={e => setSettings((prev: any) => ({ ...prev, defaultGeminiModel: e.target.value }))}
            className="w-full bg-zinc-50 dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-900 text-xs font-semibold rounded-xl px-4 py-3 focus:outline-none focus:border-zinc-300 dark:focus:border-zinc-800 text-zinc-950 dark:text-zinc-300 shadow-sm"
          >
            <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash-Lite (Default / High Speed)</option>
            <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Deep Reasoning)</option>
            <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
          </select>
        </div>

        {/* Scan interval */}
        <div className="p-5 bg-zinc-950 rounded-2xl border border-zinc-900 space-y-2">
          <label className="text-xs font-extrabold text-zinc-400 uppercase tracking-wide block">Scan Interval (Minutes)</label>
          <span className="text-[10px] text-zinc-500 block mb-2">Duration between sequential scanner runs in background.</span>
          <input 
            type="number" 
            min="1"
            max="1440"
            value={settings.scanInterval}
            onChange={e => setSettings((prev: any) => ({ ...prev, scanInterval: parseInt(e.target.value) || 5 }))}
            className="w-full bg-zinc-50 dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-900 text-xs font-semibold rounded-xl px-4 py-3 focus:outline-none focus:border-zinc-300 dark:focus:border-zinc-800 text-zinc-950 dark:text-zinc-300 shadow-sm"
          />
        </div>

        {/* Text area */}
        <div className="p-5 bg-zinc-950 rounded-2xl border border-zinc-900 space-y-2">
          <label className="text-xs font-extrabold text-zinc-400 uppercase tracking-wide block">Default Strategy Description</label>
          <span className="text-[10px] text-zinc-500 block mb-2">Standard fallback prompt structure for Gemini-based oscillators and trading analysis.</span>
          <textarea 
            rows={5}
            value={settings.defaultStrategy}
            onChange={e => setSettings((prev: any) => ({ ...prev, defaultStrategy: e.target.value }))}
            className="w-full bg-zinc-50 dark:bg-[#0c0c0e] border border-zinc-200 dark:border-zinc-900 text-xs font-semibold rounded-xl px-4 py-3 focus:outline-none focus:border-zinc-300 dark:focus:border-zinc-800 text-zinc-950 dark:text-zinc-300 font-mono shadow-sm"
            placeholder="E.g. Identify high-probability SMA support and RSI oversold setups..."
          />
        </div>

        {/* Maintenance Toggle */}
        <div className="p-5 bg-zinc-950 rounded-2xl border border-zinc-900 flex justify-between items-center">
          <div className="space-y-1">
            <label className="text-xs font-extrabold text-zinc-400 uppercase tracking-wide block">Maintenance Mode</label>
            <span className="text-[10px] text-zinc-500 block">Blocks client-side access for users. Only administrators can use the workspace.</span>
          </div>
          <button 
            onClick={() => setSettings((prev: any) => ({ ...prev, maintenanceMode: !prev.maintenanceMode }))}
            className={`w-12 h-6.5 rounded-full p-1 transition-colors duration-200 cursor-pointer ${settings.maintenanceMode ? 'bg-rose-500' : 'bg-zinc-800'}`}
          >
            <div className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform duration-200 ${settings.maintenanceMode ? 'translate-x-5.5' : 'translate-x-0'}`} />
          </button>
        </div>

        <button 
          onClick={saveSettings}
          disabled={saving}
          className="w-full py-3.5 bg-white text-zinc-950 rounded-xl hover:bg-zinc-200 text-xs font-extrabold tracking-wide transition-all cursor-pointer flex justify-center items-center gap-2"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin text-zinc-950" /> : "Save Configuration"}
        </button>
      </div>
    </div>
  );
};


// ----------------------------------------------------
// ----------------------------------------------------
// 6. Live Logs Subpage
// ----------------------------------------------------
const LiveLogsPage = ({ fetchWithAuth }: { fetchWithAuth: any }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const res = await fetchWithAuth('/api/admin/logs');
      const json = await res.json();
      if (json.success) {
        setLogs(json.logs || []);
      }
    } catch (err) {
      console.error("Error fetching logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center pb-2 border-b border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-white font-display">Live Operational Logs</h3>
          <p className="text-xs text-zinc-500">Real-time execution trace grouped by cron run. Auto-refreshes every 10s.</p>
        </div>
        <button onClick={fetchLogs} className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
          <p className="text-xs text-zinc-500">Fetching latest execution logs...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="p-12 text-center text-zinc-500 border border-dashed border-zinc-900 rounded-2xl bg-zinc-950/20">
          <Terminal className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
          <p className="text-xs font-semibold">No execution logs found in Supabase.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {logs.map((run) => (
            <div key={run.id} className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-xl">
              <div className="px-5 py-3 bg-zinc-900/50 border-b border-zinc-900 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${run.status === 'success' ? 'bg-white' : 'bg-red-500'}`} />
                  <span className="text-xs font-bold text-zinc-200">{run.pair}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">{new Date(run.run_time).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-[10px]">
                    <span className="text-zinc-500">Signal: </span>
                    <span className={`font-bold ${run.final_signal === 'BUY' ? 'text-zinc-200' : run.final_signal === 'SELL' ? 'text-red-400' : 'text-zinc-400'}`}>
                      {run.final_signal || 'N/A'}
                    </span>
                  </div>
                  <div className="text-[10px]">
                    <span className="text-zinc-500">Score: </span>
                    <span className="font-bold text-zinc-200">{run.decision_score?.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-black/40 font-mono text-[10px] space-y-1 max-h-60 overflow-y-auto">
                {run.logs?.map((log: any, idx: number) => (
                  <div key={idx} className="flex gap-3">
                    <span className="text-zinc-600 shrink-0">[{log.time}]</span>
                    <span className={`${
                      log.type === 'success' ? 'text-zinc-300' : 
                      log.type === 'error' ? 'text-red-500' : 
                      log.type === 'warning' ? 'text-amber-500' : 
                      'text-zinc-400'
                    }`}>
                      {log.message}
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
};

// ----------------------------------------------------
// Main Admin Component
// ----------------------------------------------------
export default function AdminDashboard({ 
  userProfile, 
  session, 
  authLoading,
  initialTab
}: { 
  userProfile: any, 
  session: any, 
  authLoading: boolean,
  initialTab?: 'dashboard' | 'learning' | 'live-logs' | 'users' | 'notifications' | 'watchers' | 'signals' | 'health' | 'settings'
}) {
  const [activeAdminTab, setActiveAdminTab] = useState<'dashboard' | 'learning' | 'live-logs' | 'users' | 'notifications' | 'watchers' | 'signals' | 'health' | 'settings'>(initialTab || 'dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (initialTab) {
      setActiveAdminTab(initialTab);
    }
  }, [initialTab]);

  const ADMIN_EMAIL = "gaks6535@gmail.com";
  
  // Clean email formatting
  const userEmail = (userProfile?.email || session?.user?.email)?.trim().toLowerCase();
  const isAdmin = userEmail === ADMIN_EMAIL.trim().toLowerCase();

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  };

  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }
    
    console.log(`[Admin Fetch Request] URL: ${url}`, { method: options.method || 'GET', headers: Object.fromEntries(headers.entries()) });
    
    try {
      const response = await fetch(url, { ...options, headers });
      
      console.log(`[Admin Fetch Debug] Request URL: ${url}`);
      console.log(`[Admin Fetch Debug] HTTP Status: ${response.status}`);
      
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      console.log(`[Admin Fetch Debug] Response Headers:`, responseHeaders);
      
      const text = await response.text();
      console.log(`[Admin Fetch Debug] Raw Response Body:`, text);
      
      const isHtml = text.trim().startsWith('<') || text.trim().startsWith('<!DOCTYPE html');
      if (isHtml) {
        console.error(`[Admin Fetch HTML Response Alert]
- Requested URL: ${url}
- Status Code: ${response.status}
- Why the endpoint does not exist: The endpoint returned HTML content instead of JSON. This typically happens when the server route is not found (404) or matches a catch-all route that serves index.html (the frontend SPA entry point) instead of a proper API response.`);
      }
      
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (err: any) {
      console.error(`[Admin Fetch Network Error] URL: ${url}, Error:`, err);
      throw err;
    }
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-zinc-400">
        <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
        <span className="text-xs font-semibold">Initializing admin session...</span>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] p-6 text-center space-y-4">
        <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-full">
          <Shield className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">Unauthorized Access</h2>
          <p className="text-xs text-zinc-500 max-w-xs leading-relaxed mt-1">
            Your account ({userEmail || "No Email"}) is not registered as an administrator.
          </p>
        </div>
      </div>
    );
  }

  const menuItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'learning', label: 'Learning & Performance', icon: Sparkles },
    { id: 'live-logs', label: 'Live Logs', icon: Terminal },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'notifications', label: 'User Notifications', icon: Send },
    { id: 'watchers', label: 'Watchers', icon: Eye },
    { id: 'signals', label: 'Signals', icon: Zap },
    { id: 'health', label: 'System Health', icon: Activity },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="flex h-[90vh] bg-[#080808] border-t border-zinc-900 text-white rounded-t-3xl overflow-hidden mt-2 relative">
      
      {/* Sidebar for desktop, drawer for mobile */}
      <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-[#0c0c0e] border-r border-zinc-200 dark:border-zinc-900/80 transform transition-transform duration-200 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:relative md:h-full`}>
        <div className="p-5 border-b border-zinc-900 flex justify-between items-center bg-zinc-950/40">
          <span className="text-white font-extrabold text-sm flex items-center gap-2 tracking-tight">
            <Shield className="w-4.5 h-4.5 text-sky-400" /> Administrative Shield
          </span>
          <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-zinc-500 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <nav className="p-4 space-y-1">
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setActiveAdminTab(item.id as any); setIsSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${activeAdminTab === item.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-950/40'}`}
            >
              <item.icon className="w-4.5 h-4.5" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-[#080808] overflow-hidden">
        {/* Sub-header for mobile sidebar trigger */}
        <header className="px-6 py-4 border-b border-zinc-900/60 flex items-center justify-between bg-[#080808]/50 md:hidden shrink-0">
          <button onClick={() => setIsSidebarOpen(true)} className="p-1 text-zinc-400 hover:text-white cursor-pointer"><Menu className="w-5 h-5" /></button>
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">{menuItems.find(m => m.id === activeAdminTab)?.label || activeAdminTab}</span>
          <div className="w-5" /> {/* Spacer */}
        </header>

        {/* Scrollable Subpage Frame */}
        <div className="flex-1 overflow-y-auto pb-16">
          {activeAdminTab === 'dashboard' && <DashboardPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'learning' && (
            <div className="p-4 sm:p-6 space-y-6">
              <LearningPerformanceView 
                userId={session?.user?.id || userProfile?.id} 
                authToken={session?.access_token} 
              />
            </div>
          )}
          {activeAdminTab === 'live-logs' && <LiveLogsPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'users' && <UsersPage fetchWithAuth={fetchWithAuth} showToast={showToast} />}
          {activeAdminTab === 'notifications' && (
            <div className="p-6">
              <AdminUserNotificationSection fetchWithAuth={fetchWithAuth} showToast={showToast} />
            </div>
          )}
          {activeAdminTab === 'watchers' && <WatchersPage fetchWithAuth={fetchWithAuth} showToast={showToast} />}
          {activeAdminTab === 'signals' && <SignalsPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'health' && <SystemHealthPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'settings' && <SettingsPage fetchWithAuth={fetchWithAuth} showToast={showToast} />}
        </div>
      </div>

      {/* Floating toast alerts */}
      {toast && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast(null)} 
        />
      )}
    </div>
  );
}
