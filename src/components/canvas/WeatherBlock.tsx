'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { CanvasObjectData } from '@/lib/db';
import { useCanvasStore } from '@/store/canvasStore';

interface WeatherData {
  location: { name: string; country: string; lat: number; lng: number };
  current: {
    temperature: number; feelsLike: number; humidity: number;
    windSpeed: number; condition: string; icon: string; isDay: number;
  };
  daily: Array<{
    date: string; high: number; low: number; condition: string;
    icon: string; precipitation: number;
  }>;
  units: { temperature: string; windSpeed: string };
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function dayName(dateStr: string, idx: number): string {
  if (idx === 0) return 'Today';
  if (idx === 1) return 'Tmrw';
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  } catch { return dateStr; }
}

export default function WeatherBlock({ obj }: { obj: CanvasObjectData }) {
  const updateObject = useCanvasStore((s) => s.updateObject);
  const style = obj.style || {};
  const weatherQuery = (style.weatherQuery as string) || '';
  const weatherLat = style.weatherLat as number | undefined;
  const weatherLng = style.weatherLng as number | undefined;

  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchWeather = useCallback(async () => {
    let url = '';
    if (weatherLat !== undefined && weatherLng !== undefined) {
      url = `/api/weather?lat=${weatherLat}&lng=${weatherLng}`;
    } else if (weatherQuery) {
      url = `/api/weather?q=${encodeURIComponent(weatherQuery)}`;
    } else {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setError(j.error || 'Failed to load weather');
        return;
      }
      const weatherData = await res.json() as WeatherData;
      setData(weatherData);

      // Cache in the object style so it renders instantly on reload
      const cur = useCanvasStore.getState().objects.find((o) => o.id === obj.id);
      updateObject(obj.id, {
        content: `${weatherData.current.icon} ${weatherData.current.temperature}${weatherData.units.temperature} — ${weatherData.location.name}`,
        style: {
          ...cur?.style,
          weatherCache: weatherData,
          weatherCachedAt: Date.now(),
          weatherLat: weatherData.location.lat,
          weatherLng: weatherData.location.lng,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [weatherQuery, weatherLat, weatherLng, obj.id, updateObject]);

  // Load from cache first, refresh if stale
  useEffect(() => {
    const cached = style.weatherCache as WeatherData | undefined;
    const cachedAt = style.weatherCachedAt as number | undefined;
    if (cached) {
      setData(cached);
      if (!cachedAt || Date.now() - cachedAt > CACHE_TTL_MS) {
        fetchWeather();
      }
    } else {
      fetchWeather();
    }
  }, [weatherQuery, weatherLat, weatherLng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) {
    return (
      <div className="w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br from-sky-400/20 to-blue-500/20 backdrop-blur-xl border border-white/25 dark:border-white/10 flex items-center justify-center">
        <span className="w-5 h-5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br from-red-400/10 to-orange-400/10 backdrop-blur-xl border border-white/25 dark:border-white/10 flex items-center justify-center p-4">
        <span className="text-[12px] text-red-400/80 text-center">{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const isNight = !data.current.isDay;
  const bgClass = isNight
    ? 'from-indigo-900/30 to-slate-900/30'
    : 'from-sky-400/15 to-blue-500/15';

  return (
    <div
      className={`w-full h-full rounded-2xl overflow-hidden bg-gradient-to-br ${bgClass} backdrop-blur-xl border border-white/25 dark:border-white/10 shadow-lg flex flex-col`}
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      {/* Current weather */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider truncate">
            {data.location.name}{data.location.country ? `, ${data.location.country}` : ''}
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-[36px] font-light text-[var(--text-primary)] leading-none tabular-nums">
              {Math.round(data.current.temperature)}
            </span>
            <span className="text-[16px] text-[var(--text-tertiary)] font-light">
              {data.units.temperature}
            </span>
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mt-0.5">
            {data.current.condition}
          </div>
        </div>
        <div className="text-[40px] leading-none shrink-0 mt-1" aria-hidden>
          {data.current.icon}
        </div>
      </div>

      {/* Stats row */}
      <div className="px-4 py-1.5 flex items-center gap-4 text-[10px] text-[var(--text-tertiary)]">
        <span title="Feels like">🌡️ {Math.round(data.current.feelsLike)}{data.units.temperature}</span>
        <span title="Humidity">💧 {data.current.humidity}%</span>
        <span title="Wind">💨 {Math.round(data.current.windSpeed)} {data.units.windSpeed}</span>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t border-white/10 dark:border-white/5" />

      {/* 5-day forecast */}
      <div className="flex-1 px-3 py-2 flex items-stretch gap-0.5 min-h-0 overflow-hidden">
        {data.daily.slice(0, 5).map((day, i) => (
          <div
            key={day.date}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 rounded-xl hover:bg-white/10 dark:hover:bg-white/5 transition-colors py-1"
          >
            <span className="text-[9px] font-bold text-[var(--text-tertiary)] uppercase">
              {dayName(day.date, i)}
            </span>
            <span className="text-[18px] leading-none" aria-hidden>{day.icon}</span>
            <div className="flex items-baseline gap-0.5">
              <span className="text-[10px] font-bold text-[var(--text-primary)] tabular-nums">
                {Math.round(day.high)}°
              </span>
              <span className="text-[9px] text-[var(--text-muted)] tabular-nums">
                {Math.round(day.low)}°
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Refresh indicator */}
      {loading && (
        <div className="absolute top-2 right-2">
          <span className="w-3 h-3 rounded-full border border-sky-400 border-t-transparent animate-spin inline-block" />
        </div>
      )}
    </div>
  );
}
