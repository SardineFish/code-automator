export function resetSession(
  workspacePath?: string,
  dependencies?: {
    rm?: typeof import("node:fs/promises").rm;
    unlink?: typeof import("node:fs/promises").unlink;
    chdir?: (nextPath: string) => void;
    cwd?: string;
    stderr?: NodeJS.WritableStream;
  }
): Promise<void>;
