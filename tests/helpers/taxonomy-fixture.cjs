// Downgrade a test-only fresh database to the exact pre-taxonomy schema.
// Never use this helper on an application profile.
module.exports = function legacyTaxonomy(store, assignments = []) {
  store.db.exec(`
    DROP TRIGGER notes_subcategory_insert; DROP TRIGGER notes_subcategory_update;
    DROP TRIGGER drafts_subcategory_insert; DROP TRIGGER drafts_subcategory_update;
    DROP TRIGGER subcategory_parent_update; DROP TRIGGER category_clear_assignments;
    DROP INDEX notes_subcategory;
    ALTER TABLE notes DROP COLUMN subcategory_id;
    ALTER TABLE drafts DROP COLUMN subcategory_id;
    DROP TABLE taxonomy_migration_mapping; DROP TABLE taxonomy_migration_review; DROP TABLE subcategories;
    ALTER TABLE item_tags ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
    CREATE INDEX item_tags_category ON item_tags(category_id,name);
    CREATE INDEX item_tags_order ON item_tags(category_id,position,id);
    DROP INDEX planner_events_series;
    ALTER TABLE planner_events DROP COLUMN series_id;
    DELETE FROM schema_migrations WHERE version>=12;
  `)
  for (const [tagId, categoryId] of assignments) store.db.prepare('UPDATE item_tags SET category_id=? WHERE id=?').run(categoryId, tagId)
}
