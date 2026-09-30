import { resolve } from "node:path";
import { createStore } from "./db";
import { createWorkers } from "./workers";

const store = await createStore(resolve(process.env.DATA_DIR ?? ".data"));
let workers: ReturnType<typeof createWorkers>;
try {
  workers = createWorkers(store, {
    origin: process.env.APP_ORIGIN ?? "http://localhost:4310",
  });
  await workers.start();
  console.log("Background workers are ready");
} catch (error) {
  await store.close();
  throw error;
}
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 40_000);
    timeout.unref();
    void workers
      .close()
      .then(() => store.close())
      .then(() => process.exit(0))
      .catch(() => {
        console.error("Background worker shutdown failed");
        process.exit(1);
      });
  });
