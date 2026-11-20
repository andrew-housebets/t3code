// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import { connectBrandPlugin, KEPT_UPSTREAM_SNIPPETS, renameBrand } from "./connect-brand-plugin.ts";

const fork = { app: "Acme Code", connect: "Acme Connect" };

it("renames the app in prose and leaves identifiers, other products and model-facing modules alone", () => {
  const rename = (text: string, moduleId = "/repo/apps/web/src/a.tsx") =>
    renameBrand(text, fork, moduleId);

  assert.strictEqual(
    rename('"Update T3 Code on the T3 server. T3 Connect, T3\'s home, open T3"'),
    '"Update Acme Code on the Acme server. Acme Connect, Acme\'s home, open Acme"',
  );
  assert.strictEqual(
    rename('placeholder: "~/.codex-t3/personal"'),
    'placeholder: "~/.codex-acme/personal"',
  );
  for (const kept of [
    "Link T3 Chat or a T3 Chat sub",
    'usesT3Wordmark: APP_BASE_NAME === "T3 Code"',
    'aria-label="T3"',
    "<T1, T3 extends string = never>(value: T3)",
    "~/.t3 t3code:// T3CODE_HOME font-t3",
    ...KEPT_UPSTREAM_SNIPPETS,
  ]) {
    assert.strictEqual(rename(kept), kept);
  }
  assert.strictEqual(
    rename('"T3 Code on T3 Connect"', "/repo/apps/server/src/mcp/toolkits/thread/tools.ts"),
    '"T3 Code on Acme Connect"',
  );
  assert.strictEqual(rename("`T3 Code · ${self.label}`"), "`Acme Code · ${self.label}`");
  assert.strictEqual(
    renameBrand(
      '"T3 Code for GitHub" at https://github.com/apps/t3-code-for-github/installations/new',
      { ...fork, githubApp: "Acme Code for GitHub" },
    ),
    '"Acme Code for GitHub" at https://github.com/apps/acme-code-for-github/installations/new',
  );
  assert.strictEqual(renameBrand('"T3 Code on T3 Connect"', {}), '"T3 Code on T3 Connect"');
  assert.strictEqual(connectBrandPlugin({}).transform('"T3 Code"', "/repo/a.ts"), undefined);
  const wordmark = "/repo/apps/web/src/components/T3Wordmark.tsx";
  assert.notInclude(connectBrandPlugin(fork).transform("<svg />", wordmark)?.code, "svg");
  assert.strictEqual(
    connectBrandPlugin({ connect: "Acme Connect" }).transform("<svg />", wordmark),
    undefined,
  );
});

it("still finds every kept snippet in the source it protects", () => {
  const repoRoot = NodePath.resolve(import.meta.dirname, "../..");
  for (const snippet of KEPT_UPSTREAM_SNIPPETS) {
    const found = NodeChildProcess.spawnSync(
      "git",
      ["grep", "-lF", "-e", snippet, "--", "apps", "packages", ":(exclude)*.test.*"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    assert.notStrictEqual(found.stdout.trim(), "", `no source line contains ${snippet}`);
  }
});
