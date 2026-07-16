'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useCollabStore } from '@/store/collabStore';
import { CanvasObjectData } from '@/lib/db';
import { ImageShape, imageShapeStyle, IMAGE_SHAPE_LABEL } from '@/lib/imageShapes';

/**
 * Object ids whose camera should auto-start the moment the block mounts — the
 * creator turned it on with the "Camera Mirror" click, which counts as the user
 * gesture getUserMedia needs. Consumed (removed) on first mount so a reload
 * doesn't silently re-open the webcam.
 */
export const pendingCameraStart = new Set<string>();

const CAPTURE_MS = 150;   // ~6–7 fps — smooth enough, light on the channel
const CAPTURE_WIDTH = 240; // downscaled broadcast frame width

/**
 * A live "mirror" on the canvas: your webcam, framed in a shape you can tap to
 * cycle (see CanvasObject's tap handler). During a collab session the owner's
 * frames stream to everyone else in real time over the pulse channel, so a
 * guest — including anyone following a presenter — sees the live feed. Guests
 * render the received frames; only the owner runs a camera.
 */
export default function MirrorBlock({ obj }: { obj: CanvasObjectData }) {
  const shape = (obj.style?.mirrorShape as ImageShape) || 'original';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureCanvas = useRef<HTMLCanvasElement | null>(null);
  const captureTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Frames pushed by the owner during a live session (only meaningful to guests).
  const remoteFrame = useCollabStore((s) => s.mirrorFrames[obj.id]);

  const stopCamera = useCallback(() => {
    if (captureTimer.current) { clearInterval(captureTimer.current); captureTimer.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (streamRef.current || starting) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera not available in this browser.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
        audio: false,
      });
      streamRef.current = stream;
      // The <video> only mounts once cameraOn flips true, so the stream is
      // attached by the effect below rather than here (videoRef is still null).
      setCameraOn(true);
    } catch {
      setError('Camera permission denied.');
      setCameraOn(false);
    } finally {
      setStarting(false);
    }
  }, [starting]);

  // Auto-start for the creator; always tear the camera down on unmount.
  // Deferred a tick so no state update runs synchronously inside the effect
  // body (still well within getUserMedia's transient-activation window).
  useEffect(() => {
    if (pendingCameraStart.has(obj.id)) {
      pendingCameraStart.delete(obj.id);
      queueMicrotask(() => startCamera());
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.id]);

  // Attach the live stream once the <video> has actually mounted (cameraOn).
  useEffect(() => {
    const video = videoRef.current;
    if (cameraOn && video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch(() => {});
    }
  }, [cameraOn]);

  // While the camera is on AND a session is live, capture + broadcast frames.
  // Subscribing keeps this in step with sessions starting/ending mid-stream.
  useEffect(() => {
    if (!cameraOn) return;

    const tick = () => {
      const pulse = useCollabStore.getState()._pulse;
      const connected = useCollabStore.getState().status === 'connected';
      const video = videoRef.current;
      if (!pulse || !connected || !video || video.readyState < 2 || !video.videoWidth) return;

      const cvs = captureCanvas.current || (captureCanvas.current = document.createElement('canvas'));
      const ratio = video.videoHeight / video.videoWidth || 1;
      cvs.width = CAPTURE_WIDTH;
      cvs.height = Math.round(CAPTURE_WIDTH * ratio);
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      // Bake in the mirror flip so remote viewers see the same selfie view.
      ctx.save();
      ctx.translate(cvs.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, cvs.width, cvs.height);
      ctx.restore();
      try {
        pulse.mirrorFrame(obj.id, cvs.toDataURL('image/jpeg', 0.45));
      } catch {
        /* canvas tainted or channel gone — skip this frame */
      }
    };

    captureTimer.current = setInterval(tick, CAPTURE_MS);
    return () => {
      if (captureTimer.current) { clearInterval(captureTimer.current); captureTimer.current = null; }
    };
  }, [cameraOn, obj.id]);

  // Drop our received frame from the shared map when the block goes away.
  useEffect(() => {
    const id = obj.id;
    return () => useCollabStore.getState()._clearMirrorFrame(id);
  }, [obj.id]);

  const shapeStyle = imageShapeStyle(shape);
  // A mirror always cover-fills (a letterboxed webcam looks broken); `original`
  // just keeps the rounded frame instead of a clip.
  const mediaStyle: React.CSSProperties =
    shape === 'original'
      ? { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius-md)' }
      : { width: '100%', height: '100%', ...shapeStyle };

  const toggleCamera = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cameraOn) { stopCamera(); setCameraOn(false); }
    else startCamera();
  };

  return (
    <div className="mirror-block relative w-full h-full select-none" style={{ overflow: 'visible' }}>
      {/* The live/own camera view (mirrored). Kept mounted while on. */}
      {cameraOn ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="pointer-events-none"
          style={{ ...mediaStyle, transform: 'scaleX(-1)' }}
        />
      ) : remoteFrame ? (
        // A guest watching the owner's live stream.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={remoteFrame} alt="Live camera" draggable={false} style={mediaStyle} className="pointer-events-none" />
      ) : (
        <div
          className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-4"
          style={{
            borderRadius: shape === 'original' ? 'var(--radius-md)' : undefined,
            clipPath: shapeStyle.clipPath as string | undefined,
            background: 'linear-gradient(135deg, rgba(30,30,40,0.92), rgba(60,50,70,0.92))',
          }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          </svg>
          <span className="text-[11px] font-semibold text-white/80">
            {starting ? 'Starting camera…' : error ? error : 'Camera off'}
          </span>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleCamera}
            className="mt-1 px-3 py-1 rounded-full bg-white/15 hover:bg-white/25 text-[10px] font-bold uppercase tracking-widest text-white transition-colors pointer-events-auto"
          >
            Turn on
          </button>
        </div>
      )}

      {/* Live dot + on/off toggle — only for the client running the camera. */}
      {cameraOn && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[9px] font-extrabold uppercase tracking-widest text-white/90 drop-shadow">Live</span>
        </div>
      )}

      {/* Shape name + camera toggle, surfaced on hover of the parent object. */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="px-2 py-0.5 rounded-full bg-black/45 backdrop-blur-sm text-[9px] font-bold uppercase tracking-widest text-white/90">
          {IMAGE_SHAPE_LABEL[shape]}
        </span>
        {cameraOn && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleCamera}
            title="Turn camera off"
            className="w-6 h-6 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-black/65 transition-colors pointer-events-auto"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
