import { describe, expect, it } from "@effect/vitest";

import { seedForkDefaultTheme } from "./forkDefaultTheme.ts";

const theme = { id: "t3-code-claude", label: "T3 Code Claude", appearance: "dark", colors: {} };

const storageWith = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
};

describe("seedForkDefaultTheme", () => {
  it("selects the fork theme following the system appearance on a fresh profile, once", () => {
    const storage = storageWith({ "t3code:themes:v1": JSON.stringify([{ id: "mine" }]) });

    expect(seedForkDefaultTheme(storage, theme)).toBe(true);
    expect(storage.map.get("t3code:theme")).toBe("t3-code-claude");
    expect(storage.map.get("t3code:theme-appearance-mode")).toBe("system");
    expect(JSON.parse(storage.map.get("t3code:themes:v1")!)).toEqual([{ id: "mine" }, theme]);

    storage.map.delete("t3code:theme");
    expect(seedForkDefaultTheme(storage, theme)).toBe(false);
    expect(storage.map.has("t3code:theme")).toBe(false);
  });

  it("keeps a theme the user already chose", () => {
    const storage = storageWith({ "t3code:theme": "system" });

    expect(seedForkDefaultTheme(storage, theme)).toBe(false);
    expect(storage.map.get("t3code:theme")).toBe("system");
    expect(storage.map.has("t3code:themes:v1")).toBe(false);
  });

  it("leaves an unreadable theme library alone", () => {
    const storage = storageWith({ "t3code:themes:v1": "{" });

    expect(seedForkDefaultTheme(storage, theme)).toBe(false);
    expect(storage.map.get("t3code:themes:v1")).toBe("{");
    expect(storage.map.has("t3code:theme")).toBe(false);
  });
});
