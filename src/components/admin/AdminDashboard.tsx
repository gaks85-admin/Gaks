import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Eye, Zap, Activity, Settings as SettingsIcon, Shield, Menu, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';

const DashboardPage = () => {
  const [data, setData] = useState({ users: 0, active: 0, inactive: 0 });
  
  useEffect(() => {
    async function fetchData() {
        const { count: users } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
        const { count: active } = await supabase.from('watchers').select('*', { count: 'exact', head: true }).eq('status', 'active');
        const { count: inactive } = await supabase.from('watchers').select('*', { count: 'exact', head: true }).eq('status', 'inactive');
        setData({ users: users || 0, active: active || 0, inactive: inactive || 0 });
    }
    fetchData();
  }, []);
  
  return <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-white">
     <div className="bg-zinc-900 p-4 rounded-xl shadow-lg border border-zinc-800">
        <h3 className="text-sm text-zinc-400">Total Users</h3>
        <p className="text-2xl font-bold">{data.users}</p>
     </div>
     <div className="bg-zinc-900 p-4 rounded-xl shadow-lg border border-zinc-800">
        <h3 className="text-sm text-zinc-400">Active Watchers</h3>
        <p className="text-2xl font-bold">{data.active}</p>
     </div>
     <div className="bg-zinc-900 p-4 rounded-xl shadow-lg border border-zinc-800">
        <h3 className="text-sm text-zinc-400">Stopped Watchers</h3>
        <p className="text-2xl font-bold">{data.inactive}</p>
     </div>
  </div>;
}
const UsersPage = () => <div className="p-4 text-white">Users Content</div>;
const WatchersPage = () => <div className="p-4 text-white">Watchers Content</div>;
const SignalsPage = () => <div className="p-4 text-white">Signals Content</div>;
const SystemHealthPage = () => <div className="p-4 text-white">System Health Content</div>;
const SettingsPage = () => <div className="p-4 text-white">Settings Content</div>;

export default function AdminDashboard({ userProfile, session, authLoading }: { userProfile: any, session: any, authLoading: boolean }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'dashboard' | 'users' | 'watchers' | 'signals' | 'health' | 'settings'>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const ADMIN_EMAIL = "gaks6535@gmail.com";
  
  // Use email from profile, fallback to session
  const userEmail = (userProfile?.email || session?.user?.email)?.trim().toLowerCase();
  const isAdmin = userEmail === ADMIN_EMAIL.trim().toLowerCase();

  useEffect(() => {
    console.log("Admin auth check:");
    console.log("Auth loading:", authLoading);
    console.log("Authenticated userProfile email:", userProfile?.email);
    console.log("Authenticated session email:", session?.user?.email);
    console.log("Admin email:", ADMIN_EMAIL);
    console.log("Is admin:", isAdmin);
  }, [userProfile, session, authLoading, isAdmin]);

  if (authLoading) {
    return <div className="p-8 text-white text-center">Loading admin panel...</div>;
  }

  if (!isAdmin) {
    return <div className="p-8 text-white text-center">Unauthorized access. (Email: {userEmail})</div>;
  }

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'watchers', label: 'Watchers', icon: Eye },
    { id: 'signals', label: 'Signals', icon: Zap },
    { id: 'health', label: 'System Health', icon: Activity },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="flex h-screen bg-[#080808]">
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0c0c0e] border-r border-zinc-900 transform transition-transform duration-200 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-4 border-b border-zinc-900 flex justify-between items-center">
            <span className="text-white font-bold flex items-center gap-2"><Shield className="w-5 h-5 text-sky-400" /> Admin</span>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-zinc-400"><X /></button>
        </div>
        <nav className="p-4 space-y-2">
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setActiveAdminTab(item.id as any); setIsSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-sm font-semibold transition-colors ${activeAdminTab === item.id ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-950'}`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col md:ml-64">
        <header className="p-4 border-b border-zinc-900 flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-white"><Menu /></button>
            <h2 className="text-white font-bold capitalize">{activeAdminTab}</h2>
        </header>
        <main className="flex-1 overflow-y-auto">
          {activeAdminTab === 'dashboard' && <DashboardPage />}
          {activeAdminTab === 'users' && <UsersPage />}
          {activeAdminTab === 'watchers' && <WatchersPage />}
          {activeAdminTab === 'signals' && <SignalsPage />}
          {activeAdminTab === 'health' && <SystemHealthPage />}
          {activeAdminTab === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
