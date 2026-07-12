'use client';

import React, { useEffect, useState, useRef } from 'react';

interface Emitter {
  id: string;
  x: number;
  y: number;
  startTime: number;
  endTime: number;
  lastSpawnTime: number;
}

interface FlowerParticle {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  spin: number;
  scale: number;
  maxScale: number;
  opacity: number;
  svgPath: string;
  createdAt: number;
  duration: number;
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
}

const FLOWER_SVGS = [
  '/flowers/Flower.svg',
  '/flowers/day-flower-gift-svgrepo-com.svg',
  '/flowers/flower-green-svgrepo-com.svg',
  '/flowers/flower-leaf-2-svgrepo-com.svg',
  '/flowers/flower-orange-3-svgrepo-com.svg',
  '/flowers/flower-orange-organic-svgrepo-com.svg',
  '/flowers/flower-svgrepo-com (1).svg',
  '/flowers/flower-svgrepo-com.svg',
  '/flowers/flower_31.svg',
  '/flowers/johnny-automatic-rose-3.svg',
  '/flowers/leaf-organic-2-svgrepo-com.svg'
];

export default function FlowerParticlesLayer() {
  const [particles, setParticles] = useState<FlowerParticle[]>([]);
  const emittersRef = useRef<Emitter[]>([]);
  const particlesRef = useRef<FlowerParticle[]>([]);
  const isLoopingRef = useRef(false);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const updateLoop = () => {
      const now = Date.now();

      // 1. Spawning from emitters
      if (emittersRef.current.length > 0) {
        emittersRef.current = emittersRef.current.filter((emitter) => emitter.endTime > now);
        
        const newParticles: FlowerParticle[] = [];
        
        emittersRef.current.forEach((emitter) => {
          // Spawn rate: spawn a flower every 75ms (approx 133 flowers in 10s per emitter)
          if (now - emitter.lastSpawnTime > 75) {
            emitter.lastSpawnTime = now;
            
            // Spawn 1 to 2 flowers at a time for density
            const spawnCount = Math.floor(Math.random() * 2) + 1;
            
            for (let i = 0; i < spawnCount; i++) {
              const svgPath = FLOWER_SVGS[Math.floor(Math.random() * FLOWER_SVGS.length)];
              const angle = Math.random() * Math.PI * 2;
              
              // Velocity: pop out fast, then slow down
              const speed = 3 + Math.random() * 5;
              const vx = Math.cos(angle) * speed;
              const vy = Math.sin(angle) * speed;
              
              const particle: FlowerParticle = {
                id: Math.random().toString(36).substring(2) + '-' + now + '-' + Math.random(),
                startX: emitter.x,
                startY: emitter.y,
                x: emitter.x + (Math.random() - 0.5) * 15,
                y: emitter.y + (Math.random() - 0.5) * 15,
                vx,
                vy,
                rotation: Math.random() * 360,
                spin: (Math.random() - 0.5) * 4,
                scale: 0,
                maxScale: 0.5 + Math.random() * 0.7,
                opacity: 1,
                svgPath,
                createdAt: now,
                duration: 2500 + Math.random() * 1500, // lifetime 2.5 - 4s
                swayAmp: 4 + Math.random() * 10,
                swayFreq: 1 + Math.random() * 2,
                swayPhase: Math.random() * Math.PI * 2,
              };
              
              newParticles.push(particle);
            }
          }
        });

        if (newParticles.length > 0) {
          particlesRef.current = [...particlesRef.current, ...newParticles];
        }
      }

      // 2. Physics & Animation Update
      if (particlesRef.current.length > 0) {
        const nextParticles = particlesRef.current
          .map((p) => {
            const age = now - p.createdAt;
            const progress = age / p.duration;
            
            if (progress >= 1) return null;

            // Physics with friction
            const nextVx = p.vx * 0.95;
            // Gentle upward drift
            const nextVy = (p.vy * 0.95) - 0.05;
            
            // Sway calculation (horizontal wave)
            const sway = Math.sin(progress * p.swayFreq * Math.PI * 2 + p.swayPhase) * p.swayAmp;
            
            // Base coordinates
            const nextX = p.x + nextVx;
            const nextY = p.y + nextVy;

            // Elastic pop scale in the first 15%
            let scale = p.maxScale;
            if (progress < 0.15) {
              const scaleProgress = progress / 0.15;
              scale = p.maxScale * (1 - Math.pow(1 - scaleProgress, 3));
            }

            // Fade out in the last 30%
            let opacity = 1;
            if (progress > 0.7) {
              opacity = 1 - (progress - 0.7) / 0.3;
            }

            return {
              ...p,
              x: nextX,
              y: nextY,
              vx: nextVx,
              vy: nextVy,
              rotation: p.rotation + p.spin,
              scale,
              opacity,
              displayX: nextX + sway,
              displayY: nextY,
            };
          })
          .filter(Boolean) as FlowerParticle[];

        particlesRef.current = nextParticles;
        setParticles(nextParticles);
      } else {
        setParticles([]);
      }

      if (particlesRef.current.length > 0 || emittersRef.current.length > 0) {
        animFrameRef.current = requestAnimationFrame(updateLoop);
      } else {
        isLoopingRef.current = false;
      }
    };

    const handleSpawn = (e: Event) => {
      const customEvent = e as CustomEvent<{ x: number; y: number }>;
      const { x, y } = customEvent.detail;
      
      const now = Date.now();
      const newEmitter: Emitter = {
        id: Math.random().toString(36).substring(2),
        x,
        y,
        startTime: now,
        endTime: now + 10000, // 10 seconds lifetime
        lastSpawnTime: 0,
      };
      
      emittersRef.current.push(newEmitter);
      
      if (!isLoopingRef.current) {
        isLoopingRef.current = true;
        animFrameRef.current = requestAnimationFrame(updateLoop);
      }
    };

    window.addEventListener('spawn-flower-burst', handleSpawn);
    
    return () => {
      window.removeEventListener('spawn-flower-burst', handleSpawn);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  return (
    <>
      {particles.map((p) => {
        const x = (p as any).displayX ?? p.x;
        const y = (p as any).displayY ?? p.y;
        
        return (
          <img
            key={p.id}
            src={p.svgPath}
            alt="petals"
            style={{
              position: 'absolute',
              left: `${x}px`,
              top: `${y}px`,
              width: '32px',
              height: '32px',
              transform: `translate(-50%, -50%) scale(${p.scale}) rotate(${p.rotation}deg)`,
              opacity: p.opacity,
              filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.12))',
              willChange: 'transform, opacity, left, top',
              pointerEvents: 'none',
            }}
          />
        );
      })}
    </>
  );
}
