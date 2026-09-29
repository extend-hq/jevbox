import { Pool } from "pg";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 1000,
});
try {
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      const response = await fetch(
        new URL("/v1/schema/read", process.env.SPICEDB_HTTP_URL),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SPICEDB_PRESHARED_KEY}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(1000),
        },
      );
      const body = await response.json();
      if (!response.ok && !(response.status === 404 && body.code === 5))
        throw new Error("Permission service is not ready");
      console.log("PostgreSQL and SpiceDB are ready.");
      break;
    } catch {
      if (attempt >= 29)
        throw new Error(
          "Local services did not become ready. Run pnpm services:logs.",
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
} finally {
  await pool.end();
}
