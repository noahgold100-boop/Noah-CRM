// Test-only: let Node resolve extensionless relative imports ("./db") to .ts files, like the Next bundler does.
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function resolve(spec, ctx, next) {
        if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[a-z]+$/i.test(spec)) {
          try { return await next(spec + ".ts", ctx); } catch {}
        }
        return next(spec, ctx);
      }`),
  import.meta.url,
);
