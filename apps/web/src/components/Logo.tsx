import { brand } from '@/config/brand';

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-md bg-ink" aria-hidden>
        <span className="size-3.5 rounded-full border-[3px] border-highlighter" />
      </span>
      <span className={`text-xl tracking-tight ${light ? 'text-white' : 'text-ink'}`}>{brand.name}</span>
    </span>
  );
}
