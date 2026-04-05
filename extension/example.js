// @ts-check

/**
 * @typedef {{
 *   my_url?: string;
 *   message?: string;
 * }} ExampleExtensionConfig
 */

/** @type {import("./contract").AppExtensionModule<ExampleExtensionConfig>} */
const exampleExtension = {
  API_VERSION: 1,
  async init(builder, context) {
    const routePath =
      typeof context.config?.my_url === "string" && context.config.my_url.trim() !== ""
        ? context.config.my_url
        : "/example-hook";
    const message =
      typeof context.config?.message === "string" && context.config.message.trim() !== ""
        ? context.config.message
        : `hello from ${context.id}`;

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
          routePath
        });
      })
      .provider(routePath, async (_workflow, _request, response) => {
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
