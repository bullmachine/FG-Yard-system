'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, MapPin, Truck, Users, Shield,
  Clock, LogOut, Menu, X, Factory, Package, Fence, Database, Layers,
  PanelLeftClose, PanelLeftOpen, BookOpen, Bell, Settings, ParkingCircle, Send,
  RotateCcw, LayoutGrid, LifeBuoy, Boxes, ClipboardList, PackageCheck, FileText, KeyRound, MessageSquareText, History
} from 'lucide-react';
import Dashboard from '@/components/Dashboard';
import DashboardV2 from '@/components/DashboardV2';
import YardManagement from '@/components/YardManagement';
import YardStock from '@/components/YardStock';
import DispatchPlanning from '@/components/DispatchPlanning';
import DispatchList from '@/components/DispatchList';
import MachineTracking from '@/components/MachineTracking';
import AssemblyLine from '@/components/AssemblyLine';
import FertCategories from '@/components/FertCategories';
import VehicleModelMasters from '@/components/VehicleModelMasters';
import MaterialMasters from '@/components/MaterialMasters';
import Drivers from '@/components/Drivers';
import UserManagement from '@/components/UserManagement';
import GateControl from '@/components/GateControl';
import SecurityVerification from '@/components/SecurityVerification';
import DriverParked from '@/components/DriverParked';
import MovementHistory from '@/components/MovementHistory';
import ExitRequests from '@/components/ExitRequests';
import MachineReturns from '@/components/MachineReturns';
import ProcessFlowDocument from '@/components/ProcessFlowDocument';
import SopDocument from '@/components/SopDocument';
import RoleAccess from '@/components/RoleAccess';
import FeedbackAdmin, { FeedbackButton } from '@/components/Feedback';
import LoginHistory from '@/components/LoginHistory';
import NotificationCenter, { NotificationBell } from '@/components/NotificationCenter';
import SettingsPage from '@/components/SettingsPage';
import UserGuide from '@/components/UserGuide';
import { asset } from '@/lib/basePath';

type Tab = 'dashboard' | 'dashboard2' | 'yards' | 'stock' | 'dispatch' | 'pdi' | 'machines' | 'assembly' | 'fert' | 'models' | 'materials' | 'drivers' | 'users' | 'settings' | 'access' | 'feedback' | 'logins' | 'gate' | 'security' | 'parked' | 'history' | 'requests' | 'returns' | 'docs' | 'sop' | 'notifications' | 'help';

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  dashboard: <LayoutDashboard className="w-5 h-5" />,
  dashboard2: <LayoutGrid className="w-5 h-5" />,
  yards: <MapPin className="w-5 h-5" />,
  stock: <Boxes className="w-5 h-5" />,
  dispatch: <ClipboardList className="w-5 h-5" />,
  pdi: <PackageCheck className="w-5 h-5" />,
  machines: <Truck className="w-5 h-5" />,
  assembly: <Factory className="w-5 h-5" />,
  fert: <Package className="w-5 h-5" />,
  models: <Layers className="w-5 h-5" />,
  materials: <Database className="w-5 h-5" />,
  drivers: <Users className="w-5 h-5" />,
  users: <Users className="w-5 h-5" />,
  settings: <Settings className="w-5 h-5" />,
  access: <KeyRound className="w-5 h-5" />,
  feedback: <MessageSquareText className="w-5 h-5" />,
  logins: <History className="w-5 h-5" />,
  gate: <Fence className="w-5 h-5" />,
  security: <Shield className="w-5 h-5" />,
  parked: <ParkingCircle className="w-5 h-5" />,
  history: <Clock className="w-5 h-5" />,
  requests: <Send className="w-5 h-5" />,
  returns: <RotateCcw className="w-5 h-5" />,
  docs: <BookOpen className="w-5 h-5" />,
  sop: <FileText className="w-5 h-5" />,
  help: <LifeBuoy className="w-5 h-5" />,
  notifications: <Bell className="w-5 h-5" />,
};

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  dashboard2: 'Dashboard (New)',
  yards: 'FG Yard',
  stock: 'Yard Stock',
  dispatch: 'Dispatch Planning',
  pdi: 'Dispatch Machine List',
  machines: 'Machine Tracking',
  assembly: 'Assembly Line',
  fert: 'FERT Categories',
  models: 'Vehicle Models',
  materials: 'Material Master',
  drivers: 'Drivers',
  users: 'User Management',
  settings: 'Settings',
  access: 'Role Access',
  feedback: 'Feedback',
  logins: 'Login History',
  gate: 'Gate Control',
  security: 'Security',
  parked: 'Confirm Parking',
  history: 'Movement History',
  requests: 'Exit Requests',
  returns: 'Returns',
  docs: 'Docs',
  sop: 'SOP',
  help: 'Help & User Guide',
  notifications: 'Notifications',
};

