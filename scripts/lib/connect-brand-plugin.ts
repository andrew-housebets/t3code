// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

// JSX text wraps, so a name may break across lines.
const UPSTREAM_CONNECT_NAME = /T3\s+Connect/g;
const UPSTREAM_ACCOUNT_NAME = /T3\s+Account/g;
const UPSTREAM_APP_URL_NAME = "T3%20Code";
const UPSTREAM_GITHUB_APP_NAME = "T3 Code for GitHub";
const UPSTREAM_GITHUB_APP_PATH = "apps/t3-code-for-github/";

/** Source snippets that are matched, persisted or sent on the wire, so they keep the upstream name. */
export const KEPT_UPSTREAM_SNIPPETS = [
  'legacy: "T3 Code (Dev)"',
  'legacy: "T3 Code (Alpha)"',
  '["T3 Code (Alpha)", "t3code"]',
  `UPSTREAM_MARKER = "Written by T3 Code: runs the desktop app's bundled t3 CLI."`,
  'CODEX_CLIENT_NAME = "T3 Code"',
  'agent_name_hint: "T3 Code"',
  'resource_name: "T3 Code"',
  "T3 Code for GitHub",
  '=== "T3 Code"',
  "the T3 server WebSocket",
  "T3 team",
  "-Namespace T3",
];

/** Text a model reads, and managed-policy names an administrator matches against upstream's keys. */
const KEPT_UPSTREAM_MODULES =
  /\/node_modules\/|\/src\/mcp\/|\/orchestration-v2\/(?!UserFacingErrors|Orchestrator\.ts)|\/triage\/|\/policy\/|Instructions\.ts|[tT]extGeneration|orchestratorMcp\.ts|\/contracts\/src\/orchestrationV2\.ts|mcpExtensionSource\.ts|htmlRender\.ts|managedPolicyFile\.ts/;

const UPSTREAM_WORDMARK_MODULE = "/apps/web/src/components/T3Wordmark.tsx";
const FORK_WORDMARK_SOURCE = 'export { MessagesSquareIcon as T3Wordmark } from "lucide-react";\n';

const UPSTREAM_CLI_COMMAND = "t3";
const CLI_COMMAND_MODULE = "/packages/shared/src/cliCommand.ts";
/** Modules whose command hints are about this machine's own CLI, not a remote host's or upstream's standalone releases. */
const OWN_CLI_TEXT_MODULES =
  /\/apps\/server\/src\/(?:cli|cloud|persistence)\/(?!install|uninstall|update|pinnedRuntime|selfUpdate)|\/apps\/server\/src\/(?:binCli|serviceLauncher|serverOwnership)\.ts|\/apps\/desktop\/src\/(?:app\/DesktopCli|app\/DesktopApp\.ts|backend\/DesktopHomeOwner)|\/apps\/web\/src\/(?:components\/settings\/CliCommandSettingsRow|state\/desktopCliCommand|components\/onboarding\/WelcomePage)/;

/** A keyword list, where only the row title names the command. */
const OWN_CLI_PHRASE_MODULES = /\/apps\/web\/src\/components\/settings\/settingsSearch/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const KEPT_ALTERNATIVE = `(?<kept>${KEPT_UPSTREAM_SNIPPETS.map(escapeRegExp).join("|")})`;
const APP_ALTERNATIVES = [
  "(?<app>T3\\s+Code)",
  "~/\\.codex-(?<hint>t3)/",
  "(?:\\b|(?<=\\\\n))T3(?='s\\b| (?!extends\\b)[a-z])",
  "(?<=[a-z] )T3\\b(?!\\s+(?:Chat|Connect|Account))",
];
const CLI_PHRASE = "\\bt3(?= (?:commands?|launcher|CLI)\\b)";
const CLI_CODE_ELEMENT = '(?<=>)t3(?=</code>)|(?<=children: ")t3(?=")';
const CLI_ALTERNATIVES = {
  phrase: `(?<cli>${CLI_PHRASE})`,
  text: `(?<cli>(?<=[ \`])(?<!npx )t3(?=[ \`\\\\"']|[.,!?](?:\\s|["'\`]|$))|${CLI_PHRASE}|${CLI_CODE_ELEMENT})`,
};
type CliScope = keyof typeof CLI_ALTERNATIVES | undefined;
const patterns = new Map<string, RegExp>();
const patternFor = (app: boolean, cli: CliScope) => {
  const key = `${app}:${cli}`;
  const cached = patterns.get(key);
  if (cached) return cached;
  const pattern = new RegExp(
    [
      KEPT_ALTERNATIVE,
      ...(app ? APP_ALTERNATIVES : []),
      ...(cli ? [CLI_ALTERNATIVES[cli]] : []),
    ].join("|"),
    "g",
  );
  patterns.set(key, pattern);
  return pattern;
};

