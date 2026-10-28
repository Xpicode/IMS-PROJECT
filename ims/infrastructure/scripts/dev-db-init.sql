-- Runs once when the dev Postgres volume is first created.
-- Creates the database used by integration tests (tests/integration).
CREATE DATABASE ims_test OWNER ims_app;
