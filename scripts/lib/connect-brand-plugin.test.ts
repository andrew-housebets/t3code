// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";

import {
  connectBrandPlugin,
  KEPT_UPSTREAM_SNIPPETS,
  renameBrand,
  renameBrandCatalogFile,
} from "./connect-brand-plugin.ts";

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
  const provenance = '"[T3 Code: the agent in T3 thread sent this message, not the user.]"';
  assert.strictEqual(
    rename(provenance, "/repo/packages/contracts/src/orchestrationV2.ts"),
    provenance,
  );
  assert.strictEqual(
    rename(String.raw`"List\nListed\nT3 threads"`),
    String.raw`"List\nListed\nAcme threads"`,
  );
  assert.strictEqual(
    rename("<T>through T3\n  Connect at ?name=T3%20Code</T>"),
    "<T>through Acme Connect at ?name=Acme%20Code</T>",
  );
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
      '"Run `t3 service install`, \\`which -a t3\\`. The t3 commands, or t3." + "t3.cmd" + t3Home',
      names,
      own,
    ),
    '"Run `acme service install`, \\`which -a acme\\`. The acme commands, or acme." + "t3.cmd" + t3Home',
  );
  assert.strictEqual(
    renameBrand('"Could not install t3" + `npx t3 serve` + { t3: Schema.String }', names, own),
    '"Could not install acme" + `npx t3 serve` + { t3: Schema.String }',
  );
  assert.strictEqual(
    renameBrand(
      'Use <code className="font-mono">t3</code> + jsx("code", { children: "t3" }) + key("t3")',
      names,
      own,
    ),
    'Use <code className="font-mono">acme</code> + jsx("code", { children: "acme" }) + key("t3")',
  );
  assert.strictEqual(
    renameBrand('"Download a newer t3"', names, "/repo/apps/server/src/cli/update.ts"),
    '"Download a newer t3"',
  );
  assert.strictEqual(
    renameBrand(
      '"t3 command", "tunnel t3 connect"',
      names,
      "/repo/apps/web/src/components/settings/settingsSearch.ts",
    ),
    '"acme command", "tunnel t3 connect"',
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

const catalogApps = ["web", "mobile", "desktop"].map((app) =>
  NodePath.resolve(import.meta.dirname, "../../apps", app, "src/i18n/translations"),
);
const readCatalog = (path: string) =>
  JSON.parse(NodeFS.readFileSync(path, "utf8")) as Record<string, unknown>;

it("gives renamed text the key GT looks up, with the renamed translation", () => {
  const [web = ""] = catalogApps;
  const english = readCatalog(NodePath.join(web, "en.json"));
  const german = readCatalog(NodePath.join(web, "de.json"));
  const committedKey = Object.keys(english).find((key) => english[key] === "Sign in to T3 Connect");
  assert.isDefined(committedKey);
  const names = { ...fork, cli: "acme" };
  const renamedEnglish = JSON.parse(
    renameBrandCatalogFile(NodePath.join(web, "en.json"), names),
  ) as Record<string, unknown>;
  const renamedGerman = JSON.parse(
    renameBrandCatalogFile(NodePath.join(web, "de.json"), names),
  ) as Record<string, unknown>;
  const renamedKey = Object.keys(renamedEnglish).find(
    (key) => renamedEnglish[key] === "Sign in to Acme Connect",
  );
  assert.isDefined(renamedKey);
  assert.notStrictEqual(renamedKey, committedKey);
  assert.strictEqual(
    renamedGerman[renamedKey ?? ""],
    String(german[committedKey ?? ""]).replaceAll("T3 Connect", "Acme Connect"),
  );
  assert.notProperty(renamedGerman, committedKey ?? "");
});

it("leaves no upstream name in a catalog entry whose English lost it", () => {
  const upstreamName = /(?<![A-Za-z0-9])T3(?![A-Za-z0-9])(?![ -]?Chat)/;
  const names = { ...fork, cli: "acme", account: "Acme Account" };
  for (const directory of catalogApps) {
    const english = readCatalog(NodePath.join(directory, "en.json"));
    const renamedEnglish = JSON.parse(
      renameBrandCatalogFile(NodePath.join(directory, "en.json"), names),
    ) as Record<string, unknown>;
    const cleanKeys = Object.keys(renamedEnglish).filter(
      (key) => !(key in english) && !upstreamName.test(JSON.stringify(renamedEnglish[key])),
    );
    assert.isAbove(cleanKeys.length, 0);
    for (const file of NodeFS.readdirSync(directory)) {
      const renamed = JSON.parse(
        renameBrandCatalogFile(NodePath.join(directory, file), names),
      ) as Record<string, unknown>;
      for (const key of cleanKeys) {
        assert.notMatch(JSON.stringify(renamed[key] ?? ""), upstreamName, `${file} ${key}`);
      }
    }
  }
});

it("names the app in every English catalog string outside the kept upstream names", () => {
  const upstreamName = /(?<![A-Za-z0-9])T3(?![A-Za-z0-9])(?! Chat| team)/;
  for (const directory of catalogApps) {
    for (const [key, source] of Object.entries(readCatalog(NodePath.join(directory, "en.json")))) {
      const renamed = renameBrand(
        JSON.stringify(source),
        { ...fork, account: "Acme Account" },
        "/repo/apps/web/src/a.tsx",
      );
      assert.notMatch(renamed, upstreamName, `${directory} ${key}`);
    }
  }
});