export interface BrandNames {
  readonly connect?: string | undefined;
  readonly app?: string | undefined;
  readonly githubApp?: string | undefined;
  readonly cli?: string | undefined;
  readonly account?: string | undefined;
}

export function brandNamesFromEnv(env: Record<string, string | undefined> = process.env) {
  const cli = env.T3CODE_CLI_NAME?.trim() || undefined;
  if (cli !== undefined && !/^[a-z][a-z0-9-]*$/.test(cli)) {
    throw new Error("T3CODE_CLI_NAME must be a lowercase command name such as b4.");
  }
  return {
    connect: env.T3CODE_CONNECT_NAME?.trim() || undefined,
    app: env.T3CODE_APP_NAME?.trim() || undefined,
    githubApp: env.T3CODE_GITHUB_APP_NAME?.trim() || undefined,
    cli,
    account: env.T3CODE_ACCOUNT_NAME?.trim() || undefined,
  };
}

/** Rewrites upstream product names in one module's text; returns the input when nothing applies. */
export function renameBrand(text: string, names: BrandNames, moduleId = "") {
  const githubApp = names.githubApp;
  const ownApp = githubApp
    ? text
        .replaceAll(UPSTREAM_GITHUB_APP_NAME, githubApp)
        .replaceAll(
          UPSTREAM_GITHUB_APP_PATH,
          `apps/${githubApp.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}/`,
        )
    : text;
  const ownAccount = names.account ? ownApp.replace(UPSTREAM_ACCOUNT_NAME, names.account) : ownApp;
  const connected = names.connect
    ? ownAccount.replace(UPSTREAM_CONNECT_NAME, names.connect)
    : ownAccount;
  const app = KEPT_UPSTREAM_MODULES.test(moduleId) ? undefined : names.app;
  const cliScope: CliScope = !names.cli
    ? undefined
    : OWN_CLI_TEXT_MODULES.test(moduleId)
      ? "text"
      : OWN_CLI_PHRASE_MODULES.test(moduleId)
        ? "phrase"
        : undefined;
  const cli = cliScope ? names.cli : undefined;
  if (!app && !cli) return connected;
  const lead = app?.split(" ")[0];
  const linked = app
    ? connected.replaceAll(UPSTREAM_APP_URL_NAME, encodeURIComponent(app))
    : connected;
  return linked.replace(patternFor(app !== undefined, cliScope), (match, ...rest) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (groups.kept) return match;
    if (groups.cli) return cli ?? match;
    if (groups.app) return app ?? match;
    if (groups.hint) return `~/.codex-${lead?.toLowerCase()}/`;
    return lead ?? match;
  });
}

const CATALOG_MODULE = /\/i18n\/translations\/[^/]+\.json$/;
/** One module per way the rename treats a source string: plain, own-CLI text, own-CLI phrase, kept. */
const CATALOG_VARIANT_MODULES = [
  "/apps/web/src/a.tsx",
  "/apps/server/src/cli/a.ts",
  "/apps/web/src/components/settings/settingsSearch.ts",
  "/apps/server/src/mcp/a.ts",
];
const TRANSLATED_UPSTREAM_NAME = /(?<![A-Za-z0-9])T3(?![A-Za-z0-9])(?![ -]?Chat)/g;
const TRANSLATED_UPSTREAM_COMMAND = /(?<![A-Za-z0-9./@-])t3(?![A-Za-z0-9./@])/g;
const HYPHENATED_UPSTREAM_NAME = /(?<![A-Za-z0-9])T3(?=-(?:Connect|Code)\b)/g;

export type BrandCatalog = Readonly<Record<string, unknown>>;
type HashSource = (input: {
  readonly source: unknown;
  readonly context?: string | undefined;
  readonly dataFormat: "ICU" | "JSX";
}) => string;

