-- Global browser admission. Unknown resources retain their slot until closure
-- is verified; a wall-clock expiry never proves a remote browser is gone.
CREATE TABLE IF NOT EXISTS parkio_login_slots (
 scope TEXT PRIMARY KEY, acquired_at INTEGER NOT NULL
);
