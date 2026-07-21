import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Users, Eye, Zap, Activity, Settings as SettingsIcon, 
  Shield, Menu, X, Key, MessageSquare, Clock, Heart, Search, RefreshCw, 
  Play, Pause, Trash2, AlertTriangle, CheckCircle2, Power, Terminal, Sliders, Check, ExternalLink, Send, Plus
} from 'lucide-react';
import { supabase } from '../../supabaseClient';

import GeminiTesterPage from './GeminiTesterPage';
import StrategyEngineInspectorPage from './StrategyEngineInspectorPage';

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

// ----------------------------------------------------
// Toast Component
// ----------------------------------------------------
const Toast = ({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center gap-2.5 shadow-2xl animate-fade-in">
      <div className={`p-1 rounded-full ${type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
        {type === 'success' ? <Check className="w-4 h-4 stroke-[2.5]" /> : <AlertTriangle className="w-4 h-4" />}
      </div>
      <span className="text-xs font-semibold text-zinc-200">{message}</span>
      <button onClick={onClose} className="ml-2 text-zinc-500 hover:text-white transition-colors">
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
        <RefreshCw className="w-8 h-8 animate-spin text-sky-500 mb-3" />
        <span className="text-xs font-semibold">Loading live statistics from Supabase...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 m-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5" />
        <span className="text-sm font-semibold">{error}</span>
      </div>
    );
  }

  const statCards = [
    { label: "Total Active Watchers", value: stats?.activeWatchers || 0, desc: "Scanners actively running in background", icon: Eye, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { label: "Total Pairs Being Monitored", value: stats?.totalPairsMonitored || 0, desc: "Unique currency and crypto trading pairs", icon: Activity, color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
    { label: "Total Signals Sent", value: stats?.totalSignalsSent || 0, desc: "Total alerts processed historically", icon: Zap, color: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
    { label: "Last Scan Time", value: stats?.lastCronRun ? new Date(stats.lastCronRun).toLocaleTimeString() : "Never", desc: stats?.lastCronRun ? new Date(stats.lastCronRun).toLocaleDateString() : "No scan executed yet", icon: Clock, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { label: "Total Registered Users", value: stats?.totalUsers || 0, desc: "Users in profiles database", icon: Users, color: "text-zinc-400 bg-zinc-800/10 border-zinc-800/20" },
    { label: "Telegram Connected Users", value: stats?.telegramConnected || 0, desc: "Profiles with push alerts active", icon: MessageSquare, color: "text-sky-400 bg-sky-500/10 border-sky-500/20" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header section */}
      <div className="flex justify-between items-center pb-2 border-b border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-white font-display">Overview Stats</h3>
          <p className="text-xs text-zinc-500">Real-time statistics fetched from Supabase using Service Role privilege</p>
        </div>
        <button onClick={fetchStats} className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer" title="Refresh Stats">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {statCards.map((card, i) => (
          <div key={i} className={`bg-zinc-950 p-5 rounded-2xl border flex flex-col justify-between shadow-lg relative overflow-hidden transition-all hover:scale-[1.01] ${card.color.split(' ')[2]}`}>
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{card.label}</span>
                <p className="text-3xl font-extrabold text-white mt-1.5 font-display">{card.value}</p>
              </div>
              <div className={`p-2.5 rounded-xl ${card.color.split(' ')[1]} ${card.color.split(' ')[0]}`}>
                <card.icon className="w-5 h-5 stroke-[1.8]" />
              </div>
            </div>
            <span className="text-[10px] text-zinc-500 mt-4">{card.desc}</span>
          </div>
        ))}
      </div>

      {/* Auxiliary Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400" /> Cron Status
          </h4>
          <div className="space-y-3.5">
            <div className="flex justify-between items-center py-2 border-b border-zinc-900/60">
              <span className="text-xs text-zinc-400">System Status</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">OPERATIONAL</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-900/60">
              <span className="text-xs text-zinc-400">Last Scanner Run</span>
              <span className="text-xs font-mono text-zinc-200">{stats?.lastCronRun ? new Date(stats.lastCronRun).toLocaleString() : "None"}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-xs text-zinc-400">Server Host Ingress</span>
              <span className="text-xs font-mono text-zinc-500">Port 3000 / Cloud Run</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900/80">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-500" /> Administrative Info
          </h4>
          <div className="space-y-3.5">
            <div className="flex justify-between items-center py-2 border-b border-zinc-900/60">
              <span className="text-xs text-zinc-400">Primary Database</span>
              <span className="text-xs font-semibold text-zinc-200">Supabase (PostgreSQL)</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-zinc-900/60">
              <span className="text-xs text-zinc-400">Authorized Admin</span>
              <span className="text-xs font-mono text-sky-400 font-semibold">gaks6535@gmail.com</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-xs text-zinc-400">Active API Key Mode</span>
              <span className="text-xs font-semibold text-zinc-500">Server proxy via /api/*</span>
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
    <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-900/80">
      <div className="flex items-center gap-2 mb-2">
        <Send className="w-4.5 h-4.5 text-sky-400" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-display">
          Send Test Notification
        </h4>
      </div>
      <p className="text-[11px] text-zinc-500 mb-5 leading-relaxed">
        Send a simulated market signal to any connected user to verify Telegram delivery.
      </p>

      <form onSubmit={handleSendTest} className="space-y-4">
        {/* Target selection tabs */}
        <div className="grid grid-cols-3 gap-1 p-0.5 bg-zinc-900 border border-zinc-800 rounded-xl text-[10px]">
          <button
            type="button"
            onClick={() => { setTargetType('list'); setStatus(null); }}
            className={`py-1.5 rounded-lg font-bold uppercase transition-all cursor-pointer ${targetType === 'list' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            User List
          </button>
          <button
            type="button"
            onClick={() => { setTargetType('email'); setStatus(null); }}
            className={`py-1.5 rounded-lg font-bold uppercase transition-all cursor-pointer ${targetType === 'email' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Email
          </button>
          <button
            type="button"
            onClick={() => { setTargetType('telegram'); setStatus(null); }}
            className={`py-1.5 rounded-lg font-bold uppercase transition-all cursor-pointer ${targetType === 'telegram' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Telegram
          </button>
        </div>

        {/* Dynamic target input */}
        <div>
          {targetType === 'list' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Select Registered User</label>
              {usersLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-zinc-500">
                  <RefreshCw className="w-3 h-3 animate-spin text-sky-500" /> Loading users list...
                </div>
              ) : (
                <select
                  value={selectedUserId}
                  onChange={(e) => { setSelectedUserId(e.target.value); setStatus(null); }}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
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
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Search by User Email</label>
              <input
                type="email"
                placeholder="user@example.com"
                value={emailQuery}
                onChange={(e) => { setEmailQuery(e.target.value); setStatus(null); }}
                className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
          )}

          {targetType === 'telegram' && (
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Search by Telegram Username</label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-zinc-500 text-xs font-semibold">@</span>
                <input
                  type="text"
                  placeholder="username"
                  value={telegramQuery}
                  onChange={(e) => { setTelegramQuery(e.target.value); setStatus(null); }}
                  className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl pl-7 pr-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Optional fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Symbol (Optional)</label>
            <input
              type="text"
              placeholder="BTCUSD"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Timeframe (Optional)</label>
            <input
              type="text"
              placeholder="1H"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>

        {/* Status message */}
        {status && (
          <div className={`p-3 rounded-xl text-xs flex items-start gap-2.5 border ${
            status.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
              : 'bg-red-500/10 border-red-500/20 text-red-400'
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
          className="w-full bg-sky-500 hover:bg-sky-400 disabled:bg-sky-500/50 text-black font-extrabold text-xs uppercase tracking-wider py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 mt-2"
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
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  const filteredUsers = users.filter(user => 
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.id?.includes(searchQuery)
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-white font-display">User Accounts</h3>
          <p className="text-xs text-zinc-500">Audit registered users, check integration status, or manage their market scanners.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search by email..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="bg-zinc-950 text-xs text-zinc-200 border border-zinc-900 rounded-xl pl-9 pr-4 py-2 w-48 sm:w-64 focus:outline-none focus:border-zinc-800"
            />
          </div>
          <button onClick={fetchUsers} className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer" title="Refresh Users">
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
        <div className="p-12 text-center text-zinc-500 border border-dashed border-zinc-900 rounded-2xl bg-zinc-950/20">
          <Search className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
          <p className="text-xs font-semibold">No users found matching "{searchQuery}"</p>
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-950/50">
                  <th className="py-4 px-5">User Profile / ID</th>
                  <th className="py-4 px-5 text-center">Integrations</th>
                  <th className="py-4 px-5 text-center">Watcher Status</th>
                  <th className="py-4 px-5">Selected Setup</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 transition-colors">
                    <td className="py-4 px-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-200">{user.email}</span>
                        <span className="text-[10px] font-mono text-zinc-500 mt-1">{user.full_name || "No name set"}</span>
                        <span className="text-[9px] text-zinc-600 font-mono mt-0.5">{user.id}</span>
                      </div>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex justify-center items-center gap-3">
                        <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${user.telegram_connected ? 'bg-sky-500/10 text-sky-400 border-sky-500/10' : 'bg-zinc-900 text-zinc-500 border-zinc-900'}`}>
                          TG
                        </span>
                        <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${user.gemini_configured ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' : 'bg-zinc-900 text-zinc-500 border-zinc-900'}`}>
                          Gemini
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        user.watcher_status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' :
                        user.watcher_status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' :
                        'bg-zinc-900 text-zinc-500 border-zinc-900'
                      }`}>
                        {user.watcher_status}
                      </span>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex flex-col text-[10px]">
                        <span className="text-zinc-300 font-semibold">{user.selected_pair} ({user.selected_timeframe})</span>
                        <span className="text-zinc-500 mt-1">Strategy: {user.selected_strategy}</span>
                      </div>
                    </td>
                    <td className="py-4 px-5">
                      <div className="flex items-center justify-end gap-2.5">
                        <button 
                          onClick={() => setSelectedUser(user)}
                          className="px-2.5 py-1 text-[10px] font-bold bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer"
                        >
                          View
                        </button>
                        
                        {user.watcher_status === 'active' ? (
                          <button 
                            onClick={() => handleUserAction(user.id, 'pause')}
                            disabled={actionLoading !== null}
                            className="p-1.5 text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Pause Scanner"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleUserAction(user.id, 'resume')}
                            disabled={actionLoading !== null}
                            className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer"
                            title="Resume Scanner"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button 
                          onClick={() => handleUserAction(user.id, 'delete')}
                          disabled={actionLoading !== null}
                          className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
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
        </div>
      )}

      {/* User details Modal overlay */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-[#0c0c0e] border border-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-fade-in text-white">
            <div className="flex justify-between items-start border-b border-zinc-900 pb-3">
              <div>
                <h4 className="text-sm font-bold text-white">User Inspection details</h4>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{selectedUser.id}</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="text-zinc-500 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Email Address</span>
                  <span className="font-bold text-zinc-200">{selectedUser.email}</span>
                </div>
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Registration Date</span>
                  <span className="font-bold text-zinc-200">{new Date(selectedUser.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Telegram Connected</span>
                  <span className={`font-bold ${selectedUser.telegram_connected ? 'text-sky-400' : 'text-zinc-500'}`}>
                    {selectedUser.telegram_connected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-900/40">
                  <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">Gemini Configured</span>
                  <span className={`font-bold ${selectedUser.gemini_configured ? 'text-amber-400' : 'text-zinc-500'}`}>
                    {selectedUser.gemini_configured ? 'Key Set' : 'Missing'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-900/40 space-y-2">
                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block">Watcher Information</span>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
                  <span>Status: <strong className="text-zinc-200 uppercase">{selectedUser.watcher_status}</strong></span>
                  <span>Trading Pair: <strong className="text-zinc-200">{selectedUser.selected_pair}</strong></span>
                  <span>Timeframe: <strong className="text-zinc-200">{selectedUser.selected_timeframe}</strong></span>
                  <span>Strategy: <strong className="text-zinc-200">{selectedUser.selected_strategy}</strong></span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-900/40 text-[10px] font-mono flex justify-between items-center text-zinc-500">
                <span>Last Scan execution</span>
                <span>{selectedUser.last_scan_at ? new Date(selectedUser.last_scan_at).toLocaleString() : 'Never Scanned'}</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              {selectedUser.watcher_status === 'active' ? (
                <button 
                  onClick={() => handleUserAction(selectedUser.id, 'pause')}
                  className="flex-1 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all cursor-pointer"
                >
                  Pause Scanner
                </button>
              ) : (
                <button 
                  onClick={() => handleUserAction(selectedUser.id, 'resume')}
                  className="flex-1 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 transition-all cursor-pointer"
                >
                  Activate Scanner
                </button>
              )}
              <button 
                onClick={() => handleUserAction(selectedUser.id, 'delete')}
                className="py-2 px-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-bold hover:bg-rose-500/20 transition-all cursor-pointer flex items-center justify-center"
                title="Delete Scanner"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
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
      setScanningStatus("Initializing Twelve Data price feed and launching Gemini-2.5 model analysis...");
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
      <div className="flex justify-between items-center pb-2 border-b border-zinc-900">
        <div>
          <h3 className="text-lg font-bold text-white font-display">Active Scanners</h3>
          <p className="text-xs text-zinc-500">Autonomous market watchers currently registered in Supabase.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowAddPairModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold rounded-lg transition-colors cursor-pointer"
            title="Add Custom Watcher"
          >
            <Plus className="w-3.5 h-3.5" /> Add Pair
          </button>
          <button onClick={fetchWatchers} className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer" title="Refresh Watchers">
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
        <div className="p-12 text-center text-zinc-500 border border-dashed border-zinc-900 rounded-2xl bg-zinc-950/20">
          <Eye className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
          <p className="text-xs font-semibold">No scanner entries in database.</p>
        </div>
      ) : (
        <div className="bg-zinc-950 border border-zinc-900 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-900 text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-950/50">
                  <th className="py-4 px-5">User Account</th>
                  <th className="py-4 px-5">Pair</th>
                  <th className="py-4 px-5">Timeframe</th>
                  <th className="py-4 px-5">Status</th>
                  <th className="py-4 px-5">Last Scan</th>
                  <th className="py-4 px-5">Started At</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {watchers.map(watcher => (
                  <tr key={watcher.id} className="border-b border-zinc-900 hover:bg-zinc-900/30 transition-colors">
                    <td className="py-4 px-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-zinc-200">{watcher.email}</span>
                        <span className="text-[9px] font-mono text-zinc-600 mt-0.5">Watcher ID: {watcher.id.substring(0, 8)}...</span>
                      </div>
                    </td>
                    <td className="py-4 px-5 font-bold text-xs text-zinc-300">{watcher.selected_pair}</td>
                    <td className="py-4 px-5 text-xs text-zinc-400 font-semibold">{watcher.selected_timeframe}</td>
                    <td className="py-4 px-5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                        watcher.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/10' :
                        watcher.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/10' :
                        'bg-zinc-900 text-zinc-500 border-zinc-900'
                      }`}>
                        {watcher.status}
                      </span>
                    </td>
                    <td className="py-4 px-5 text-xs text-zinc-400 font-mono">
                      {watcher.last_scan_at ? new Date(watcher.last_scan_at).toLocaleString() : 'Never'}
                    </td>
                    <td className="py-4 px-5 text-xs text-zinc-500 font-mono">
                      {watcher.started_at ? new Date(watcher.started_at).toLocaleDateString() : 'None'}
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
                          className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer"
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Force Scan Interactive Modal */}
      {scanWatcherId && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#0c0c0e] border border-zinc-900 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-5 animate-fade-in text-white">
            <div className="flex justify-between items-start border-b border-zinc-900 pb-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <h4 className="text-sm font-bold text-white">Force Scan Interactive Shell</h4>
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
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl flex items-center gap-2.5 text-xs font-semibold">
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
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${sig.direction === 'BUY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
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
          <div className="bg-[#0c0c0e] border border-zinc-900 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-fade-in text-white">
            <div className="flex justify-between items-start border-b border-zinc-900 pb-3">
              <div>
                <h4 className="text-sm font-bold text-white font-display">Add Custom Watcher</h4>
                <p className="text-[10px] text-zinc-500">Quickly spin up a background watcher for any registered user profile.</p>
              </div>
              <button 
                onClick={() => setShowAddPairModal(false)} 
                className="text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-zinc-900 transition-colors cursor-pointer"
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
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-zinc-700 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">Trading Pair</label>
                  <select 
                    value={addSymbol} 
                    onChange={e => setAddSymbol(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-zinc-700 transition-colors cursor-pointer"
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
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-zinc-700 transition-colors cursor-pointer"
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

              <div className="pt-3 border-t border-zinc-900/60 flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setShowAddPairModal(false)}
                  className="px-4 py-2.5 border border-zinc-900 bg-zinc-950 hover:bg-zinc-900 text-zinc-300 text-xs font-semibold rounded-lg transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={addLoading}
                  className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-black text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
          <p className="text-xs font-semibold">No signals found matching "{searchQuery}"</p>
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
                        sig.signal_type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' :
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
                            className={`h-full rounded-full ${sig.confidence >= 80 ? 'bg-emerald-400' : sig.confidence >= 70 ? 'bg-amber-400' : 'bg-zinc-600'}`}
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
  
  // Auto-refresh timer (30 seconds)
  const [countdown, setCountdown] = useState(30);

  // Full System Test States
  const [isTesting, setIsTesting] = useState(false);
  const [testStep, setTestStep] = useState(1);
  const [testResults, setTestResults] = useState<any>(null);
  const [overallTestStatus, setOverallTestStatus] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const checkHealth = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetchWithAuth('/api/admin/health');
      const json = await res.json();
      if (json.success) {
        setHealth(json.health);
        setError(null);
      } else {
        setError(json.error || "Failed to verify system health.");
      }
    } catch (err: any) {
      setError(err.message || "Network timeout testing services.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Manage initial load and 30s auto-refresh
  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          checkHealth(true); // Silent background refresh
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

  // Run full system test sequence
  const runFullSystemTest = async () => {
    setIsTesting(true);
    setTestStep(1);
    setTestResults(null);
    setOverallTestStatus(null);
    setTestError(null);

    // Stagger steps to simulate a real-time active diagnostics engine
    try {
      const apiPromise = fetchWithAuth('/api/admin/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      // Step 1: Database Check
      await new Promise(r => setTimeout(r, 800));
      setTestStep(2);

      // Step 2: Twelve Data Fetch
      await new Promise(r => setTimeout(r, 1000));
      setTestStep(3);

      // Step 3: Gemini Analysis
      await new Promise(r => setTimeout(r, 1200));
      setTestStep(4);

      // Step 4: Gemini Readout
      await new Promise(r => setTimeout(r, 800));
      setTestStep(5);

      // Step 5: Telegram Dispatch
      await new Promise(r => setTimeout(r, 1000));
      setTestStep(6);

      const res = await apiPromise;
      const data = await res.json();

      if (data.success) {
        setTestResults(data.results);
        setOverallTestStatus(data.overallStatus);
      } else {
        throw new Error(data.error || "Failed running full system diagnostics.");
      }
    } catch (err: any) {
      setTestError(err.message || "Server exception during system diagnostic check.");
      setOverallTestStatus('SYSTEM ERROR');
    } finally {
      // Refresh current dashboard status to reflect test runs
      checkHealth(true);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === 'ONLINE' || status === 'Healthy' || status === 'SYSTEM HEALTHY') {
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400';
    }
    if (status === 'ERROR' || status === 'OFFLINE' || status === 'SYSTEM ERROR') {
      return 'border-red-500/20 bg-red-500/10 text-red-400';
    }
    return 'border-zinc-800 bg-zinc-900/50 text-zinc-400';
  };

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      {/* Upper Status Panel */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-zinc-900">
        <div>
          <h3 className="text-xl font-bold text-white tracking-tight">System Health Diagnostics</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Real-time latency logging and operational checks across core trading components.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-zinc-950 px-3.5 py-1.5 rounded-xl border border-zinc-900 font-mono text-[11px] text-zinc-400">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-500" />
            <span>Refreshes in <b className="text-white">{countdown}s</b></span>
          </div>
          <button 
            onClick={handleManualRefresh} 
            className="p-2.5 bg-zinc-950 border border-zinc-900 rounded-xl hover:bg-zinc-900 text-zinc-300 hover:text-white transition-all cursor-pointer"
            title="Refresh diagnostics"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={runFullSystemTest}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-black font-semibold text-xs rounded-xl hover:bg-zinc-200 transition-all cursor-pointer font-sans"
          >
            <Terminal className="w-4 h-4" />
            Run Full System Test
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <RefreshCw className="w-10 h-10 animate-spin text-white mb-4" />
          <span className="text-xs font-semibold tracking-wider font-mono">LOADING SYSTEM TELEMETRY...</span>
        </div>
      ) : error ? (
        <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-4 shadow-xl">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <div className="space-y-1">
            <h4 className="text-sm font-bold">Failed to Fetch Health Telemetry</h4>
            <p className="text-xs text-red-400/80">{error}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-8 animate-fade-in">
          
          {/* Primary Ecosystem Grid */}
          <div>
            <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-4 font-mono">Ecosystem Components</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              
              {/* Market Watcher Card */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between hover:border-zinc-800 transition-all">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">BACKGROUND SCHEDULER</span>
                    <h5 className="text-sm font-bold text-white">Market Watcher Cron</h5>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(health?.cron?.status)}`}>
                    {health?.cron?.status === 'ONLINE' ? 'Healthy' : 'Error'}
                  </span>
                </div>
                <div className="mt-5 space-y-2 border-t border-zinc-900/80 pt-4 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Last Execution:</span>
                    <span className="text-zinc-300">{health?.cron?.lastExecutionTime ? new Date(health.cron.lastExecutionTime).toLocaleTimeString() : 'Never'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Next Execution:</span>
                    <span className="text-zinc-300">{health?.cron?.nextExecutionTime ? new Date(health.cron.nextExecutionTime).toLocaleTimeString() : 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Last Duration:</span>
                    <span className="text-zinc-300">{health?.cron?.lastDuration || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Twelve Data Card */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between hover:border-zinc-800 transition-all">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">MARKET DATA FEED</span>
                    <h5 className="text-sm font-bold text-white">Twelve Data API</h5>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(health?.twelveData?.status)}`}>
                    {health?.twelveData?.status === 'ONLINE' ? 'Connected' : 'Failed'}
                  </span>
                </div>
                {health?.twelveData?.error ? (
                  <p className="mt-4 text-[11px] text-red-400 bg-red-500/5 p-2 rounded-xl border border-red-500/10 font-mono">
                    Error: {health.twelveData.error}
                  </p>
                ) : (
                  <div className="mt-5 space-y-2 border-t border-zinc-900/80 pt-4 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tested Symbol:</span>
                      <span className="text-zinc-300">{health?.twelveData?.symbol || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Latest Price:</span>
                      <span className="text-emerald-400 font-bold">${health?.twelveData?.price || '0.00'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Response Time:</span>
                      <span className="text-zinc-300">{health?.twelveData?.responseTime}ms</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Gemini AI Card */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between hover:border-zinc-800 transition-all">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">AI REASONING CORE</span>
                    <h5 className="text-sm font-bold text-white">Gemini AI</h5>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(health?.gemini?.status)}`}>
                    {health?.gemini?.status === 'ONLINE' ? 'Connected' : 'Failed'}
                  </span>
                </div>
                {health?.gemini?.error ? (
                  <p className="mt-4 text-[11px] text-red-400 bg-red-500/5 p-2 rounded-xl border border-red-500/10 font-mono">
                    Error: {health.gemini.error}
                  </p>
                ) : (
                  <div className="mt-5 space-y-2 border-t border-zinc-900/80 pt-4 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Tested Prompt:</span>
                      <span className="text-zinc-300">"Reply only with OK"</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Response Text:</span>
                      <span className="text-emerald-400 font-bold">"{health?.gemini?.returnedText || ''}"</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Response Time:</span>
                      <span className="text-zinc-300">{health?.gemini?.responseTime}ms</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Telegram Bot Card */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between hover:border-zinc-800 transition-all">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">ALERT DISPATCH SYSTEM</span>
                    <h5 className="text-sm font-bold text-white">Telegram Bot</h5>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(health?.telegram?.status)}`}>
                    {health?.telegram?.status === 'ONLINE' ? 'Connected' : 'Failed'}
                  </span>
                </div>
                {health?.telegram?.error ? (
                  <p className="mt-4 text-[11px] text-red-400 bg-red-500/5 p-2 rounded-xl border border-red-500/10 font-mono">
                    Error: {health.telegram.error}
                  </p>
                ) : (
                  <div className="mt-5 space-y-2 border-t border-zinc-900/80 pt-4 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Bot Handle:</span>
                      <span className="text-zinc-300">{health?.telegram?.telegramResponse ? `@${health.telegram.telegramResponse}` : 'N/A'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Webhooks:</span>
                      <span className="text-emerald-400">ACTIVE</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Supabase DB Card */}
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between hover:border-zinc-800 transition-all">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">DURABLE CLOUD STORE</span>
                    <h5 className="text-sm font-bold text-white">Supabase Database</h5>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${getStatusColor(health?.supabase?.status)}`}>
                    {health?.supabase?.status === 'ONLINE' ? 'Connected' : 'Failed'}
                  </span>
                </div>
                <div className="mt-5 space-y-2 border-t border-zinc-900/80 pt-4 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Ping/Read Query:</span>
                    <span className="text-emerald-400">SUCCESS</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Latency Details:</span>
                    <span className="text-zinc-300">{health?.supabase?.details || 'N/A'}</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* System Metrics Grid */}
          <div>
            <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-4 font-mono">System Metrics</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              
              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">ACTIVE WATCHERS</span>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">{health?.stats?.watchers?.active || 0}</span>
                  <span className="text-xs text-zinc-500">/ {health?.stats?.watchers?.total || 0} total</span>
                </div>
                <span className="text-[10px] text-zinc-500 mt-2 font-mono">
                  Disabled: {health?.stats?.watchers?.disabled || 0}
                </span>
              </div>

              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">SIGNALS TODAY</span>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-emerald-400">{health?.stats?.signals?.sentToday || 0}</span>
                  <span className="text-xs text-zinc-500">sent successfully</span>
                </div>
                <span className="text-[10px] text-red-400 mt-2 font-mono">
                  Failed: {health?.stats?.signals?.failedToday || 0} (detected: {health?.stats?.signals?.detectedToday || 0})
                </span>
              </div>

              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">LAST ENGINE SCAN</span>
                <div className="mt-3">
                  <span className="text-xs font-semibold text-zinc-300 truncate block">
                    {health?.stats?.lastScan?.time !== 'Never' ? new Date(health?.stats?.lastScan?.time).toLocaleTimeString() : 'Never'}
                  </span>
                  <span className="text-[10px] text-zinc-500 mt-1 block font-mono">
                    Duration: {health?.stats?.lastScan?.duration || '0s'}
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 mt-2 font-mono truncate block">
                  Pairs: {health?.stats?.lastScan?.symbols || 'None'}
                </span>
              </div>

              <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-900 flex flex-col justify-between">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest font-mono">DAILY API LIMITS</span>
                <div className="mt-3 space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between text-zinc-300">
                    <span>Twelve Data:</span>
                    <span>{health?.stats?.apiUsage?.twelveDataUsed || 0} / 800</span>
                  </div>
                  <div className="flex justify-between text-zinc-300">
                    <span>Gemini AI:</span>
                    <span>{health?.stats?.apiUsage?.geminiUsed || 0} reqs</span>
                  </div>
                </div>
                <span className="text-[9px] text-zinc-500 mt-2 block uppercase tracking-wider font-mono">FREE LEVEL LIMIT QUOTAS</span>
              </div>

            </div>
          </div>

          {/* Historical Diagnostic Audit Logs */}
          <div className="bg-zinc-950 rounded-2xl border border-zinc-900 overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-zinc-900 flex justify-between items-center bg-zinc-900/10">
              <span className="text-xs font-black text-zinc-400 uppercase tracking-widest font-mono">DIAGNOSTIC AUDIT LOGS</span>
              <span className="text-[10px] font-mono text-zinc-500">Showing last 20 health events</span>
            </div>
            
            {(!health?.recentLogs || health.recentLogs.length === 0) ? (
              <div className="p-8 text-center text-xs text-zinc-500 font-mono">
                No diagnostic log history found. Click "Run Full System Test" to trigger a comprehensive system audit.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-zinc-900 bg-zinc-950 text-zinc-500 font-mono text-[10px]">
                      <th className="p-3">Timestamp</th>
                      <th className="p-3">Subsystem</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Latency</th>
                      <th className="p-3">Telemetry Log Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/60 font-mono">
                    {health.recentLogs.map((log: any, idx: number) => {
                      const isSuccess = log.status === 'ONLINE' || log.status === 'Healthy' || log.status === 'SUCCESS';
                      return (
                        <tr key={idx} className="hover:bg-zinc-900/20 text-zinc-300">
                          <td className="p-3 whitespace-nowrap text-zinc-500 text-[11px]">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                          <td className="p-3 font-semibold text-white whitespace-nowrap">
                            {log.service}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isSuccess ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              {log.status}
                            </span>
                          </td>
                          <td className="p-3 text-zinc-400 whitespace-nowrap">
                            {log.response_time_ms}ms
                          </td>
                          <td className="p-3 text-[11px] max-w-md truncate text-zinc-400" title={log.message || log.error}>
                            {log.message || log.error || 'N/A'}
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

      {/* FULL SYSTEM DIAGNOSTICS TESTER MODAL OVERLAY */}
      {isTesting && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-zinc-950 w-full max-w-xl rounded-2xl border border-zinc-900 shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            
            <div className="p-5 border-b border-zinc-900 flex justify-between items-center bg-zinc-900/20">
              <div className="flex items-center gap-2.5">
                <Terminal className="w-5 h-5 text-white animate-pulse" />
                <h4 className="text-sm font-bold text-white font-mono tracking-tight uppercase">Full System Diagnostic Suite</h4>
              </div>
              {!overallTestStatus && (
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Testing...</span>
                </div>
              )}
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <p className="text-xs text-zinc-400 font-sans leading-relaxed">
                Running a series of end-to-end integration workflows. Each tier performs real actions, fetches live values, prompts models, and logs operational telemetry.
              </p>

              {/* Progress Stepper List */}
              <div className="space-y-4 font-mono text-xs">
                
                {/* Step 1 */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  testStep > 1 ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                  testStep === 1 ? 'bg-zinc-900/40 border-zinc-800 text-white animate-pulse' :
                  'bg-zinc-900/10 border-transparent text-zinc-600'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">01.</span>
                    <span>Database Connection Ping Test</span>
                  </div>
                  <span>
                    {testStep > 1 ? '✓ ONLINE' : testStep === 1 ? 'PINGING...' : 'PENDING'}
                  </span>
                </div>

                {/* Step 2 */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  testStep > 2 ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                  testStep === 2 ? 'bg-zinc-900/40 border-zinc-800 text-white animate-pulse' :
                  'bg-zinc-900/10 border-transparent text-zinc-600'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">02.</span>
                    <span>Twelve Data Quote Fetch (EUR/USD)</span>
                  </div>
                  <span>
                    {testStep > 2 ? '✓ RECEIVED' : testStep === 2 ? 'FETCHING...' : 'PENDING'}
                  </span>
                </div>

                {/* Step 3 */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  testStep > 3 ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                  testStep === 3 ? 'bg-zinc-900/40 border-zinc-800 text-white animate-pulse' :
                  'bg-zinc-900/10 border-transparent text-zinc-600'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">03.</span>
                    <span>Gemini AI Signal Prompt Submission</span>
                  </div>
                  <span>
                    {testStep > 3 ? '✓ GENERATED' : testStep === 3 ? 'GENERATING...' : 'PENDING'}
                  </span>
                </div>

                {/* Step 4 */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  testStep > 4 ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                  testStep === 4 ? 'bg-zinc-900/40 border-zinc-800 text-white animate-pulse' :
                  'bg-zinc-900/10 border-transparent text-zinc-600'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">04.</span>
                    <span>Gemini Signal Validation & Logging</span>
                  </div>
                  <span>
                    {testStep > 4 ? '✓ COMPLETED' : testStep === 4 ? 'VALIDATING...' : 'PENDING'}
                  </span>
                </div>

                {/* Step 5 */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  testStep > 5 ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                  testStep === 5 ? 'bg-zinc-900/40 border-zinc-800 text-white animate-pulse' :
                  'bg-zinc-900/10 border-transparent text-zinc-600'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">05.</span>
                    <span>Telegram Alert Dispatch to Admin Chat</span>
                  </div>
                  <span>
                    {testStep > 5 ? '✓ BROADCASTED' : testStep === 5 ? 'SENDING...' : 'PENDING'}
                  </span>
                </div>

                {/* Step 6 */}
                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  overallTestStatus ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' :
                  testStep === 6 ? 'bg-zinc-900/40 border-zinc-800 text-white animate-pulse' :
                  'bg-zinc-900/10 border-transparent text-zinc-600'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">06.</span>
                    <span>Ecosystem Integrity Check Compilation</span>
                  </div>
                  <span>
                    {overallTestStatus ? '✓ VERIFIED' : testStep === 6 ? 'COMPILING...' : 'PENDING'}
                  </span>
                </div>

              </div>

              {/* Show Live Results or Error logs once finished */}
              {overallTestStatus && (
                <div className="mt-6 pt-5 border-t border-zinc-900 space-y-4">
                  
                  {/* Status Banner */}
                  <div className={`p-4 rounded-xl border flex items-center gap-3 ${
                    overallTestStatus === 'SYSTEM HEALTHY' 
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                      : 'bg-red-500/10 border-red-500/20 text-red-400'
                  }`}>
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <div>
                      <h5 className="font-mono text-xs font-black uppercase tracking-wider">{overallTestStatus}</h5>
                      <p className="text-[11px] opacity-90 mt-0.5">
                        {overallTestStatus === 'SYSTEM HEALTHY' 
                          ? 'All checks passed. Every tier of Gaks AI is operating fully.' 
                          : 'Operational warning: One or more tiers returned failed telemetry.'}
                      </p>
                    </div>
                  </div>

                  {/* Detail Panel */}
                  {testResults && (
                    <div className="bg-zinc-900/20 p-4 rounded-xl border border-zinc-900/80 font-mono text-[11px] space-y-3">
                      <div className="flex justify-between border-b border-zinc-900/50 pb-1.5">
                        <span className="text-zinc-500">Twelve Data quote:</span>
                        <span className="text-white">${testResults.twelveData?.price || 'Fetch Error'}</span>
                      </div>
                      <div className="border-b border-zinc-900/50 pb-1.5">
                        <span className="text-zinc-500 block mb-1">Gemini reasoning analysis:</span>
                        <span className="text-emerald-400 italic font-sans">"{testResults.gemini?.returnedText || 'Generation Error'}"</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Telegram dispatch:</span>
                        <span className="text-white truncate max-w-[280px]">
                          {testResults.telegram?.telegramResponse || testResults.telegram?.message || 'Error'}
                        </span>
                      </div>
                    </div>
                  )}

                  {testError && (
                    <div className="p-3.5 bg-red-500/5 border border-red-500/10 rounded-xl text-red-400 font-mono text-[11px]">
                      <b>Fatal Diagnostic Exception:</b> {testError}
                    </div>
                  )}

                </div>
              )}

            </div>

            <div className="p-5 border-t border-zinc-900 bg-zinc-900/10 flex justify-end">
              <button
                onClick={() => setIsTesting(false)}
                disabled={!overallTestStatus}
                className="px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-300 font-semibold text-xs rounded-xl hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-mono"
              >
                Close Diagnostic Suite
              </button>
            </div>

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
    defaultGeminiModel: "gemini-1.5-flash",
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
            className="w-full bg-[#0c0c0e] border border-zinc-900 text-xs font-semibold rounded-xl px-4 py-3 focus:outline-none focus:border-zinc-800 text-zinc-300"
          >
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Default / High Speed)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Reasoning)</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Legacy)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Legacy)</option>
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
            className="w-full bg-[#0c0c0e] border border-zinc-900 text-xs font-semibold rounded-xl px-4 py-3 focus:outline-none focus:border-zinc-800 text-zinc-300"
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
            className="w-full bg-[#0c0c0e] border border-zinc-900 text-xs font-semibold rounded-xl px-4 py-3 focus:outline-none focus:border-zinc-800 text-zinc-300 font-mono"
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
// Main Admin Component
// ----------------------------------------------------
export default function AdminDashboard({ userProfile, session, authLoading }: { userProfile: any, session: any, authLoading: boolean }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'dashboard' | 'users' | 'watchers' | 'signals' | 'health' | 'settings' | 'gemini-tester' | 'inspector'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

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
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'watchers', label: 'Watchers', icon: Eye },
    { id: 'signals', label: 'Signals', icon: Zap },
    { id: 'inspector', label: 'Strategy Inspector', icon: Terminal },
    { id: 'health', label: 'System Health', icon: Activity },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    { id: 'gemini-tester', label: 'Developer Tools', icon: Terminal },
  ];

  return (
    <div className="flex h-[90vh] bg-[#080808] border-t border-zinc-900 text-white rounded-t-3xl overflow-hidden mt-2 relative">
      
      {/* Sidebar for desktop, drawer for mobile */}
      <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0c0c0e] border-r border-zinc-900/80 transform transition-transform duration-200 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:relative md:h-full`}>
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
          <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">{activeAdminTab}</span>
          <div className="w-5" /> {/* Spacer */}
        </header>

        {/* Scrollable Subpage Frame */}
        <div className="flex-1 overflow-y-auto pb-16">
          {activeAdminTab === 'dashboard' && <DashboardPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'users' && <UsersPage fetchWithAuth={fetchWithAuth} showToast={showToast} />}
          {activeAdminTab === 'watchers' && <WatchersPage fetchWithAuth={fetchWithAuth} showToast={showToast} />}
          {activeAdminTab === 'signals' && <SignalsPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'inspector' && <StrategyEngineInspectorPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'health' && <SystemHealthPage fetchWithAuth={fetchWithAuth} />}
          {activeAdminTab === 'settings' && <SettingsPage fetchWithAuth={fetchWithAuth} showToast={showToast} />}
          {activeAdminTab === 'gemini-tester' && <GeminiTesterPage />}
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
