export class TemplateRenderError extends Error {
  constructor(expression: string, message: string) {
    super(`Template variable '${expression}': ${message}`);
    this.name = "TemplateRenderError";
  }
}
