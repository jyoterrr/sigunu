import { useEffect, useRef, useState } from 'react';
import type { QuestionMedia, MediaTransform } from '@sigunu/shared';
import { mediaSrc } from './QuestionMediaStage';

type Mode = 'move' | 'resize' | 'rotate';
interface Drag {
  id: string;
  mode: Mode;
  startX: number;
  startY: number;
  startT: MediaTransform;
  centerX: number; // px, for rotate
  centerY: number;
  stageW: number;
  stageH: number;
}

const DEFAULT_T: MediaTransform = { xPct: 25, yPct: 25, widthPct: 40, rotationDeg: 0, z: 0 };

/**
 * Free-form collage editor for a question's images (Addendum §1): drag to move,
 * corner handle to scale, top handle to rotate to any angle. Transforms are stored
 * normalized to the stage so the arrangement renders identically for every player.
 * Plain pointer events — no external dependency.
 */
export function ImageCollageEditor({
  images,
  onChange,
}: {
  images: QuestionMedia[];
  onChange: (images: QuestionMedia[]) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const patch = (id: string, t: Partial<MediaTransform>) => {
    onChange(
      images.map((m) =>
        m.id === id ? { ...m, transform: { ...(m.transform ?? DEFAULT_T), ...t } } : m
      )
    );
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'move') {
        const dxPct = ((e.clientX - d.startX) / d.stageW) * 100;
        const dyPct = ((e.clientY - d.startY) / d.stageH) * 100;
        patch(d.id, {
          xPct: clamp(d.startT.xPct + dxPct, -20, 100),
          yPct: clamp(d.startT.yPct + dyPct, -20, 100),
        });
      } else if (d.mode === 'resize') {
        const dxPct = ((e.clientX - d.startX) / d.stageW) * 100;
        patch(d.id, { widthPct: clamp(d.startT.widthPct + dxPct, 5, 120) });
      } else if (d.mode === 'rotate') {
        const angle = (Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX) * 180) / Math.PI;
        patch(d.id, { rotationDeg: Math.round(angle + 90) });
      }
    };
    const onUp = () => (dragRef.current = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  const begin = (e: React.PointerEvent, m: QuestionMedia, mode: Mode) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(m.id);
    const stage = stageRef.current!.getBoundingClientRect();
    const wrapper = (e.currentTarget as HTMLElement).closest('.ce-item')!.getBoundingClientRect();
    dragRef.current = {
      id: m.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startT: m.transform ?? DEFAULT_T,
      centerX: wrapper.left + wrapper.width / 2,
      centerY: wrapper.top + wrapper.height / 2,
      stageW: stage.width,
      stageH: stage.height,
    };
  };

  const imgs = images.filter((m) => m.kind === 'image');

  return (
    <div className="ce-stage" ref={stageRef} onPointerDown={() => setSelected(null)}>
      {imgs.length === 0 && <div className="ce-empty">Add images below, then drag · resize · rotate them here.</div>}
      {[...imgs]
        .sort((a, b) => (a.transform?.z ?? 0) - (b.transform?.z ?? 0))
        .map((m) => {
          const t = m.transform ?? DEFAULT_T;
          const isSel = selected === m.id;
          return (
            <div
              key={m.id}
              className={`ce-item ${isSel ? 'sel' : ''}`}
              style={{
                left: `${t.xPct}%`,
                top: `${t.yPct}%`,
                width: `${t.widthPct}%`,
                transform: `rotate(${t.rotationDeg}deg)`,
                zIndex: (t.z ?? 0) + (isSel ? 1000 : 0),
              }}
              onPointerDown={(e) => begin(e, m, 'move')}
            >
              <img src={mediaSrc(m.url)} alt="" draggable={false} />
              {isSel && (
                <>
                  <div className="ce-handle ce-rotate" onPointerDown={(e) => begin(e, m, 'rotate')} title="Rotate" />
                  <div className="ce-handle ce-resize" onPointerDown={(e) => begin(e, m, 'resize')} title="Resize" />
                  <div className="ce-badge">{Math.round(t.rotationDeg)}°</div>
                </>
              )}
            </div>
          );
        })}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
