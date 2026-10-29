import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface DropdownProps<T extends string> {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange(value: NoInfer<T>): void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

const GAP = 6;
const MARGIN = 8;

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  title,
  className = '',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ style: CSSProperties; up: boolean }>({
    style: {},
    up: false,
  });
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const selected = options.findIndex((option) => option.value === value);

  const close = () => setOpen(false);

  function show() {
    if (disabled) return;
    setActive(selected);
    setOpen(true);
  }

  function pick(index: number) {
    close();
    trigger.current?.focus();
    if (index >= 0 && index !== selected) onChange(options[index].value);
  }

  if (disabled && open) setOpen(false);

  // Opens below the trigger, or above it when there is more room there.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    const up = menu.current.scrollHeight > below && above > below;
    const left = Math.min(rect.left, window.innerWidth - menu.current.offsetWidth - MARGIN);
    setPosition({
      up,
      style: {
        maxHeight: Math.max(80, up ? above : below),
        minWidth: rect.width,
        top: up ? undefined : rect.bottom + GAP,
        bottom: up ? window.innerHeight - rect.top + GAP : undefined,
        left: Math.max(MARGIN, left),
      },
    });
  }, [open]);

  useLayoutEffect(() => {
    if (open) {
      menu.current?.children[active]?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, active]);

  // Clicks elsewhere, leaving the window or resizing it close the menu.
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapper.current?.contains(target) && !menu.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function onKeyDown(event: KeyboardEvent) {
    const count = options.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) {
          show();
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((active + step + count) % count);
        break;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) pick(active);
        else show();
        break;
      case 'Escape':
      case 'Tab':
        close();
        break;
    }
  }

  return (
    <div ref={wrapper} className={`dropdown ${className}${open ? ' open' : ''}`.trim()}>
      <button
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={title}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="dropdown-label">{options[selected]?.label ?? ''}</span>
        <svg className="dropdown-chevron" viewBox="0 0 24 24">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open &&
        // In <body> so overflow and stacking of the parents cannot clip it.
        createPortal(
          <div
            ref={menu}
            className={`dropdown-menu${position.up ? ' up' : ''}`}
            role="listbox"
            style={position.style}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                className={`dropdown-item${index === active ? ' active' : ''}`}
                role="option"
                aria-selected={index === selected}
                onMouseMove={() => setActive(index)}
                onClick={() => pick(index)}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
