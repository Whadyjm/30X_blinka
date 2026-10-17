import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, CheckSquare, FileText, Home, Inbox, LogOut, Menu, MessageCircle, Plug, SlidersHorizontal, Trophy, X } from 'lucide-react';
import { api } from '@/api';
import { DemoBanner } from '@/components/DemoBanner';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Logo } from '@/components/Logo';
import { env } from '@/config/env';
import { useApprovals, useInbox, useMe } from '@/hooks/queries';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';

// `label` is an English i18n key, translated at render time.
type NavItem = { to: string; label: string; icon: typeof Home; end?: boolean; badge?: number };

export function AppLayout() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const approvals = useApprovals();
  const inbox = useInbox();
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
    { to: '/app', label: 'Home', icon: Home, end: true },
    { to: '/app/inbox', label: 'Inbox', icon: Inbox, badge: inbox.data?.unreadCount ?? 0 },
    { to: '/app/bills', label: 'Bills', icon: FileText },
    { to: '/app/approvals', label: 'Approvals', icon: CheckSquare, badge: pending },
    { to: '/app/rules', label: 'Rules', icon: SlidersHorizontal },
    { to: '/app/integrations', label: 'Integrations', icon: Plug },
    { to: '/app/evaluation', label: 'Evaluation', icon: Trophy },
    ...(env.features.agentAccess ? [{ to: '/app/agent-access', label: 'Agent access', icon: Bot }] : []),
    ...(env.features.chat ? [{ to: '/app/chat', label: 'Chat', icon: MessageCircle }] : []),
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
            cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-highlighter text-ink' : 'text-slate-700 hover:bg-bone')
          }
        >
          <it.icon className="size-5" aria-hidden />
          <span className="flex-1">{t(it.label)}</span>
          {it.badge ? (
            <span className="rounded-md bg-ink px-2 py-0.5 text-xs text-white" aria-label={t('{n} pending', { n: it.badge })}>
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
        <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-white p-4 lg:flex">
          <Link to="/app" className="mb-6 px-1">
            <Logo />
          </Link>
          {links}
          <div className="mt-auto space-y-3 border-t border-hairline pt-4 text-sm">
            <LanguageSwitcher />
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
          <header className="flex items-center justify-between border-b border-hairline bg-white px-4 py-3 lg:hidden">
            <Link to="/app">
              <Logo />
            </Link>
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <button type="button" aria-label={open ? t('Close menu') : t('Open menu')} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-md p-2 hover:bg-bone">
                {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
              </button>
            </div>
          </header>
          {open && (
            <div className="border-b border-hairline bg-white p-3 lg:hidden">
              {links}
              <button type="button" onClick={signOut} className="mt-2 flex items-center gap-2 px-3 py-2 text-sm text-slate-600">
                <LogOut className="size-4" aria-hidden /> {t('Sign out')}
              </button>
            </div>
          )}
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
