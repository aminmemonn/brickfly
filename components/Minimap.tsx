'use client';

import { useEffect, useRef } from 'react';
import { bus } from '@/game/bus';
import { getGame } from '@/game/game';
import { LANDMARKS } from '@/game/landmark-data';

const W = 224;
const H = 112;

export default function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapImg = useRef<HTMLImageElement | null>(null);
  const discovered = useRef<Set<string>>(new Set());
  const pos = useRef({ lat: 0, lon: 0, heading: 0 });

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, W, H);
      if (mapImg.current?.complete) {
        ctx.drawImage(mapImg.current, 0, 0, W, H);
      } else {
        ctx.fillStyle = '#123a6e';
        ctx.fillRect(0, 0, W, H);
      }

      // Landmarks
      for (const lm of LANDMARKS) {
        const x = ((lm.lon + 180) / 360) * W;
        const y = ((90 - lm.lat) / 180) * H;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = discovered.current.has(lm.id) ? '#f7d354' : 'rgba(255,255,255,0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Player
      const px = ((pos.current.lon + 180) / 360) * W;
      const py = ((90 - pos.current.lat) / 180) * H;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((pos.current.heading * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(0, -5.5);
      ctx.lineTo(4, 4.5);
      ctx.lineTo(0, 2.4);
      ctx.lineTo(-4, 4.5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    };

    const loadMap = (url: string) => {
      const img = new Image();
      img.onload = draw;
      img.src = url;
      mapImg.current = img;
    };
    const cached = getGame()?.mapUrl;
    if (cached) loadMap(cached);
    const offMap = bus.on('map', (url) => loadMap(url as string));
    const offPos = bus.on('pos', (p) => {
      pos.current = p as { lat: number; lon: number; heading: number };
      draw();
    });
    const offCol = bus.on('collection', (ids) => {
      discovered.current = new Set(ids as string[]);
    });

    draw();
    return () => {
      offMap();
      offPos();
      offCol();
    };
  }, []);

  return (
    <div className="glass overflow-hidden rounded-2xl p-1.5">
      <canvas ref={canvasRef} width={W} height={H} className="rounded-xl" style={{ width: W, height: H }} />
    </div>
  );
}
