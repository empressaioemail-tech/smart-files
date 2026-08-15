-- Seed folder id is folder:tenant:g58-probe:room. Backfill 002 picked a
-- sibling site-document scope. Restore the tenant scope PE mount queries.
UPDATE smart_file_folders
   SET scope_type = 'tenant',
       scope_id = 'g58-probe',
       label = 'room'
 WHERE folder_id = 'folder:tenant:g58-probe:room';
