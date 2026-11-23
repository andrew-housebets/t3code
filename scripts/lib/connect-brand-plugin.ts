const UPSTREAM_CONNECT_NAME = "T3 Connect";
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
];

/** Text a model reads, and managed-policy names an administrator matches against upstream's keys. */
const KEPT_UPSTREAM_MODULES =
  /\/node_modules\/|\/src\/mcp\/|\/orchestration-v2\/(?!UserFacingErrors|Orchestrator\.ts)|\/triage\/|\/policy\/|Instructions\.ts|[tT]extGeneration|orchestratorMcp\.ts|mcpExtensionSource\.ts|htmlRender\.ts|managedPolicyFile\.ts/;

const UPSTREAM_WORDMARK_MODULE = "/apps/web/src/components/T3Wordmark.tsx";
const FORK_WORDMARK_SOURCE = 'export { MessagesSquareIcon as T3Wordmark } from "lucide-react";\n';

const UPSTREAM_CLI_COMMAND = "t3";
const CLI_COMMAND_MODULE = "/packages/shared/src/cliCommand.ts";
/** Modules whose command hints are about this machine's own CLI, not a remote host's. */
const OWN_CLI_TEXT_MODULES =
  /\/apps\/server\/src\/(?:cli|cloud|persistence)\/|\/apps\/server\/src\/(?:binCli|serviceLauncher|serverOwnership)\.ts|\/apps\/desktop\/src\/(?:app\/DesktopCli|app\/DesktopApp\.ts|backend\/DesktopHomeOwner)|\/apps\/web\/src\/(?:components\/settings\/CliCommandSettingsRow|state\/desktopCliCommand|components\/onboarding\/WelcomePage)/;

/** A keyword list, where only the row title names the command. */
const OWN_CLI_PHRASE_MODULES = /\/apps\/web\/src\/components\/settings\/settingsSearch/;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const KEPT_ALTERNATIVE = `(?<kept>${KEPT_UPSTREAM_SNIPPETS.map(escapeRegExp).join("|")})`;
const APP_ALTERNATIVES = [
  "(?<app>T3 Code)",
  "~/\\.codex-(?<hint>t3)/",
  "\\bT3(?='s\\b| (?!extends\\b)[a-z])",
  "(?<=[a-z] )T3\\b(?!\\s+(?:Chat|Connect|Account))",
];
const CLI_PHRASE = "\\bt3(?= (?:commands?|launcher|CLI)\\b)";
const CLI_ALTERNATIVES = {
  phrase: `(?<cli>${CLI_PHRASE})`,
  text: `(?<cli>(?<=[ \`])t3(?=[ \`\\\\]|[.,;:!?](?:\\s|["'\`]|$))|${CLI_PHRASE})`,
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
}

function brandNamesFromEnv(env: Record<string, string | undefined> = process.env) {
  const cli = env.T3CODE_CLI_NAME?.trim() || undefined;
  if (cli !== undefined && !/^[a-z][a-z0-9-]*$/.test(cli)) {
    throw new Error("T3CODE_CLI_NAME must be a lowercase command name such as b4.");
  }
  return {
    connect: env.T3CODE_CONNECT_NAME?.trim() || undefined,
    app: env.T3CODE_APP_NAME?.trim() || undefined,
    githubApp: env.T3CODE_GITHUB_APP_NAME?.trim() || undefined,
    cli,
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
  const connected = names.connect
    ? ownApp.replaceAll(UPSTREAM_CONNECT_NAME, names.connect)
    : ownApp;
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
  return connected.replace(patternFor(app !== undefined, cliScope), (match, ...rest) => {
    const groups = rest.at(-1) as Record<string, string | undefined>;
    if (groups.kept) return match;
    if (groups.cli) return cli ?? match;
    if (groups.app) return app ?? match;
    if (groups.hint) return `~/.codex-${lead?.toLowerCase()}/`;
    return lead ?? match;
  });
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
  const transform = (code: string, id?: string) => {
    if (!names.connect && !names.app && !names.githubApp && !names.cli) return undefined;
    const renamed = renameBrand(code, names, id);
    return renamed === code ? undefined : renamed;
  };
  return {
    name: "t3code:connect-brand",
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
