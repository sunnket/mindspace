export type AmbientKind = 'rain' | 'brown' | 'white';

export interface AmbientHandle {
  stop: () => void;
  setVolume: (v: number) => void;
}

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!sharedCtx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctor();
  }
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

function makeWhiteBuffer(context: AudioContext, seconds = 4): AudioBuffer {
  const length = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Random-walk integration of white noise — the standard technique for a
// warm, low rumble (ocean / waterfall character) with no external asset.
function makeBrownBuffer(context: AudioContext, seconds = 4): AudioBuffer {
  const length = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

/** Starts a looping procedural ambient sound. Caller must invoke stop() when done. */
export function playAmbient(kind: AmbientKind, volume = 0.35): AmbientHandle {
  const context = getCtx();
  const source = context.createBufferSource();
  source.buffer = kind === 'brown' ? makeBrownBuffer(context) : makeWhiteBuffer(context);
  source.loop = true;

  const gain = context.createGain();
  gain.gain.value = volume;

  let filter: BiquadFilterNode | null = null;
  if (kind === 'rain') {
    // High-passed white noise reads as a steady rain hiss.
    filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    source.connect(filter);
    filter.connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(context.destination);
  source.start();

  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
      gain.disconnect();
      filter?.disconnect();
    },
    setVolume: (v: number) => {
      gain.gain.value = v;
    },
  };
}