const TAB_SECTIONS: { label: string; tabs: Tab[] }[] = [
  { label: 'OVERVIEW', tabs: ['dashboard', 'dashboard2'] },
  { label: 'OPERATIONS', tabs: ['yards', 'stock', 'dispatch', 'pdi', 'machines', 'assembly', 'fert', 'models', 'materials', 'drivers'] },
  { label: 'ADMINISTRATION', tabs: ['users', 'settings', 'access', 'feedback', 'logins'] },
  { label: 'CONTROL', tabs: ['gate', 'parked', 'security', 'returns', 'requests', 'history'] },
  { label: 'DOCUMENTATION', tabs: ['help', 'docs', 'sop', 'notifications'] },
];

// Pages whose access is set per role on the Role Access page (permission page.<tab>).
// The Admin-only pages are fixed in code; Help, Docs, SOP and Notifications are open.
const PERMISSION_TABS: Tab[] = ['dashboard', 'yards', 'stock', 'dispatch', 'pdi', 'machines', 'assembly', 'fert', 'models', 'materials', 'drivers', 'gate', 'parked', 'security', 'returns', 'requests', 'history'];
const ADMIN_ONLY_TABS: Tab[] = ['users', 'settings', 'access', 'feedback', 'logins'];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'bg-blue-600',
  YARD_MANAGER: 'bg-emerald-600',
  OPERATOR: 'bg-amber-600',
  SERVICE_TECHNICIAN: 'bg-orange-600',
  SECURITY: 'bg-red-600',
  VIEW_ONLY: 'bg-slate-500',
  DRIVER: 'bg-cyan-600',
  PLANNER: 'bg-violet-600',
  PDI: 'bg-teal-600',
  MAIN_GATE: 'bg-rose-600',
};

interface SidebarUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface SidebarContentProps {
  allowedTabs: Tab[];
  activeTab: Tab;
  collapsed: boolean;
  user: SidebarUser | null;
  isAuthenticated: boolean;
  onToggle: () => void;
  onSelect: (tab: Tab) => void;
  onLogout: () => void;
}

const ROLE_NAMES: Record<string, string> = {
  ADMIN: 'Administrator', YARD_MANAGER: 'Yard Manager', OPERATOR: 'Operator', SERVICE_TECHNICIAN: 'Service Technician',
  SECURITY: 'Security', VIEW_ONLY: 'View Only', DRIVER: 'Driver', PLANNER: 'Dispatch Planner', PDI: 'PDI Team', MAIN_GATE: 'Main Gate',
};

