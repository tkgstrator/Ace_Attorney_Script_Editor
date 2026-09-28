// 名前の入力や確認のダイアログ。どこからでも ask() / confirmDialog() で開ける（DialogHost を 1 つ置いておく）
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface AskOptions {
  title: string;
  description?: string;
  /** 入力欄（なければ確認だけ） */
  fields?: {
    name: string;
    label: string;
    initial?: string;
    placeholder?: string;
    validate?: (v: string) => string | null;
  }[];
  /** 種類などを 1 つ選ばせる */
  choices?: { value: string; label: string }[];
  okLabel?: string;
  danger?: boolean;
}

export interface AskResult {
  values: Record<string, string>;
  choice: string | undefined;
}

type Request = AskOptions & { resolve: (r: AskResult | null) => void };
let open: ((r: Request) => void) | null = null;

export function ask(opts: AskOptions): Promise<AskResult | null> {
  return new Promise((resolve) => {
    if (!open) {
      resolve(null);
      return;
    }
    open({ ...opts, resolve });
  });
}

export async function confirmDialog(title: string, description?: string): Promise<boolean> {
  return (await ask({ title, description, okLabel: '削除', danger: true })) !== null;
}

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<string | undefined>();

  useEffect(() => {
    open = (r) => {
      setReq(r);
      setValues(Object.fromEntries((r.fields ?? []).map((f) => [f.name, f.initial ?? ''])));
      setChoice(r.choices?.[0]?.value);
    };
    return () => {
      open = null;
    };
  }, []);

  const close = (result: AskResult | null) => {
    req?.resolve(result);
    setReq(null);
  };
  const errors = (req?.fields ?? []).map((f) => f.validate?.(values[f.name] ?? '') ?? null);
  const ok = errors.every((e) => e === null);

  return (
    <Dialog
      open={req !== null}
      onOpenChange={(o) => {
        if (!o) close(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) close({ values, choice });
          }}
        >
          <DialogHeader>
            <DialogTitle>{req?.title}</DialogTitle>
            {req?.description && <DialogDescription>{req.description}</DialogDescription>}
          </DialogHeader>
          {req?.choices && (
            <div className="flex gap-2">
              {req.choices.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={choice === c.value}
                  onClick={() => setChoice(c.value)}
                  className={cn(
                    'flex-1 rounded-md border px-3 py-2 text-sm',
                    choice === c.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-accent',
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {req?.fields?.map((f, i) => (
            <div key={f.name} className="block space-y-1">
              <label
                htmlFor={`ask-field-${f.name}`}
                className="block text-xs font-medium text-muted-foreground"
              >
                {f.label}
              </label>
              <Input
                id={`ask-field-${f.name}`}
                autoFocus={i === 0}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                aria-invalid={errors[i] !== null}
                aria-describedby={errors[i] ? `ask-error-${f.name}` : undefined}
              />
              {errors[i] && (
                <span id={`ask-error-${f.name}`} className="text-xs text-destructive">
                  {errors[i]}
                </span>
              )}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(null)}>
              キャンセル
            </Button>
            <Button type="submit" variant={req?.danger ? 'destructive' : 'default'} disabled={!ok}>
              {req?.okLabel ?? 'OK'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
