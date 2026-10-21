-- Invariant queries for systems checklist rows 25-40.
-- Run against a staging snapshot, not production. Every query returns rows that
-- VIOLATE the invariant; empty result = pass.

-- 39. Race conditions / oversell: stock must never go negative.
SELECT id, stock FROM products WHERE stock < 0;

-- 18/19. Ledger must balance: debits == credits per transaction.
SELECT transaction_id, SUM(amount) AS net
FROM ledger_entries
GROUP BY transaction_id
HAVING SUM(amount) <> 0;

-- 14. Idempotency: the same key must map to exactly one side effect.
SELECT idempotency_key, COUNT(*) AS effects
FROM payments
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- 14. Idempotency: the stored request hash must match the key.
SELECT idempotency_key, COUNT(DISTINCT request_hash) AS payloads
FROM idempotency_keys
GROUP BY idempotency_key
HAVING COUNT(DISTINCT request_hash) > 1;

-- 40. Deadlocks happening right now / recently.
SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocked_by, query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;

-- 37. Lock waits longer than 2 s.
SELECT pid, now() - query_start AS wait, query
FROM pg_stat_activity
WHERE state = 'active' AND wait_event_type = 'Lock' AND now() - query_start > interval '2 seconds';

-- 27. N+1 detector: statements per request should be flat as page size grows.
-- Compare two runs (page size 1 vs 100); calls should not scale linearly.
SELECT query, calls, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;

-- 25. Missing indexes on large tables: sequential scans over 100k rows.
SELECT relname, seq_scan, seq_tup_read, idx_scan,
       CASE WHEN seq_scan > 0 THEN seq_tup_read / seq_scan ELSE 0 END AS avg_rows_per_seq_scan
FROM pg_stat_user_tables
WHERE seq_tup_read > 100000
ORDER BY seq_tup_read DESC;

-- 26. Queries spilling to disk (plan is wrong or work_mem too small).
SELECT query, temp_blks_written, total_exec_time
FROM pg_stat_statements
WHERE temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT 10;

-- 29/32. Replication lag (run on primary).
SELECT client_addr, state, sent_lsn, replay_lsn,
       pg_wal_lsn_diff(sent_lsn, replay_lsn) AS lag_bytes
FROM pg_stat_replication;

-- 31. Partitioning: the default partition must stay empty, otherwise pruning is broken.
SELECT COUNT(*) AS rows_in_default_partition FROM events_default;

-- 28. Connection pooling: how close are we to max_connections?
SELECT COUNT(*) AS used, current_setting('max_connections')::int AS max,
       ROUND(100.0 * COUNT(*) / current_setting('max_connections')::int, 1) AS pct
FROM pg_stat_activity;

-- 36. Optimistic locking: versions must be monotonic and gapless per aggregate.
SELECT aggregate_id, COUNT(*) AS versions, MAX(version) AS max_version
FROM aggregate_versions
GROUP BY aggregate_id
HAVING MAX(version) <> COUNT(*);

-- 35. Eventual consistency: replica vs primary checksum for a hot table.
-- Run on both sides and diff the two results.
SELECT COUNT(*) AS rows, COALESCE(SUM(amount), 0) AS total, MAX(updated_at) AS newest FROM orders;
