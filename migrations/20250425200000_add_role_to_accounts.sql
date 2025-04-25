-- Migration: add role column to accounts
ALTER TABLE accounts
  ADD COLUMN role VARCHAR(10) NOT NULL DEFAULT 'user';

ALTER TABLE accounts
  ADD CONSTRAINT accounts_role_check CHECK (role IN ('user','admin'));
