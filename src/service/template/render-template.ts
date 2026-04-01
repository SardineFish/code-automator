import { TemplateRenderError } from "./template-render-error.js";

const TEMPLATE_VARIABLE_PATTERN = /\$\{([^}]+)\}/g;

export function renderTemplate<T extends object>(template: string, variables: T): string {
  return template.replaceAll(TEMPLATE_VARIABLE_PATTERN, (_, expressionRaw: string) => {
    const expression = expressionRaw.trim();

    if (expression.length === 0) {
      throw new TemplateRenderError(expressionRaw, "Variable expression is empty.");
    }

    return stringifyTemplateValue(resolveExpression(variables, expression), expression);
  });
}

function resolveExpression<T extends object>(variables: T, expression: string): unknown {
  const variableMap = variables as Record<string, unknown>;
  const segments = expression.split(".");
  const [rootKey, ...pathSegments] = segments;

  if (!hasOwn(variableMap, rootKey)) {
    throw new TemplateRenderError(expression, `Unsupported root '${rootKey}'.`);
  }

  let current: unknown = variableMap[rootKey];

  for (const segment of pathSegments) {
    if (!segment) {
      throw new TemplateRenderError(expression, "Invalid path segment.");
    }

    if (!isTraversableObject(current)) {
      throw new TemplateRenderError(expression, `Cannot traverse '${segment}'.`);
    }

    if (!hasOwn(current, segment)) {
      throw new TemplateRenderError(expression, `Missing value at '${segment}'.`);
    }

    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined) {
    throw new TemplateRenderError(expression, "Resolved value is undefined.");
  }

  return current;
}

function isTraversableObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyTemplateValue(value: unknown, expression: string): string {
  if (value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    const rendered = JSON.stringify(value);

    if (rendered === undefined) {
      throw new TemplateRenderError(expression, "Unsupported value type.");
    }

    return rendered;
  } catch (error) {
    if (error instanceof TemplateRenderError) {
      throw error;
    }

    throw new TemplateRenderError(expression, "Unsupported value type.");
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}
