'use client';

import { Quality, Settings } from '@/game/settings';

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
}

const QUALITIES: { id: Quality; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'No studs, short draw' },
  { id: 'medium', label: 'Medium', hint: 'Studs, no shadows' },
  { id: 'high', label: 'High', hint: 'Full detail + shadows' }
];

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`spring relative h-7 w-12 rounded-full ${on ? 'bg-[#4cb227]' : 'bg-white/15'}`}
      aria-pressed={on}
    >
      <span
        className={`spring absolute top-0.5 h-6 w-6 rounded-full bg-white shadow ${on ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  );
}

export default function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div className="glass-strong w-[min(440px,92vw)] rounded-3xl p-7" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-2xl font-extrabold tracking-tight">Settings</h2>

        <div className="mt-6">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Graphics quality</div>
          <div className="glass flex gap-1 rounded-2xl p-1.5">
            {QUALITIES.map((q) => (
              <button
                key={q.id}
                onClick={() => onChange({ ...settings, quality: q.id })}
                className={`spring flex-1 rounded-xl px-3 py-2.5 text-center ${
                  settings.quality === q.id ? 'bg-white text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                <div className="text-xs font-bold">{q.label}</div>
                <div className={`text-[9px] ${settings.quality === q.id ? 'text-black/55' : 'text-white/35'}`}>
                  {q.hint}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Music</div>
              <div className="text-xs text-white/45">Ambient adventure loop</div>
            </div>
            <Toggle on={settings.music} onClick={() => onChange({ ...settings, music: !settings.music })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Sound effects</div>
              <div className="text-xs text-white/45">Engine, wind and chimes</div>
            </div>
            <Toggle on={settings.sfx} onClick={() => onChange({ ...settings, sfx: !settings.sfx })} />
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/[0.05] p-4 text-xs leading-6 text-white/65">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Controls</div>
          W/S pitch · A/D roll · Q/E yaw · Space/Shift throttle
          <br />
          1–4 camera views · drag to look · Esc pause · gamepad supported
        </div>

        <button
          onClick={onClose}
          className="spring mt-6 w-full rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-black hover:scale-[1.02] active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}
