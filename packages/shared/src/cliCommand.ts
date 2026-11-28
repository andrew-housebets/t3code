import * as Context from "effect/Context";

export const CLI_COMMAND = "t3";
const CLI_COMMAND_ALIASES: ReadonlyArray<string> = [];

export const CliCommandNames = Context.Reference<{
  readonly command: string;
  readonly aliases: ReadonlyArray<string>;
}>("@t3tools/shared/cliCommand/CliCommandNames", {
  defaultValue: () => ({ command: CLI_COMMAND, aliases: CLI_COMMAND_ALIASES }),
});
