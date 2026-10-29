import { useRef, type MouseEvent, type ReactNode } from 'react';

import { useI18n } from '../lib/i18n';
import type { StringKey } from '../lib/strings';
import type { Page } from '../main/pages';

interface NavLinkProps {
  page: Page;
  current: Page;
  label: StringKey;
  children: ReactNode;
}

function NavLink({ page, current, label, children }: NavLinkProps) {
  const { t } = useI18n();
  const tooltip = useRef<HTMLSpanElement>(null);

  // Tooltips are fixed-position, so place each next to its link on hover.
  function placeTooltip(event: MouseEvent<HTMLAnchorElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!tooltip.current) return;
    tooltip.current.style.left = `${rect.right + 14}px`;
    tooltip.current.style.top = `${rect.top + rect.height / 2}px`;
  }

  return (
    <a
      className={`nav-link${page === current ? ' active' : ''}`}
      href={`#${page}`}
      onMouseEnter={placeTooltip}
    >
      {children}
      <span className="nav-tooltip" ref={tooltip}>
        {t(label)}
      </span>
    </a>
  );
}

export function Sidebar({ current }: { current: Page }) {
  return (
    <nav className="sidebar">
      <div className="logo sidebar-logo">
        <svg viewBox="0 0 24 24">
          <path d="M5 10v4M8.5 7v10M12 4v16M15.5 8v8M19 10.5v3" />
        </svg>
      </div>
      <div className="nav-list">
        <NavLink page="voice-translation" current={current} label="nav.translation">
          <svg viewBox="0 0 24 24">
            <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
          </svg>
        </NavLink>
        <NavLink page="voice-clone" current={current} label="nav.clone">
          <svg viewBox="0 0 24 24">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
          </svg>
        </NavLink>
      </div>
      <NavLink page="settings" current={current} label="nav.settings">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </NavLink>
    </nav>
  );
}
