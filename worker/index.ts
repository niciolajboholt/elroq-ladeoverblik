/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runScheduler } from "./scheduler";

type RuntimeEnv = CloudflareEnv & {
  ASSETS: Fetcher;
  SMARTCAR_STORAGE_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
};

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  access?: {
    aud: string;
    getIdentity(): Promise<{ email?: string; name?: string } | null>;
  };
}

declare global {
  var __ELROQ_ENV__: {
    DB: D1Database;
    OWNER_EMAIL?: string;
    SMARTCAR_STORAGE_KEY?: string;
  } | undefined;
}

const AUTH_EMAIL_HEADER = "x-elroq-authenticated-user-email";
const AUTH_NAME_HEADER = "x-elroq-authenticated-user-name";

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: RuntimeEnv, ctx: WorkerExecutionContext): Promise<Response> {
    globalThis.__ELROQ_ENV__ = {
      DB: env.DB,
      OWNER_EMAIL: env.OWNER_EMAIL,
      SMARTCAR_STORAGE_KEY: env.SMARTCAR_STORAGE_KEY,
    };
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const authenticatedRequest = await authorizeRequest(request, env, ctx);
    if (authenticatedRequest instanceof Response) return authenticatedRequest;
    return handler.fetch(authenticatedRequest, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: RuntimeEnv, ctx: WorkerExecutionContext): Promise<void> {
    globalThis.__ELROQ_ENV__ = {
      DB: env.DB,
      OWNER_EMAIL: env.OWNER_EMAIL,
      SMARTCAR_STORAGE_KEY: env.SMARTCAR_STORAGE_KEY,
    };
    ctx.waitUntil(runScheduler(env, new Date(controller.scheduledTime)));
  },
};

export default worker;

async function authorizeRequest(
  request: Request,
  env: RuntimeEnv,
  ctx: WorkerExecutionContext,
): Promise<Request | Response> {
  const headers = new Headers(request.headers);
  headers.delete(AUTH_EMAIL_HEADER);
  headers.delete(AUTH_NAME_HEADER);

  if (env.REQUIRE_CLOUDFLARE_ACCESS !== "true") {
    return new Request(request, { headers });
  }
  if (!ctx.access) {
    return new Response("Cloudflare Access er påkrævet", { status: 403 });
  }
  const identity = await ctx.access.getIdentity();
  const email = identity?.email?.trim().toLowerCase();
  if (!email || email !== env.OWNER_EMAIL.trim().toLowerCase()) {
    return new Response("Du har ikke adgang til Elroqblik", { status: 403 });
  }
  headers.set(AUTH_EMAIL_HEADER, email);
  if (identity?.name) headers.set(AUTH_NAME_HEADER, identity.name);
  return new Request(request, { headers });
}
