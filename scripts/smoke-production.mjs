const publicBase = new URL(process.env.PUBLIC_BASE_URL || "https://sjtuai.art");
const bookBase = new URL(process.env.BOOK_BASE_URL || "https://wujiangai.art");

async function check(path, expectedStatus, base, redirect = "manual") {
  const response = await fetch(new URL(path, base), { redirect, signal: AbortSignal.timeout(10_000) });
  if (response.status !== expectedStatus) {
    throw new Error(`${new URL(path, base)} returned ${response.status}, expected ${expectedStatus}`);
  }
  return response;
}

const health = await check("/api/health", 200, publicBase);
const root = await check("/", 307, publicBase);
const expectedLogin = new URL("/login", publicBase);
expectedLogin.searchParams.set("next", "/");
if (root.headers.get("location") !== expectedLogin.href) {
  throw new Error(`unexpected root redirect: ${root.headers.get("location")}`);
}
await check("/login", 200, publicBase);
await check("/", 200, bookBase, "follow");
console.log(`smoke passed: health=${health.status} public=${publicBase.host} book=${bookBase.host}`);
