import { resolve } from "node:path";
import { createStore } from "./db";

const store = await createStore(resolve(process.env.DATA_DIR ?? ".data"));
try {
  await store.files.ready();
  let total = 0;
  for (;;) {
    const count = await store.files.migrateBatch();
    total += count;
    if (!count) break;
    console.log(`Migrated and verified ${total} stored files`);
  }
  console.log(`Storage migration complete: ${total} files`);
} finally {
  await store.close();
}
