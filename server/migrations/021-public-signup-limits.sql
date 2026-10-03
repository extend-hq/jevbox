UPDATE apikey
SET "rateLimitMax"=600
WHERE "rateLimitEnabled"=true
  AND "rateLimitTimeWindow"=60000
  AND "rateLimitMax" IN (6000,100000);
