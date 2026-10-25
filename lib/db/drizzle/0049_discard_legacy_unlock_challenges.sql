-- These short-lived login challenges are NOT financial retry receipts.
-- Old unlock bindings derived from short PINs remain guessable after expiry.
-- Remove only those records; leave request/activation and financial evidence intact.
DELETE FROM pos_device_challenges WHERE purpose = 'unlock';