/** Renames the text of a catalog value: strings, JSX children, and the branches of plurals and selects. */
function renameCatalogValue(value: unknown, rename: (text: string) => string): unknown {
  if (typeof value === "string") return rename(value);
  if (Array.isArray(value)) return value.map((child) => renameCatalogValue(child, rename));
  if (value === null || typeof value !== "object") return value;
  const node = value as { readonly c?: unknown; readonly d?: { readonly b?: object } };
  const branches = node.d?.b;
  return {
    ...node,
    ...(node.c === undefined ? {} : { c: renameCatalogValue(node.c, rename) }),
    ...(branches === undefined
      ? {}
      : {
          d: {
            ...node.d,
            b: Object.fromEntries(
              Object.entries(branches).map(([branch, child]) => [
                branch,
                renameCatalogValue(child, rename),
              ]),
            ),
          },
        }),
  };
}

/**
 * GT finds a translation by hashing the source text, so a renamed source misses the committed
 * catalog. This adds, for every way the build renames an English entry, the hash of the renamed
 * text with its renamed translation. Committed keys stay for sources the rename leaves alone.
 */
export function renameBrandCatalog(input: {
  readonly catalog: BrandCatalog;
  readonly english: BrandCatalog;
  readonly names: BrandNames;
  readonly contexts: Iterable<string>;
  readonly hashSource: HashSource;
}): BrandCatalog {
  const { catalog, english, names, hashSource } = input;
  const lead = (names.app ?? names.connect ?? names.account)?.split(" ")[0];
  const contexts = [undefined, ...input.contexts];
  const renamed: Record<string, unknown> = { ...catalog };
  for (const [key, source] of Object.entries(english)) {
    const translation = catalog[key];
    if (translation === undefined) continue;
    const sourceText = JSON.stringify(source);
    let inputs: { context: string | undefined; dataFormat: "ICU" | "JSX" } | undefined;
    for (const moduleId of CATALOG_VARIANT_MODULES) {
      const rename = (text: string) => renameBrand(text, names, moduleId);
      const renamedSource = renameCatalogValue(source, rename);
      const renamedSourceText = JSON.stringify(renamedSource);
      if (renamedSourceText === sourceText) continue;
      if (inputs === undefined) {
        const formats = typeof source === "string" ? (["ICU", "JSX"] as const) : (["JSX"] as const);
        search: for (const dataFormat of formats) {
          for (const context of contexts) {
            if (hashSource({ source, context, dataFormat }) === key) {
              inputs = { context, dataFormat };
              break search;
            }
          }
        }
        if (inputs === undefined) {
          throw new Error(
            `Cannot rename the catalog entry ${key}: no GT hash of its English text matches.`,
          );
        }
      }
      // A translation inflects the name ("T3-Konto", "Conta T3"), so it follows the English: once
      // the rename leaves no upstream name there, none stays in the translation either.
      const nameGone = lead !== undefined && !renamedSourceText.match(TRANSLATED_UPSTREAM_NAME);
      const commandGone =
        names.cli !== undefined &&
        sourceText.match(TRANSLATED_UPSTREAM_COMMAND) !== null &&
        !renamedSourceText.match(TRANSLATED_UPSTREAM_COMMAND);
      const translated = (text: string) => {
        const exact = rename(text);
        const named =
          lead === undefined
            ? exact
            : exact.replace(nameGone ? TRANSLATED_UPSTREAM_NAME : HYPHENATED_UPSTREAM_NAME, lead);
        return commandGone ? named.replace(TRANSLATED_UPSTREAM_COMMAND, names.cli ?? "") : named;
      };
      // Every module renames this text, so nothing looks up the committed key any more.
      if (moduleId === CATALOG_VARIANT_MODULES[3]) delete renamed[key];
      renamed[hashSource({ source: renamedSource, ...inputs })] = renameCatalogValue(
        catalog === english ? source : translation,
        catalog === english ? rename : translated,
      );
    }
  }
  return renamed;
}

const GT_RUNTIME_PACKAGES = ["gt-react", "gt-react-native", "gt-i18n"];
const TRANSLATED_SOURCE_ROOTS = ["packages/client-runtime/src", "packages/shared/src"];
const CONTEXT_LITERAL =
  /(?:\$?context)[=:]\s*\{?\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)/g;

