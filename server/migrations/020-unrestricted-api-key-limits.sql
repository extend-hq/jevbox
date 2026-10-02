UPDATE apikey
SET "rateLimitMax"=100000
WHERE "rateLimitEnabled"=true
  AND "rateLimitTimeWindow"=60000
  AND "rateLimitMax" IN (180,6000);
