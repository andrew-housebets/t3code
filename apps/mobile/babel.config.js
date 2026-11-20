const fromEnv = (name) => process.env[name]?.trim() || undefined;
const names = {
  connect: fromEnv("T3CODE_CONNECT_NAME"),
  app: fromEnv("T3CODE_APP_NAME"),
  githubApp: fromEnv("T3CODE_GITHUB_APP_NAME"),
};
const accountName = fromEnv("T3CODE_ACCOUNT_NAME");
const isRenaming = Boolean(names.connect || names.app || names.githubApp || accountName);
const renameBrand = isRenaming
  ? require("../../scripts/lib/connect-brand-plugin.ts").renameBrand
  : (value) => value;
const rename = (value, moduleId) =>
  renameBrand(accountName ? value.replaceAll("T3 Account", accountName) : value, names, moduleId);

// Forks rename the app and its relay service in every bundled string.
const brandPlugin = () => ({
  visitor: {
    StringLiteral(path, state) {
      path.node.value = rename(path.node.value, state.filename);
    },
    JSXText(path, state) {
      path.node.value = rename(path.node.value, state.filename);
    },
    TemplateElement(path, state) {
      path.node.value.raw = rename(path.node.value.raw, state.filename);
      if (path.node.value.cooked != null) {
        path.node.value.cooked = rename(path.node.value.cooked, state.filename);
      }
    },
  },
});

module.exports = function (api) {
  api.cache(!isRenaming);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: isRenaming ? [brandPlugin] : [],
  };
};
