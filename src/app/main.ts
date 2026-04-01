import { pathToFileURL } from "node:url";

export function renderHelloWorld(): string {
  return "Hello, world!\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(renderHelloWorld());
}
