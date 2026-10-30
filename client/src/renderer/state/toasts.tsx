import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const TOAST_MS = 4000;

export type ToastKind = 'info' | 'success' | 'error';
type Toast = (message: string, kind?: ToastKind) => void;

interface Item {
  id: number;
  message: string;
  kind: ToastKind;
  leaving: boolean;
}

const Context = createContext<Toast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(0);

  const toast = useCallback<Toast>((message, kind = 'info') => {
    const id = nextId.current++;
    setItems((current) => [...current, { id, message, kind, leaving: false }]);
    // Leaves with an animation; removed when it ends.
    setTimeout(() => {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, leaving: true } : item)),
      );
    }, TOAST_MS);
  }, []);

  const remove = (id: number) =>
    setItems((current) => current.filter((item) => item.id !== id));

  return (
    <Context.Provider value={toast}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={`toast toast-${item.kind}${item.leaving ? ' leaving' : ''}`}
            onAnimationEnd={() => item.leaving && remove(item.id)}
          >
            {item.message}
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}

export function useToast() {
  const toast = useContext(Context);
  if (!toast) throw new Error('useToast outside ToastProvider');
  return toast;
}
