-- Preserve legacy NULLs; a cashier name is not proof of a historical user.
ALTER TABLE pos_sessions ADD COLUMN cashier_user_id integer REFERENCES users(id) ON DELETE RESTRICT;
