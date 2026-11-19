const UPSTREAM_CONNECT_NAME = "T3 Connect";

/** Forks that run their own relay rename the service in every bundled string with T3CODE_CONNECT_NAME. */
export function connectBrandPlugin(name = process.env.T3CODE_CONNECT_NAME?.trim()) {
  return {
    name: "t3code:connect-brand",
    transform(code: string) {
      if (!name || !code.includes(UPSTREAM_CONNECT_NAME)) return undefined;
      return { code: code.replaceAll(UPSTREAM_CONNECT_NAME, name), map: null };
    },
  };
}
