const OPEN = "<project_context>\n";
const CLOSE = "\n</project_context>";
const SEPARATOR = "\n\n---\n\n";

/** A delegated task led by the project's standing context, which the client folds away. */
export function formatProjectContextBlock(context: string, task: string): string {
  return `${OPEN}${context}${CLOSE}${SEPARATOR}${task}`;
}

/** `context` is null when the text does not open with a whole block; the text is then the task. */
export function splitProjectContextBlock(text: string): {
  readonly context: string | null;
  readonly task: string;
} {
  if (!text.startsWith(OPEN)) return { context: null, task: text };
  const end = text.indexOf(`${CLOSE}${SEPARATOR}`, OPEN.length);
  if (end < 0) return { context: null, task: text };
  return {
    context: text.slice(OPEN.length, end),
    task: text.slice(end + CLOSE.length + SEPARATOR.length),
  };
}
