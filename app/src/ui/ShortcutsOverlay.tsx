import { SHORTCUTS } from "./shortcuts";

export function ShortcutsOverlay({ packMode, onClose }: { packMode: boolean; onClose: () => void }) {
  return (
    <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="shortcuts-card" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.filter((s) => packMode || !s.packModeOnly).map((s) => (
            <div key={s.key}>
              <dt><kbd>{s.key}</kbd></dt>
              <dd>{s.what}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onClose}>Close (Esc)</button>
      </div>
    </div>
  );
}
