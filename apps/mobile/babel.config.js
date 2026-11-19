const connectName = process.env.T3CODE_CONNECT_NAME?.trim();
const rename = (value) => value.replaceAll("T3 Connect", connectName);

// Forks that run their own relay rename the service in every bundled string.
const connectBrandPlugin = () => ({
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
  api.cache(!connectName);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: connectName ? [connectBrandPlugin] : [],
  };
};
