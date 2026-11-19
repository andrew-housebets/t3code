const renames = [
  ["T3 Connect", process.env.T3CODE_CONNECT_NAME?.trim()],
  ["T3 Account", process.env.T3CODE_ACCOUNT_NAME?.trim()],
].filter(([, name]) => name);
const rename = (value) => renames.reduce((text, [from, to]) => text.replaceAll(from, to), value);

// Forks that run their own relay rename the service in every bundled string.
const brandPlugin = () => ({
  visitor: {
    StringLiteral(path) {
      path.node.value = rename(path.node.value);
    },
    JSXText(path) {
      path.node.value = rename(path.node.value);
    },
    TemplateElement(path) {
      path.node.value.raw = rename(path.node.value.raw);
      if (path.node.value.cooked != null) path.node.value.cooked = rename(path.node.value.cooked);
    },
  },
});

module.exports = function (api) {
  api.cache(renames.length === 0);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: renames.length > 0 ? [brandPlugin] : [],
  };
};
