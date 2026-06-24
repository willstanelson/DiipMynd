import { test, expect } from "@playwright/test";

test("Unauthenticated request to /api/auth/me returns 401", async ({ request }) => {
  const res = await request.get("/api/auth/me");
  expect(res.status()).toBe(401);
});

test("Cookies contain secure flags on successful sign in", async ({ context, page }) => {
  await page.goto("/");
  
  // Fill test credentials loaded from environment variables
  await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL!);
  await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD!);
  await page.click('button[type="submit"]');

  // Verify layout page loads successfully
  await page.waitForSelector('#btn-start');
  
  const cookies = await context.cookies();
  const authCookie = cookies.find((c) => c.name.startsWith("sb-"));
  
  expect(authCookie).toBeDefined();
  expect(authCookie!.httpOnly).toBe(false);
  expect(authCookie!.sameSite).toBe("Lax");

  // Conditional verification for secure protocol flags (Secure is only true over HTTPS)
  const isHttps = process.env.BASE_URL?.startsWith("https") ?? false;
  if (isHttps) {
    expect(authCookie!.secure).toBe(true);
  }
});
