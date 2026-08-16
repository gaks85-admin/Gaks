import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Send, Mail, MessageSquare, AlertTriangle, CheckCircle2, 
  Loader2, Phone, Check, X, RefreshCw, History 
} from 'lucide-react';

export interface AdminUserResult {
  id: string;
  email: string;
  full_name: string | null;
  whatsapp: string | null;
  telegram_username: string | null;
  telegram_chat_id: string | null;
  telegram_connected: boolean;
  email_available: boolean;
  telegram_available: boolean;
}

export interface NotificationHistoryItem {
  id: string;
  recipient: string;
  channel: 'telegram' | 'email';
  status: 'SENT' | 'FAILED';
  message: string;
  sent_at: string;
  error_message?: string | null;
}

interface AdminUserNotificationSectionProps {
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  showToast?: (message: string, type?: 'success' | 'error') => void;
}

export function AdminUserNotificationSection({ fetchWithAuth, showToast }: AdminUserNotificationSectionProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<AdminUserResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserResult | null>(null);

  // Message composer state
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<'telegram' | 'email' | null>(null);
  const [sending, setSending] = useState(false);
  const [deliveryResult, setDeliveryResult] = useState<{ success: boolean; message: string } | null>(null);

  // History state
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const searchTimeoutRef = useRef<any>(null);

  // Load history on mount
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await fetchWithAuth('/api/admin/notifications/history');
      const data = await response.json();
      if (data.success && Array.isArray(data.history)) {
        setHistory(data.history);
      }
    } catch (err) {
      console.error('[Admin Notifications] Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Search execution
  const executeSearch = async (queryToSearch: string) => {
    const trimmed = queryToSearch.trim();
    if (!trimmed) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }

    setLoading(true);
    setSearchError(null);
    setDeliveryResult(null);

    try {
      const encoded = encodeURIComponent(trimmed);
      const response = await fetchWithAuth(`/api/admin/users/search?q=${encoded}`);
      const data = await response.json();

      if (data.success) {
        setSearchResults(data.users || []);
        if ((data.users || []).length === 0) {
          setSearchError('No matching user found.');
        }
      } else {
        setSearchError(data.error || 'Failed to search users.');
        setSearchResults([]);
      }
    } catch (err: any) {
      setSearchError(err.message || 'Network error while searching users.');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    setDeliveryResult(null);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!val.trim()) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      executeSearch(val);
    }, 400);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    executeSearch(searchQuery);
  };

  const handleSelectUser = (user: AdminUserResult) => {
    setSelectedUser(user);
    setDeliveryResult(null);
    if (user.telegram_available) {
      setChannel('telegram');
    } else if (user.email_available) {
      setChannel('email');
    } else {
      setChannel(null);
    }
  };

  const handleDeselectUser = () => {
    setSelectedUser(null);
    setDeliveryResult(null);
  };

  const trimmedMessage = message.trim();
  const isValidMessage = trimmedMessage.length > 0 && trimmedMessage.length <= 2000;
  
  const isChannelAvailable = Boolean(selectedUser && channel && (
    (channel === 'telegram' && selectedUser.telegram_available) ||
    (channel === 'email' && selectedUser.email_available)
  ));

  const canSend = Boolean(selectedUser && isValidMessage && isChannelAvailable && !sending);

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || !selectedUser || !channel) return;

    setSending(true);
    setDeliveryResult(null);

    try {
      const response = await fetchWithAuth('/api/admin/notifications/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          channel: channel,
          message: trimmedMessage
        })
      });

      const data = await response.json();

      if (data.success) {
        const successMsg = channel === 'telegram' 
          ? 'Notification sent successfully via Telegram.' 
          : 'Email submitted successfully.';
        setDeliveryResult({ success: true, message: successMsg });
        if (showToast) {
          showToast(successMsg, 'success');
        }
        setMessage('');
        fetchHistory();
      } else {
        const errorMsg = data.error || 'Failed to deliver notification.';
        setDeliveryResult({ success: false, message: errorMsg });
        if (showToast) {
          showToast(`Notification failed: ${errorMsg}`, 'error');
        }
        fetchHistory();
      }
    } catch (err: any) {
      const errMsg = err.message || 'Network failure sending notification.';
      setDeliveryResult({ success: false, message: errMsg });
      if (showToast) {
        showToast(errMsg, 'error');
      }
    } finally {
      setSending(false);
    }
  };

  const formatDateAgo = (isoDate: string) => {
    if (!isoDate) return 'Just now';
    try {
      const d = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return d.toLocaleDateString();
    } catch {
      return 'Recently';
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800/80">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
          <Send className="w-5 h-5 text-sky-400" /> User Notifications
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Search a user and send a direct notification through an available channel.
        </p>
      </div>

      {/* User Search & Selection Bar */}
      <div className="bg-white dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchInputChange}
              placeholder="Search email, Telegram ID, or WhatsApp ID..."
              className="w-full pl-10 pr-4 py-2.5 text-xs font-medium bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !searchQuery.trim()}
            className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 disabled:hover:bg-sky-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Search</span>
          </button>
        </form>

        {/* Loading State */}
        {loading && (
          <div className="p-3 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Searching database...</span>
          </div>
        )}

        {/* Error / No Result */}
        {!loading && searchError && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400 text-xs font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{searchError}</span>
          </div>
        )}

        {/* User Search Results */}
        {!loading && searchResults && searchResults.length > 0 && (
          <div className="space-y-2.5 pt-2">
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
              Matching Users ({searchResults.length})
            </span>
            <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
              {searchResults.map((user) => {
                const isSelected = selectedUser?.id === user.id;
                return (
                  <div
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className={`p-3.5 rounded-xl border text-xs transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-sky-500/10 border-sky-500/50 shadow-sm'
                        : 'bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                        <span>{user.email || 'No Email'}</span>
                        {user.full_name && (
                          <span className="text-[11px] font-normal text-zinc-500">({user.full_name})</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-sky-400" />
                          <span>Telegram: {user.telegram_available ? 'Connected' : 'Not connected'}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-emerald-400" />
                          <span>WhatsApp: {user.whatsapp ? 'Provided' : 'Not available'}</span>
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectUser(user);
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                        isSelected
                          ? 'bg-sky-500 text-white shadow-sm flex items-center gap-1'
                          : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>User selected</span>
                        </>
                      ) : (
                        'Select user'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Composer Section */}
      {selectedUser && (
        <div className="bg-white dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800/60">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Send Notification</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Recipient: <strong className="text-sky-400 font-semibold">{selectedUser.email}</strong>
              </p>
            </div>
            <button
              onClick={handleDeselectUser}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
              title="Change user"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSendNotification} className="space-y-4">
            {/* Channel Selection */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                Channel
              </label>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  disabled={!selectedUser.telegram_available}
                  onClick={() => setChannel('telegram')}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    channel === 'telegram'
                      ? 'bg-sky-500/10 border-sky-500 text-sky-400 shadow-sm'
                      : selectedUser.telegram_available
                      ? 'bg-zinc-50 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                      : 'bg-zinc-100 dark:bg-zinc-900/20 border-zinc-200 dark:border-zinc-900 text-zinc-400 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <MessageSquare className="w-4 h-4 text-sky-400" />
                  <span>Telegram</span>
                  {selectedUser.telegram_available ? (
                    <Check className={`w-3.5 h-3.5 ${channel === 'telegram' ? 'text-sky-400' : 'text-zinc-500'}`} />
                  ) : (
                    <span className="text-[10px] font-normal text-zinc-500">(Not connected)</span>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!selectedUser.email_available}
                  onClick={() => setChannel('email')}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    channel === 'email'
                      ? 'bg-sky-500/10 border-sky-500 text-sky-400 shadow-sm'
                      : selectedUser.email_available
                      ? 'bg-zinc-50 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                      : 'bg-zinc-100 dark:bg-zinc-900/20 border-zinc-200 dark:border-zinc-900 text-zinc-400 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Mail className="w-4 h-4 text-sky-400" />
                  <span>Email</span>
                  {selectedUser.email_available ? (
                    <Check className={`w-3.5 h-3.5 ${channel === 'email' ? 'text-sky-400' : 'text-zinc-500'}`} />
                  ) : (
                    <span className="text-[10px] font-normal text-zinc-500">(Unavailable)</span>
                  )}
                </button>
              </div>
            </div>

            {/* Message Textarea */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                  Message
                </label>
                <span className={`text-[10px] font-mono ${message.length > 2000 ? 'text-red-500 font-bold' : 'text-zinc-500'}`}>
                  {message.length} / 2000
                </span>
              </div>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setDeliveryResult(null);
                }}
                maxLength={2000}
                placeholder="Type your notification..."
                className="w-full p-3.5 text-xs font-medium bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>

            {/* Delivery Feedback Banner */}
            {deliveryResult && (
              <div
                className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 ${
                  deliveryResult.success
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/10 border border-red-500/20 text-red-400'
                }`}
              >
                {deliveryResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{deliveryResult.message}</span>
              </div>
            )}

            {/* Send Button */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={!canSend}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:hover:bg-sky-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{sending ? 'Sending Notification...' : 'Send Notification'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Notification History Section */}
      <div className="bg-white dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl p-4 sm:p-5 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
              Recent Notifications
            </h3>
          </div>
          <button
            onClick={fetchHistory}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Refresh history"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {historyLoading && history.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Loading history...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="p-6 text-center text-xs text-zinc-500 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
            No recent notifications found.
          </div>
        ) : (
          <div className="space-y-2 overflow-x-auto">
            <div className="min-w-[500px]">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="py-2.5 px-3 border-b border-zinc-100 dark:border-zinc-900/60 last:border-0 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-200 truncate max-w-[180px]">
                      {item.recipient}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      item.channel === 'telegram'
                        ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    }`}>
                      {item.channel === 'telegram' ? 'Telegram' : 'Email'}
                    </span>
                    <span className="text-[11px] text-zinc-500 truncate max-w-[220px]" title={item.message}>
                      {item.message}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === 'SENT' || item.status === 'sent'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}
                      title={item.error_message || undefined}
                    >
                      {item.status === 'SENT' || item.status === 'sent' ? 'Sent' : 'Failed'}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {formatDateAgo(item.sent_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