function translationContexts(root: string, contexts = new Set<string>()) {
  for (const entry of NodeFS.readdirSync(root, { withFileTypes: true })) {
    const path = NodePath.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "translations") {
        translationContexts(path, contexts);
      }
    } else if (/\.tsx?$/.test(entry.name)) {
      for (const match of NodeFS.readFileSync(path, "utf8").matchAll(CONTEXT_LITERAL)) {
        contexts.add((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\(['"`])/g, "$1"));
      }
    }
  }
  return contexts;
}

const catalogInputs = new Map<string, { contexts: Set<string>; hashSource: HashSource }>();
function catalogInputsFor(appRoot: string) {
  const cached = catalogInputs.get(appRoot);
  if (cached) return cached;
  const require = NodeModule.createRequire(NodePath.join(appRoot, "package.json"));
  const runtime = GT_RUNTIME_PACKAGES.flatMap((name) => {
    try {
      return [require.resolve(name)];
    } catch {
      return [];
    }
  })[0];
  if (runtime === undefined) throw new Error(`${appRoot} has no GT runtime to hash catalogs with.`);
  const { hashSource } = NodeModule.createRequire(runtime)("generaltranslation/id") as {
    hashSource: HashSource;
  };
  const contexts = translationContexts(NodePath.join(appRoot, "src"));
  for (const root of TRANSLATED_SOURCE_ROOTS) {
    translationContexts(NodePath.resolve(appRoot, "../..", root), contexts);
  }
  const inputs = { contexts, hashSource };
  catalogInputs.set(appRoot, inputs);
  return inputs;
}

/** The committed catalog at `path` with the build's names, as JSON text. */
export function renameBrandCatalogFile(path: string, names: BrandNames) {
  const read = (file: string) => JSON.parse(NodeFS.readFileSync(file, "utf8")) as BrandCatalog;
  const catalog = read(path);
  const english =
    NodePath.basename(path) === "en.json"
      ? catalog
      : read(NodePath.join(NodePath.dirname(path), "en.json"));
  return JSON.stringify(
    renameBrandCatalog({
      catalog,
      english,
      names,
      ...catalogInputsFor(NodePath.resolve(NodePath.dirname(path), "../../..")),
    }),
  );
}

/** Names the fork's command and keeps upstream's as an alias, in the one module that defines both. */
function renameCliCommand(code: string, cli: string) {
  const renamed = code
    .replace(`CLI_COMMAND = "${UPSTREAM_CLI_COMMAND}"`, `CLI_COMMAND = "${cli}"`)
    .replace("ReadonlyArray<string> = []", `ReadonlyArray<string> = ["${UPSTREAM_CLI_COMMAND}"]`);
  if (!renamed.includes(`"${cli}"`) || !renamed.includes(`["${UPSTREAM_CLI_COMMAND}"]`)) {
    throw new Error(`${CLI_COMMAND_MODULE} no longer declares the command name the build renames.`);
  }
  return renamed;
}

/** Forks rename the app, its relay service and its command in every bundle with T3CODE_APP_NAME, T3CODE_CONNECT_NAME and T3CODE_CLI_NAME. */
export function connectBrandPlugin(names: BrandNames = brandNamesFromEnv()) {
  const isRenaming = Boolean(
    names.connect || names.app || names.githubApp || names.cli || names.account,
  );
  const transform = (code: string, id?: string) => {
    if (!isRenaming || (id !== undefined && CATALOG_MODULE.test(id))) return undefined;
    const renamed = renameBrand(code, names, id);
    return renamed === code ? undefined : renamed;
  };
  return {
    name: "t3code:connect-brand",
    // Before the React Compiler, whose `let T3` temporaries read as prose to the rename.
    enforce: "pre" as const,
    load(id: string) {
      const path = id.split("?")[0] ?? id;
      return isRenaming && CATALOG_MODULE.test(path)
        ? renameBrandCatalogFile(path, names)
        : undefined;
    },
    transform(code: string, id: string) {
      if (names.app && id.endsWith(UPSTREAM_WORDMARK_MODULE)) {
        return { code: FORK_WORDMARK_SOURCE, map: null };
      }
      if (names.cli && names.cli !== UPSTREAM_CLI_COMMAND && id.endsWith(CLI_COMMAND_MODULE)) {
        return { code: renameCliCommand(code, names.cli), map: null };
      }
      const renamed = transform(code, id);
      return renamed === undefined ? undefined : { code: renamed, map: null };
    },
    transformIndexHtml: { order: "post" as const, handler: (html: string) => transform(html) },
  };
}
