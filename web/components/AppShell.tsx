'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, ChevronDown, CircleCheckBig, FileText, House, LogOut, Menu, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { keys, useDashboard, useMe, useNotifications } from '@/lib/queries';
import { useConnectionState, useRealtime } from '@/lib/realtime';
import { Avatar } from './ui';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/login';
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!isLogin && unauthenticated) router.replace('/login');
  }, [isLogin, unauthenticated, router]);
  useEffect(() => setNavOpen(false), [pathname]);
  useRealtime(!isLogin && !!me.data);

  if (isLogin) return <>{children}</>;
  if (!me.data) {
    return <div className="center">{me.error && !unauthenticated ? 'Cannot reach the server — retrying…' : 'Loading…'}</div>;
  }

  const roleLine = me.data.isAdmin
    ? 'Administrator'
    : me.data.teams.length
      ? me.data.teams.map((t) => `${t.name} · ${t.role}`).join(', ')
      : 'No team (requester)';

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <Link href="/" className="logo">
          OpsDesk
        </Link>
        <Suspense>
          <Nav isLead={me.data.isAdmin || me.data.teams.some((t) => t.role === 'lead')} />
        </Suspense>
        <LiveIndicator />
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setNavOpen((o) => !o)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <SearchBox />
          <div className="topbar-right">
            <Link href="/items/new" className="btn btn-primary">
              <Plus size={18} /> <span className="btn-label">Create work item</span>
            </Link>
            <NotificationsMenu />
            <UserMenu name={me.data.name} roleLine={roleLine} />
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}

function Nav({ isLead }: { isLead: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const view = pathname === '/items' ? (params.get('view') ?? 'all') : null;
  const dashboard = useDashboard();
  const approvals = dashboard.data?.sections.find((s) => s.view === 'approvals')?.count ?? 0;

  const items = [
    { href: '/', label: 'Overview', icon: House, active: pathname === '/' },
    { href: '/items', label: 'All work', icon: FileText, active: view === 'all' || (pathname.startsWith('/items/') && pathname !== '/items/new') },
    { href: '/items?view=mine', label: 'My work', icon: CircleCheckBig, active: view === 'mine' },
    { href: '/items?view=unassigned', label: 'Team queue', icon: Users, active: view === 'unassigned' },
    ...(isLead ? [{ href: '/items?view=approvals', label: 'Approvals', icon: ShieldCheck, active: view === 'approvals', count: approvals }] : []),
    { href: '/insights', label: 'Insights', icon: BarChart3, active: pathname === '/insights' },
  ];
  return (
    <nav aria-label="Main">
      {items.map(({ href, label, icon: Icon, active, ...rest }) => (
        <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
          <Icon size={20} strokeWidth={1.8} />
          {label}
          {'count' in rest && rest.count ? <span className="nav-count">{rest.count > 999 ? '999+' : rest.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(`/items?q=${encodeURIComponent(q)}&sort=recent`);
  };
  return (
    <form onSubmit={submit} className="search" role="search">
      <Search size={17} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search problems, tasks, or #number…" aria-label="Search work items" />
    </form>
  );
}

function LiveIndicator() {
  const state = useConnectionState();
  const label = { live: 'Live updates on', connecting: 'Connecting…', offline: 'Offline — retrying' }[state];
  return (
    <div className={`sidebar-foot live-${state}`} title={state === 'live' ? 'Changes by others appear automatically' : label}>
      <span className="live-dot" /> {label}
    </div>
  );
}

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onOutside]);
  return ref;
}

function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const qc = useQueryClient();
  const { data } = useNotifications();
  const markAll = async () => {
    await request('/api/notifications/read', { method: 'POST', json: {} });
    qc.invalidateQueries({ queryKey: keys.notifications });
  };
  return (
    <div className="relative bell" ref={ref}>
      <button className="btn btn-ghost btn-icon" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
        <Bell size={20} />
      </button>
      {!!data?.unread && <span className="bell-dot" />}
      {open && (
        <div className="dropdown notif">
          <div className="dropdown-head">
            <strong>Notifications {data?.unread ? <span className="muted small">· {data.unread} unread</span> : null}</strong>
            {!!data?.unread && (
              <button className="link small" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          {!data?.notifications.length && <p className="empty">You are all caught up.</p>}
          {data?.notifications.map((n) => (
            <Link key={n.id} href={n.item_id ? `/items/${n.item_id}` : '#'} className={`notif-row ${n.read_at ? '' : 'unread'}`} onClick={() => setOpen(false)}>
              <span>{n.message}</span>
              <span className="muted small">{relativeTime(n.created_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({ name, roleLine }: { name: string; roleLine: string }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const qc = useQueryClient();
  const router = useRouter();
  const logout = async () => {
    await request('/api/auth/logout', { method: 'POST', json: {} }).catch(() => {});
    qc.clear();
    router.replace('/login');
  };
  return (
    <div className="relative" ref={ref}>
      <button className="user-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={name} large />
        <span className="user-meta">
          <strong>{name}</strong>
          <span>{roleLine.length > 34 ? `${roleLine.slice(0, 32)}…` : roleLine}</span>
        </span>
        <ChevronDown size={16} className="hide-sm" />
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            <div>
              <strong>{name}</strong>
              <div className="muted small">{roleLine}</div>
            </div>
          </div>
          <button className="dropdown-item" onClick={logout} role="menuitem">
            <LogOut size={16} /> Switch user
          </button>
        </div>
      )}
    </div>
  );
}