/** Which menu section a page sits in, for the top-bar breadcrumb. */
function sectionOf(tab: Tab): string {
  const label = TAB_SECTIONS.find((s) => s.tabs.includes(tab))?.label ?? '';
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function SidebarContent({ allowedTabs, activeTab, collapsed, user, isAuthenticated, onToggle, onSelect, onLogout }: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full">
      {/* The logo in its real colours on a small white tag, so the black bull and red
          letters stay readable on the dark sidebar. */}
      {collapsed ? (
        <div className="py-5 px-3 flex justify-center">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-white">
            <img src={asset("/company-logo-mark.png")} alt="BULL" className="h-4 w-4 object-contain" />
          </span>
        </div>
      ) : (
        <div className="px-5 pt-5 pb-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded bg-white px-1.5 py-1">
              <img src={asset("/company-logo.png")} alt="BULL" className="block h-3 w-auto max-w-[65px] object-contain select-none" />
            </span>
            <button onClick={onToggle} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Collapse sidebar">
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-white truncate">FG Yard</h1>
            <p className="text-[10px] text-slate-400 truncate">Machine Location System</p>
          </div>
        </div>
      )}

      {collapsed && (
        <div className="flex justify-center pb-3">
          <button onClick={onToggle} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Expand sidebar">
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}

      <nav className={`flex-1 overflow-y-auto sidebar-scrollbar pb-2 ${collapsed ? 'px-2 space-y-3' : 'px-3 space-y-3.5'}`}>
        {TAB_SECTIONS.map(section => {
          const visibleTabs = section.tabs.filter(t => allowedTabs.includes(t));
          if (visibleTabs.length === 0) return null;
          return (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-2.5 mb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.08em]">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleTabs.map(tab => (
                  <button
                    key={tab}
                    title={collapsed ? TAB_LABELS[tab] : undefined}
                    onClick={() => onSelect(tab)}
                    aria-current={activeTab === tab ? 'page' : undefined}
                    className={`group relative w-full flex items-center py-1.5 rounded-lg text-[13px] font-medium transition-colors [&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:shrink-0 ${
                      activeTab === tab
                        ? 'bg-white/10 text-white [&>svg]:text-amber-400'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
                    } ${collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'}`}
                  >
                    {activeTab === tab && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-amber-400" aria-hidden="true" />}
                    {TAB_ICONS[tab]}
                    {!collapsed && <span className="truncate">{TAB_LABELS[tab]}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {isAuthenticated && user && (
        <div className={`border-t border-white/10 py-3 ${collapsed ? 'px-2 flex flex-col items-center gap-2' : 'px-3'}`}>
          <div className={`flex items-center gap-2.5 w-full ${collapsed ? '' : 'rounded-lg bg-white/5 px-2 py-1.5'}`}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 ring-2 ring-white/10 flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {user.name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-white truncate">{user.name}</p>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${ROLE_COLORS[user.role] || 'bg-slate-500'}`} />
                    <p className="text-[10px] text-slate-400 truncate">{ROLE_NAMES[user.role] ?? user.role}</p>
                  </div>
                </div>
                <button onClick={onLogout} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Logout">
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
          {collapsed && (
            <button onClick={onLogout} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('sidebarCollapsed') !== '0';
  });
  const { user, logout, isAuthenticated, can } = useAuth();
  const router = useRouter();

  const roleTabs: Tab[] = isAuthenticated
    ? [...PERMISSION_TABS.filter((t) => can(`page.${t}`)), ...(user?.role === 'ADMIN' ? ADMIN_ONLY_TABS : [])]
    : [];
  // Help is open to everyone, signed in or not, so a new user can read it first.
  const allowedTabs: Tab[] = isAuthenticated
    ? [...roleTabs, 'help', 'docs', 'sop', 'notifications']
    : ['help'];
  // A role without the dashboard (the main gate) opens on its first screen instead.
  const effectiveTab = allowedTabs.includes(activeTab) ? activeTab : allowedTabs[0];

  // Not signed in (first visit, or after logout): go to the login page. The session
  // check has already finished when this renders, so this never fires for a signed-in user.
  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  const toggleSidebar = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
      return next;
    });
  };

  const handleSelect = (tab: Tab) => {
    if (!allowedTabs.includes(tab)) return;
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  const renderContent = () => {
    switch (effectiveTab) {
      case 'dashboard': return <Dashboard onNavigate={(tab) => handleSelect(tab as Tab)} allowedTabs={allowedTabs} />;
      case 'dashboard2': return <DashboardV2 />;
      case 'yards': return <YardManagement />;
      case 'stock': return <YardStock />;
      case 'dispatch': return <DispatchPlanning />;
      case 'pdi': return <DispatchList />;
      case 'machines': return <MachineTracking />;
      case 'assembly': return <AssemblyLine />;
      case 'fert': return <FertCategories />;
      case 'models': return <VehicleModelMasters />;
      case 'materials': return <MaterialMasters />;
      case 'drivers': return <Drivers />;
      case 'users': return <UserManagement />;
      case 'settings': return <SettingsPage />;
      case 'access': return <RoleAccess />;
      case 'feedback': return <FeedbackAdmin />;
      case 'logins': return <LoginHistory />;
      case 'gate': return <GateControl onNavigate={(tab) => handleSelect(tab as Tab)} />;
      case 'security': return <SecurityVerification />;
      case 'parked': return <DriverParked />;
      case 'history': return <MovementHistory />;
      case 'requests': return <ExitRequests />;
      case 'returns': return <MachineReturns />;
      case 'docs': return <ProcessFlowDocument />;
      case 'sop': return <SopDocument />;
      case 'notifications': return <NotificationCenter />;
      case 'help': return <UserGuide onNavigate={(tab) => handleSelect(tab as Tab)} allowedTabs={allowedTabs} />;
      default: return <Dashboard />;
    }
  };

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex lg:flex-col bg-gradient-to-b from-slate-900 to-slate-950 border-r border-white/5 fixed inset-y-0 left-0 z-30 transition-all duration-200 ${collapsed ? 'lg:w-[68px]' : 'lg:w-60'}`}>
        <SidebarContent
          allowedTabs={allowedTabs}
          activeTab={effectiveTab}
          collapsed={collapsed}
          user={user}
          isAuthenticated={isAuthenticated}
          onToggle={toggleSidebar}
          onSelect={handleSelect}
          onLogout={logout}
        />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px] z-40 lg:hidden animate-fade-in" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 max-w-[85vw] bg-gradient-to-b from-slate-900 to-slate-950 z-50 lg:hidden flex flex-col animate-page">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <SidebarContent
              allowedTabs={allowedTabs}
              activeTab={effectiveTab}
              collapsed={false}
              user={user}
              isAuthenticated={isAuthenticated}
              onToggle={toggleSidebar}
              onSelect={handleSelect}
              onLogout={logout}
            />
          </aside>
        </>
      )}

      {/* Main content */}
      {/* min-w-0 lets this flex child shrink below its content width, so a wide
          table scrolls inside its own box instead of widening the whole page. */}
      <div className={`flex-1 min-w-0 flex flex-col min-h-screen transition-all duration-200 ${collapsed ? 'lg:pl-[68px]' : 'lg:pl-60'}`}>
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="flex items-center justify-between h-12 px-4 lg:px-5">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex items-center gap-1.5 text-sm">
                {sectionOf(effectiveTab) && (
                  <>
                    <span className="hidden sm:inline text-slate-400">{sectionOf(effectiveTab)}</span>
                    <span className="hidden sm:inline text-slate-300" aria-hidden="true">/</span>
                  </>
                )}
                <h2 className="font-semibold text-slate-900 truncate">{TAB_LABELS[effectiveTab]}</h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAuthenticated && <FeedbackButton page={TAB_LABELS[effectiveTab]} />}
              {isAuthenticated && <NotificationBell />}
              {isAuthenticated && user && (
                <div className="hidden md:flex items-center gap-2 border-l border-slate-200 pl-3 ml-1">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-[11px] font-semibold text-white">
                    {user.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <div className="leading-tight">
                    <p className="text-xs font-semibold text-slate-800 max-w-[140px] truncate">{user.name}</p>
                    <p className="text-[10px] text-slate-500">{ROLE_NAMES[user.role] ?? user.role}</p>
                  </div>
                </div>
              )}
              {!isAuthenticated && (
                <button
                  onClick={() => router.push('/login')}
                  className="px-3 py-1.5 bg-blue-700 text-white text-xs font-medium rounded-lg hover:bg-blue-800 transition-colors"
                >
                  Sign In
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 lg:px-6 py-4 lg:py-5">
          {/* key restarts the fade-in on every page change. */}
          <div key={effectiveTab} className="max-w-[1600px] mx-auto animate-page">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}