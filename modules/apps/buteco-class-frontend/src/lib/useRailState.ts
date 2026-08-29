import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

export type RailState = "collapsed" | "expanded" | "hidden";

const KEY = "buteco.ui.rail";

function read(): RailState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "hidden" || raw === "expanded" || raw === "collapsed" ? raw : "collapsed";
  } catch {
    // localStorage can throw inside Discord's Activity iframe depending
    // on storage policy -- the default state is fine there.
    return "collapsed";
  }
}

// The sidebar's three-way desktop state, persisted per-browser.
export function useRailState(): [RailState, Dispatch<SetStateAction<RailState>>] {
  const [state, setState] = useState<RailState>(read);

  function update(next: SetStateAction<RailState>) {
    setState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      try {
        localStorage.setItem(KEY, value);
      } catch {
        // Same as read(): persistence is best-effort.
      }
      return value;
    });
  }

  return [state, update];
}