const UPSTREAM_CONNECT_NAME = "T3 Connect";
const UPSTREAM_GITHUB_APP_NAME = "T3 Code for GitHub";
const UPSTREAM_GITHUB_APP_PATH = "apps/t3-code-for-github/";

/** Source snippets that are matched, persisted or sent on the wire, so they keep the upstream name. */
export const KEPT_UPSTREAM_SNIPPETS = [
  'legacy: "T3 Code (Dev)"',
  'legacy: "T3 Code (Alpha)"',
  '["T3 Code (Alpha)", "t3code"]',
  '"Written by T3 Code: runs',
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const APP_NAME_PATTERN = new RegExp(
  [
    `(${KEPT_UPSTREAM_SNIPPETS.map(escapeRegExp).join("|")})`,
    "(T3 Code)",
    "~/\\.codex-(t3)/",
    "\\bT3(?='s\\b| (?!extends\\b)[a-z])",
    "(?<=[a-z] )T3\\b(?!\\s+(?:Chat|Connect|Account))",
  ].join("|"),
  "g",
);

export interface BrandNames {
  readonly connect?: string | undefined;
  readonly app?: string | undefined;
  readonly githubApp?: string | undefined;
}

function brandNamesFromEnv(env: Record<string, string | undefined> = process.env) {
  return {
    connect: env.T3CODE_CONNECT_NAME?.trim() || undefined,
    app: env.T3CODE_APP_NAME?.trim() || undefined,
    githubApp: env.T3CODE_GITHUB_APP_NAME?.trim() || undefined,
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
  const app = names.app;
  if (!app || KEPT_UPSTREAM_MODULES.test(moduleId)) return connected;
  const lead = app.split(" ")[0] ?? app;
  return connected.replace(APP_NAME_PATTERN, (match, kept, appName, pathHint) => {
    if (kept) return match;
    if (appName) return app;
    if (pathHint) return `~/.codex-${lead.toLowerCase()}/`;
    return lead;
  });
}

/** Forks rename the app and its relay service in every bundled string with T3CODE_APP_NAME and T3CODE_CONNECT_NAME. */
export function connectBrandPlugin(names: BrandNames = brandNamesFromEnv()) {
  const transform = (code: string, id?: string) => {
    if (!names.connect && !names.app && !names.githubApp) return undefined;
    const renamed = renameBrand(code, names, id);
    return renamed === code ? undefined : renamed;
  };
  return {
    name: "t3code:connect-brand",
    transform(code: string, id: string) {
      if (names.app && id.endsWith(UPSTREAM_WORDMARK_MODULE)) {
        return { code: FORK_WORDMARK_SOURCE, map: null };
      }
      const renamed = transform(code, id);
      return renamed === undefined ? undefined : { code: renamed, map: null };
    },
    transformIndexHtml: { order: "post" as const, handler: (html: string) => transform(html) },
  };
}
