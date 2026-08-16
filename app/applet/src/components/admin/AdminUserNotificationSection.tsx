import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, Send, Mail, MessageSquare, AlertTriangle, CheckCircle2, 
  Loader2, User, Phone, AtSign, Check, X, ShieldAlert 
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

  const searchTimeoutRef = useRef<any>(null);

  // Debounced search trigger or button click
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
        if (data.users.length === 0) {
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
    // Auto-select first available channel
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

  // Message validation
  const trimmedMessage = message.trim();
  const isValidMessage = trimmedMessage.length > 0 && trimmedMessage.length <= 2000;
  
  const isChannelAvailable = selectedUser && channel && (
    (channel === 'telegram' && selectedUser.telegram_available) ||
    (channel === 'email' && selectedUser.email_available)
  );

  const canSend = selectedUser && isValidMessage && isChannelAvailable && !sending;

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
        const successMsg = data.message || `Notification sent successfully via ${channel === 'telegram' ? 'Telegram' : 'Email'}.`;
        setDeliveryResult({ success: true, message: successMsg });
        if (showToast) {
          showToast(successMsg, 'success');
        }
        setMessage(''); // Clear composer after success
      } else {
        const errorMsg = data.error || 'Failed to deliver notification.';
        setDeliveryResult({ success: false, message: errorMsg });
        if (showToast) {
          showToast(errorMsg, 'error');
        }
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

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="pb-4 border-b border-zinc-200 dark:border-zinc-800/80">
        <h3 className="text-base font-bold text-zinc-900 dark:text-white flex items-center gap-2">
          <Send className="w-5 h-5 text-sky-400" /> User Notifications
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
          Search for a specific user by email, WhatsApp ID, or Telegram ID, and send a direct administrator notification.
        </p>
      </div>

      {/* 1. User Search Bar */}
      <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4">
        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
          User Search
        </label>
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchInputChange}
              placeholder="Search user by email, WhatsApp ID, or Telegram ID"
              className="w-full pl-10 pr-4 py-2.5 text-xs font-medium bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
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
          <div className="p-4 text-center text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span>Searching user database...</span>
          </div>
        )}

        {/* Error / No User Found State */}
        {!loading && searchError && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400 text-xs font-medium flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{searchError}</span>
          </div>
        )}

        {/* 2. User Search Results List */}
        {!loading && searchResults && searchResults.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                Matching Users Found ({searchResults.length})
              </span>
              <span>Select exactly one user to compose notification</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 max-h-72 overflow-y-auto pr-1">
              {searchResults.map((user) => {
                const isSelected = selectedUser?.id === user.id;
                return (
                  <div
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className={`p-4 rounded-xl border text-xs transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-sky-500/10 border-sky-500/50 shadow-sm'
                        : 'bg-zinc-50 dark:bg-zinc-950/60 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-bold text-zinc-900 dark:text-zinc-100">
                        <AtSign className="w-3.5 h-3.5 text-sky-400" />
                        <span>Email: {user.email || 'N/A'}</span>
                        {user.full_name && (
                          <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                            ({user.full_name})
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        <div className="flex items-center gap-1">
                          <Phone className="w-3 h-3 text-emerald-400" />
                          <span>WhatsApp: {user.whatsapp || 'Not provided'}</span>
                        </div>

                        <div className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-sky-400" />
                          <span>Telegram: {user.telegram_username || (user.telegram_chat_id ? `ID: ${user.telegram_chat_id}` : 'Not connected')}</span>
                        </div>
                      </div>

                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
                        User ID: {user.id}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectUser(user);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          isSelected
                            ? 'bg-sky-500 text-white shadow-sm'
                            : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700'
                        }`}
                      >
                        {isSelected ? 'Selected' : 'Select User'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. Composer & Channel Selector (when a user is selected) */}
      {selectedUser && (
        <div className="bg-white dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-5 animate-fade-in">
          {/* Selected User Header */}
          <div className="flex items-center justify-between p-3.5 bg-sky-500/10 border border-sky-500/20 rounded-xl text-xs">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold">
              <User className="w-4 h-4 text-sky-400" />
              <span>Selected User: <strong className="text-sky-400">{selectedUser.email}</strong></span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">({selectedUser.id})</span>
            </div>
            <button
              onClick={handleDeselectUser}
              className="text-zinc-400 hover:text-zinc-200 p-1 transition-colors cursor-pointer"
              title="Change user"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSendNotification} className="space-y-5">
            {/* 4. Channel Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                Delivery Channel
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Telegram Option */}
                <button
                  type="button"
                  disabled={!selectedUser.telegram_available}
                  onClick={() => setChannel('telegram')}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                    channel === 'telegram'
                      ? 'bg-sky-500/10 border-sky-500 text-sky-400 shadow-sm'
                      : selectedUser.telegram_available
                      ? 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                      : 'bg-zinc-100 dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-400 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <MessageSquare className="w-4 h-4 text-sky-400" />
                    <div>
                      <div className="font-bold text-xs">Telegram</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {selectedUser.telegram_available
                          ? `Connected (${selectedUser.telegram_username || selectedUser.telegram_chat_id})`
                          : 'Telegram not connected'}
                      </div>
                    </div>
                  </div>
                  {channel === 'telegram' && <Check className="w-4 h-4 text-sky-400" />}
                </button>

                {/* Email Option */}
                <button
                  type="button"
                  disabled={!selectedUser.email_available}
                  onClick={() => setChannel('email')}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                    channel === 'email'
                      ? 'bg-sky-500/10 border-sky-500 text-sky-400 shadow-sm'
                      : selectedUser.email_available
                      ? 'bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                      : 'bg-zinc-100 dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-900 text-zinc-400 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-sky-400" />
                    <div>
                      <div className="font-bold text-xs">Email</div>
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {selectedUser.email_available
                          ? selectedUser.email
                          : 'Email unavailable'}
                      </div>
                    </div>
                  </div>
                  {channel === 'email' && <Check className="w-4 h-4 text-sky-400" />}
                </button>
              </div>
            </div>

            {/* Notification Message Composer */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Notification Message
                </label>
                <span
                  className={`text-[10px] font-mono ${
                    message.length > 2000 ? 'text-red-500 font-bold' : 'text-zinc-500'
                  }`}
                >
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
                placeholder="Enter administrator notification message to deliver..."
                className="w-full p-3.5 text-xs font-medium bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />

              <p className="text-[10px] text-zinc-500">
                Maximum message length: 2000 characters. Whitespace is automatically trimmed.
              </p>
            </div>

            {/* Delivery Feedback Banner */}
            {deliveryResult && (
              <div
                className={`p-4 rounded-xl text-xs font-medium flex items-center gap-2.5 ${
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

            {/* Send Action */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={!canSend}
                className="px-6 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:hover:bg-sky-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer shadow-sm"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>{sending ? 'Sending...' : 'Send Notification'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
