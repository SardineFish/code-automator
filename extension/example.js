// @ts-check

/**
 * @typedef {{
 *   my_url?: string;
 *   message?: string;
 * }} ExampleExtensionConfig
 */

/** @type {import("./extensions").AppExtensionModule<ExampleExtensionConfig>} */
const exampleExtension = {
  API_VERSION: 1,
  async init(builder, context) {
    const routePath = context.config?.my_url ?? "/example-hook";

    context.log.info({
      message: "example extension initialized",
      extensionId: context.id,
      routePath
    });

    builder
      .service(async (app) => {
        app.log.info({
          message: "example extension service ready",
          extensionId: context.id,
          routePath: app.extensionConfig?.my_url ?? routePath
        });
      })
      .provider(routePath, async (workflow, _request, response) => {
        const message = workflow.extensionConfig?.message ?? `hello from ${context.id}`;

        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.end(
          JSON.stringify({
            extensionId: context.id,
            message
          })
        );
      });
  }
};

export default exampleExtension;
