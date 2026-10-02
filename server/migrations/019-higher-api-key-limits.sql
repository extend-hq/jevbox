UPDATE apikey
SET "rateLimitMax"=6000
WHERE "rateLimitEnabled"=true
  AND "rateLimitTimeWindow"=60000
  AND "rateLimitMax"=180;
