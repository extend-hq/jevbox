ALTER TABLE resources ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE resources ADD CONSTRAINT resources_folder_pin CHECK (NOT pinned OR kind='folder');
