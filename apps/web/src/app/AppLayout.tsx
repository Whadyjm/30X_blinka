import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, CheckSquare, FileText, Inbox, LayoutDashboard, LogOut, Menu, MessageCircle, Plug, Settings, SlidersHorizontal, Trophy, X } from 'lucide-react';
import { api } from '@/api';
import { DemoBanner } from '@/components/DemoBanner';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/ui/Toast';
import { env } from '@/config/env';
import { invalidateMoney, useApprovals, useInbox, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';

// `label` is an English i18n key, translated at render time.
type NavItem = { to: string; label: string; icon: typeof MessageCircle; end?: boolean; badge?: number };

export function AppLayout() {
  const nav = useNavigate();
  const location = useLocation();
  const isChat = location.pathname === '/app' || location.pathname === '/app/';
  const qc = useQueryClient();
  const { data: me } = useMe();
  const approvals = useApprovals();
  const inbox = useInbox();
  const toast = useToast();
  const seenMail = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const mailScope = me?.org ? `${me.org.id}:${me.user.id}` : '';
  useEffect(() => {
    if (!mailScope || !inbox.data) return;
    const messages = inbox.data.messages;
    if (seenMail.current?.scope !== mailScope) {
      seenMail.current = { scope: mailScope, ids: new Set(messages.map(message => message.id)) };
      return;
    }
    const fresh = messages.filter(message => !seenMail.current!.ids.has(message.id));
    seenMail.current.ids = new Set([...seenMail.current.ids, ...messages.map(message => message.id)].slice(-200));
    if (!fresh.length) return;
    toast.notify(fresh.length === 1 ? t('New email from {sender}: {subject}', { sender: fresh[0]!.sender, subject: fresh[0]!.subject }) : t('{n} new emails arrived for Oli.', { n: fresh.length }), '/app/inbox');
    void invalidateMoney(qc);
  }, [mailScope, inbox.data, toast, qc]);
  const pending = approvals.data?.filter((a) => a.state === 'PENDING').length ?? 0;
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    try {
      await api.logout();
    } finally {
      qc.clear();
      nav('/login');
    }
  };

  const items: NavItem[] = [
    { to: '/app', label: 'Ask Oli', icon: MessageCircle, end: true },
    { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/inbox', label: 'Inbox', icon: Inbox, badge: inbox.data?.unreadCount ?? 0 },
    { to: '/app/bills', label: 'Bills', icon: FileText },
    { to: '/app/approvals', label: 'Approvals', icon: CheckSquare, badge: pending },
    { to: '/app/rules', label: 'Rules', icon: SlidersHorizontal },
    { to: '/app/integrations', label: 'Integrations', icon: Plug },
    { to: '/app/evaluation', label: 'Performance', icon: Trophy },
    { to: '/app/settings', label: 'Settings', icon: Settings },
    ...(env.features.agentAccess ? [{ to: '/app/agent-access', label: 'Agent access', icon: Bot }] : []),
  ];

  const links = (
    <nav aria-label={t('Main')} className="flex flex-col gap-1">
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn('oli-nav-link flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-highlighter text-on-accent' : 'text-slate-700 hover:bg-bone')
          }
        >
          <it.icon className="oli-nav-icon size-5" aria-hidden />
          <span className="flex-1">{t(it.label)}</span>
          {it.badge ? (
            <span className="rounded-md bg-ink px-2 py-0.5 text-xs text-on-ink" aria-label={t('{n} pending', { n: it.badge })}>
              {it.badge}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-paper p-4 lg:flex">
          <Link to="/app" className="mb-6 px-1">
            <Logo />
          </Link>
          {links}
          <div className="mt-auto space-y-3 border-t border-hairline pt-4 text-sm">
            <div>
              <p className="truncate text-ink">{me?.org?.name}</p>
              <p className="truncate text-xs text-slate-500">
                {me?.user.email} · {me?.role ? t(me.role) : ''}
              </p>
            </div>
            <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 text-slate-600 hover:text-ink">
              <LogOut className="size-4" aria-hidden /> {t('Sign out')}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-hairline bg-paper px-4 lg:hidden">
            <Link to="/app">
              <Logo />
            </Link>
            <div className="flex items-center gap-2">
              <button type="button" aria-label={open ? t('Close menu') : t('Open menu')} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="grid size-11 place-items-center rounded-md hover:bg-bone">
                {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
              </button>
            </div>
          </header>
          {open && (
            <div className="border-b border-hairline bg-paper p-3 lg:hidden">
              {links}
              <button type="button" onClick={signOut} className="mt-2 flex items-center gap-2 px-3 py-2 text-sm text-slate-600">
                <LogOut className="size-4" aria-hidden /> {t('Sign out')}
              </button>
            </div>
          )}
          <main className={cn('mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8', isChat && 'pb-0 lg:pb-6')}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
