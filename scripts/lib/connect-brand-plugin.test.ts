// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
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

it("gives fork shims their own marker and still reads the upstream one", () => {
  const shim = NodePath.resolve(
    import.meta.dirname,
    "../../apps/desktop/src/app/DesktopCliShim.ts",
  );
  const renamed = renameBrand(NodeFS.readFileSync(shim, "utf8"), fork, shim);
  assert.include(renamed, 'export const MARKER = "Written by Acme Code: runs');
  assert.include(
    renamed,
    `const UPSTREAM_MARKER = "Written by T3 Code: runs the desktop app's bundled t3 CLI.";`,
  );
});

it("renames the command where the text is about this machine's own CLI", () => {
  const names = { ...fork, cli: "acme" };
  const own = "/repo/apps/server/src/cli/service.ts";
  assert.strictEqual(
    renameBrand(
      '"Run `t3 service install`. The t3 command, or t3." + "t3.cmd" + t3Home',
      names,
      own,
    ),
    '"Run `acme service install`. The acme command, or acme." + "t3.cmd" + t3Home',
  );
  const remote = "/repo/apps/web/src/components/settings/SavedEnvironmentRows.tsx";
  assert.strictEqual(
    renameBrand('"Run `t3 connect link` on the host"', names, remote),
    '"Run `t3 connect link` on the host"',
  );
  const module = NodePath.resolve(import.meta.dirname, "../../packages/shared/src/cliCommand.ts");
  const renamed = connectBrandPlugin(names).transform(NodeFS.readFileSync(module, "utf8"), module);
  assert.include(renamed?.code, 'CLI_COMMAND = "acme"');
  assert.include(renamed?.code, 'ReadonlyArray<string> = ["t3"]');
});
