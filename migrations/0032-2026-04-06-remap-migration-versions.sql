-- Migration: Remap schema_migrations versions from old timestamp format to new sequential format
-- This is idempotent: UPDATE only matches rows with old-format version strings

DO $$
BEGIN
  -- Only run if schema_migrations table exists
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_name = 'schema_migrations'
  ) THEN
    -- Remap old timestamp versions to new 4-digit sequential versions
    UPDATE schema_migrations SET version = '0000' WHERE version = '20250101000000';
    UPDATE schema_migrations SET version = '0001' WHERE version = '20250101000001';
    UPDATE schema_migrations SET version = '0002' WHERE version = '20250101000002';
    UPDATE schema_migrations SET version = '0003' WHERE version = '20250101000003';
    UPDATE schema_migrations SET version = '0004' WHERE version = '20250118130000';
    UPDATE schema_migrations SET version = '0005' WHERE version = '20250118140000';
    UPDATE schema_migrations SET version = '0006' WHERE version = '20250119000000';
    UPDATE schema_migrations SET version = '0007' WHERE version = '20250131000000';
    UPDATE schema_migrations SET version = '0008' WHERE version = '20250422154502';
    UPDATE schema_migrations SET version = '0009' WHERE version = '20250422200000';
    UPDATE schema_migrations SET version = '0010' WHERE version = '20250422200100';
    UPDATE schema_migrations SET version = '0011' WHERE version = '20250422210800';
    UPDATE schema_migrations SET version = '0012' WHERE version = '20250425110600';
    UPDATE schema_migrations SET version = '0013' WHERE version = '20250425192000';
    UPDATE schema_migrations SET version = '0014' WHERE version = '20250425193500';
    UPDATE schema_migrations SET version = '0015' WHERE version = '20250425200000';
    UPDATE schema_migrations SET version = '0016' WHERE version = '20250426211705';
    UPDATE schema_migrations SET version = '0017' WHERE version = '20250426215500';
    UPDATE schema_migrations SET version = '0018' WHERE version = '20250428230000';
    UPDATE schema_migrations SET version = '0019' WHERE version = '20250428';
    UPDATE schema_migrations SET version = '0020' WHERE version = '20250429172200';
    UPDATE schema_migrations SET version = '0021' WHERE version = '20250429180100';
    UPDATE schema_migrations SET version = '0022' WHERE version = '20250429181400';
    UPDATE schema_migrations SET version = '0023' WHERE version = '20250429215200';
    UPDATE schema_migrations SET version = '0024' WHERE version = '20250430000000';
    UPDATE schema_migrations SET version = '0025' WHERE version = '20250430000001';
    UPDATE schema_migrations SET version = '0026' WHERE version = 'add_contract_auto_cancellations';
    UPDATE schema_migrations SET version = '0027' WHERE version = '20250530163900';
    UPDATE schema_migrations SET version = '0028' WHERE version = '20250912000000';
    UPDATE schema_migrations SET version = '0029' WHERE version = '20250912000001';
    UPDATE schema_migrations SET version = '0030' WHERE version = '20250912000002';
    UPDATE schema_migrations SET version = '0031' WHERE version = '20250912000003';

    RAISE NOTICE 'Migration versions remapped to sequential format';
  END IF;
END $$;
