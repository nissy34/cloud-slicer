// Light / dark theme. The choice is System (follow the OS), Light or Dark.
// It is kept in this browser (so the page paints in the right theme before the
// account loads, see index.html) and in the account's settings as 'theme', so
// it follows the user to their other devices.
import { useEffect, useState } from 'react';
import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'cloud-slicer:theme';
export const THEME_SETTING = 'theme';

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === 'system' || v === 'light' || v === 'dark';
}

function loadChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemeChoice(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}

interface ThemeState {
  choice: ThemeChoice;
  systemDark: boolean;
}

export const useThemeStore = create<ThemeState>(() => ({
  choice: loadChoice(),
  systemDark: darkQuery?.matches ?? false,
}));

darkQuery?.addEventListener('change', (e) => useThemeStore.setState({ systemDark: e.matches }));

function apply({ choice, systemDark }: ThemeState) {
  if (typeof document === 'undefined') return;
  const theme = resolveTheme(choice, systemDark);
  document.documentElement.dataset.theme = theme;
  // The phone's status bar / installed app title bar, matching the top bar (--surface).
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#17191d' : '#ffffff');
}
apply(useThemeStore.getState());
useThemeStore.subscribe(apply);

/** Change the theme in this browser only (e.g. when the account's copy arrives). */
export function setLocalTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // storage unavailable: kept until the tab closes
  }
  useThemeStore.setState({ choice });
}

export function useTheme(): Theme {
  return useThemeStore((s) => resolveTheme(s.choice, s.systemDark));
}

export interface SceneColours {
  background: string;
  bed: string;
  grid: string;
  ground: string;
  /** The printer's bed shape under the plate (desktop's Bed3D model colour). */
  bedModel: string;
  /** Bed exclusion areas. */
  exclude: string;
  /** Objects that won't be printed (desktop's black; light grey on the dark bed). */
  unprintable: string;
}

function readScene(): SceneColours {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--scene-bg', '#16191e'),
    bed: v('--scene-bed', '#2b2f36'),
    grid: v('--scene-grid', '#4a5160'),
    ground: v('--scene-ground', '#3a3f48'),
    bedModel: v('--scene-bed-model', '#414148'),
    exclude: v('--scene-exclude', '#6f655b'),
    unprintable: v('--scene-unprintable', '#000000'),
  };
}

/** The 3D view's colours, from the --scene-* CSS variables of the current theme. */
export function useSceneColours(): SceneColours {
  const theme = useTheme();
  const [colours, setColours] = useState(readScene);
  // data-theme is set synchronously by the store, so the variables are current.
  useEffect(() => setColours(readScene()), [theme]);
  return colours;
}
