/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { runScheduler } from "./scheduler";

type RuntimeEnv = CloudflareEnv & {
  ASSETS: Fetcher;
  SMARTCAR_STORAGE_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
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
  let email: string | undefined;
  let name: string | undefined;

  if (ctx.access) {
    const identity = await ctx.access.getIdentity();
    email = identity?.email?.trim().toLowerCase();
    name = identity?.name;
  } else {
    // Workers with Static Assets execute behind an internal router Worker.
    // Cloudflare currently does not forward ctx.access through that router,
    // so validate the Access JWT on the original request instead.
    const token = request.headers.get("cf-access-jwt-assertion");
    const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
    if (!token || !teamDomain || !env.ACCESS_AUD) {
      return new Response("Cloudflare Access-konfiguration mangler", { status: 403 });
    }
    try {
      const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
      const { payload } = await jwtVerify(token, jwks, {
        issuer: teamDomain,
        audience: env.ACCESS_AUD,
      });
      email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined;
      name = typeof payload.name === "string" ? payload.name : undefined;
    } catch {
      return new Response("Cloudflare Access-tokenet kunne ikke valideres", { status: 403 });
    }
  }

  if (!email || email !== env.OWNER_EMAIL.trim().toLowerCase()) {
    return new Response("Du har ikke adgang til Elroqblik", { status: 403 });
  }
  headers.set(AUTH_EMAIL_HEADER, email);
  if (name) headers.set(AUTH_NAME_HEADER, name);
  return new Request(request, { headers });
}

function normalizeTeamDomain(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return undefined;
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}
