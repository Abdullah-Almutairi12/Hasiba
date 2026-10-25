-- Old shifts remain legacy NULL; never invent their historical terminal.
ALTER TABLE pos_sessions ADD COLUMN pos_station_id integer REFERENCES pos_device_stations(id) ON DELETE RESTRICT;
