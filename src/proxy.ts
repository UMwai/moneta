import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  verifySession,
} from "@/lib/auth/session";
import { store } from "@/lib/server/store";
import type { ApiError } from "@/lib/types";

const AUTH_API_PREFIX = "/api/auth/";
const AUTH_PAGES = new Set(["/login", "/setup"]);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith(AUTH_API_PREFIX)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;
  if (session) {
    if (AUTH_PAGES.has(pathname)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      } satisfies ApiError,
      { status: 401 },
    );
  }

  const destination = (await store.hasUser()) ? "/login" : "/setup";
  if (pathname === destination) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(destination, request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.[^/]+$).*)",
  ],
};
