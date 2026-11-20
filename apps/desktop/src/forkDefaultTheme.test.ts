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

  it("refreshes the stored copy when a build ships a changed theme, keeping the user's choice", () => {
    const storage = storageWith();
    seedForkDefaultTheme(storage, theme);
    storage.map.set("t3code:theme", "mine");
    const updated = { ...theme, css: "a{}" };

    expect(seedForkDefaultTheme(storage, updated)).toBe(true);
    expect(JSON.parse(storage.map.get("t3code:themes:v1")!)).toEqual([updated]);
    expect(storage.map.get("t3code:theme")).toBe("mine");
    expect(seedForkDefaultTheme(storage, updated)).toBe(false);
  });

  it("refreshes a copy seeded by a build that kept no fingerprint", () => {
    const storage = storageWith({
      "t3code:fork-default-theme-seeded": "1",
      "t3code:theme": "t3-code-claude",
      "t3code:themes:v1": JSON.stringify([{ ...theme, css: "old{}" }]),
    });

    expect(seedForkDefaultTheme(storage, theme)).toBe(true);
    expect(JSON.parse(storage.map.get("t3code:themes:v1")!)).toEqual([theme]);
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
