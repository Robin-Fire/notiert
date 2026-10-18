import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../shared/errors'
import { addLocalDays, fromLocalISODate, mondayISO, toLocalISODate } from '../../shared/plannerDates'
import { horizonOf, type TaskIntention } from '../../shared/taskHorizons'
import type { Store } from './database'

export function migrateDatabase(store: Pick<Store, 'db' | 'path' | 'migrationReview'>) {
    const hasMigrationTable = Boolean(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get())
    const currentVersion = hasMigrationTable ? (store.db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 0 : 0
    if (currentVersion > 18) throw new AppError('DB_NEWER_VERSION', 'This database has an unsupported captured schema.')
    if (hasMigrationTable && currentVersion < 18) {
      const backupDirectory = path.join(path.dirname(store.path), 'backups')
      fs.mkdirSync(backupDirectory, { recursive: true })
      const checkpoint = store.db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
      if (checkpoint.some(row=>row.busy)) throw new AppError('DB_BUSY','Close other instances before upgrading.')
      const backupName = `pre-migration-${Date.now()}.sqlite`
      store.db.prepare('VACUUM INTO ?').run(path.join(backupDirectory, backupName))
      const older = fs.readdirSync(backupDirectory).filter((name) => name.startsWith('pre-migration-') && name.endsWith('.sqlite')).sort().reverse().slice(1)
      for (const name of older) fs.rmSync(path.join(backupDirectory, name), { force: true })
    }
    store.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);`)
    const applied = new Set((store.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version))
    if (!applied.has(1)) {
      const transaction = store.db.transaction(() => {
        store.db.exec(`
          CREATE TABLE notes (
            id TEXT PRIMARY KEY, capture_request_id TEXT UNIQUE, body TEXT NOT NULL,
            meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, revision INTEGER NOT NULL DEFAULT 1
          );
          CREATE TABLE meetings (
            id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
            started_at INTEGER NOT NULL, ended_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE TABLE drafts(key TEXT PRIMARY KEY, body TEXT NOT NULL, meeting_id TEXT, generation INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
          CREATE TABLE app_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE INDEX notes_created ON notes(deleted_at, created_at DESC, id DESC);
          CREATE INDEX notes_meeting_created ON notes(meeting_id, created_at DESC, id DESC);
          CREATE VIRTUAL TABLE note_search USING fts5(note_id UNINDEXED, body, meeting_title, tokenize='unicode61 remove_diacritics 2');
        `)
        store.db.prepare('INSERT INTO drafts(key,body,generation,revision,updated_at) VALUES(\'capture\',\'\',0,0,?)').run(Date.now())
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(Date.now())
      })
      transaction()
    }
    if (!applied.has(2)) {
      const transaction = store.db.transaction(() => {
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(2,?)').run(Date.now())
      })
      transaction()
    }
    if (!applied.has(3)) {
      const transaction = store.db.transaction(() => {
        store.db.exec(`
          ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';
          ALTER TABLE notes ADD COLUMN processed_at INTEGER;
          ALTER TABLE notes ADD COLUMN task_status TEXT;
          ALTER TABLE notes ADD COLUMN planned_date TEXT;
          ALTER TABLE notes ADD COLUMN due_date TEXT;
          ALTER TABLE notes ADD COLUMN task_position INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE notes ADD COLUMN before_event_id TEXT;
          ALTER TABLE notes ADD COLUMN completed_at INTEGER;
          CREATE TABLE item_tags(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
          CREATE TABLE note_tags(note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES item_tags(id) ON DELETE CASCADE, PRIMARY KEY(note_id,tag_id));
          CREATE TABLE planner_events(id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120), start_at INTEGER NOT NULL, end_at INTEGER NOT NULL, all_day INTEGER NOT NULL DEFAULT 0 CHECK(all_day IN (0,1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
          CREATE INDEX notes_kind_created ON notes(kind,deleted_at,created_at DESC,id DESC);
          CREATE INDEX notes_plan ON notes(kind,task_status,planned_date,task_position);
          CREATE INDEX planner_events_start ON planner_events(start_at,end_at);
          ALTER TABLE meetings RENAME TO legacy_meeting_sessions;
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(3,?)').run(Date.now())
      })
      transaction()
    }
    if (!applied.has(4)) {
      const transaction = store.db.transaction(() => {
        store.db.exec(`
          CREATE TABLE item_images(id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, position INTEGER NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL);
          CREATE INDEX item_images_note ON item_images(note_id,position);
          CREATE TABLE capture_draft_images(id TEXT PRIMARY KEY, position INTEGER NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL);
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(4,?)').run(Date.now())
      })
      transaction()
    }
    if (!applied.has(5)) {
      store.db.transaction(() => {
        store.db.exec(`
          CREATE TABLE categories(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, position INTEGER NOT NULL);
          ALTER TABLE item_tags ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
          ALTER TABLE item_tags ADD COLUMN color TEXT NOT NULL DEFAULT '#85858e';
          CREATE INDEX item_tags_category ON item_tags(category_id,name);
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(5,?)').run(Date.now())
      })()
    }
    if (!applied.has(6)) {
      store.db.transaction(() => {
        store.db.exec(`
          ALTER TABLE notes ADD COLUMN project_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
          ALTER TABLE notes ADD COLUMN task_ready INTEGER NOT NULL DEFAULT 0 CHECK(task_ready IN (0,1));
          UPDATE notes SET task_ready=1 WHERE kind='task' AND planned_date IS NOT NULL;
          UPDATE notes SET project_id=(SELECT min(t.category_id) FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=notes.id AND t.category_id IS NOT NULL)
            WHERE kind='task' AND 1=(SELECT count(DISTINCT t.category_id) FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=notes.id AND t.category_id IS NOT NULL);
          CREATE INDEX notes_backlog ON notes(kind,deleted_at,task_status,task_ready,project_id,created_at);
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(6,?)').run(Date.now())
      })()
    }
    if (!applied.has(7)) {
      store.db.transaction(() => {
        store.db.exec(`
          UPDATE notes SET deleted_at=coalesce(completed_at,updated_at),task_status='open',completed_at=NULL,planned_date=NULL,before_event_id=NULL,task_ready=0,task_position=0,revision=revision+1
          WHERE kind='task' AND task_status='done';
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(7,?)').run(Date.now())
      })()
    }
    if (!applied.has(8)) {
      store.db.transaction(() => {
        store.db.exec(`
          ALTER TABLE drafts ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;
          ALTER TABLE notes ADD COLUMN backlog_position INTEGER NOT NULL DEFAULT 0;
          UPDATE notes SET project_id=(
            SELECT min(t.category_id) FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id
            WHERE nt.note_id=notes.id AND t.category_id IS NOT NULL
          ) WHERE kind<>'task' AND project_id IS NULL AND 1=(
            SELECT count(DISTINCT t.category_id) FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id
            WHERE nt.note_id=notes.id AND t.category_id IS NOT NULL
          );
          UPDATE notes AS n SET backlog_position=(
            SELECT count(*) FROM notes AS o WHERE o.kind='task' AND o.task_status='open' AND o.deleted_at IS NULL
              AND o.project_id IS n.project_id AND (o.created_at>n.created_at OR (o.created_at=n.created_at AND o.id>n.id))
          ) WHERE n.kind='task' AND n.task_status='open' AND n.deleted_at IS NULL;
          CREATE INDEX notes_backlog_priority ON notes(kind,deleted_at,task_status,task_ready,planned_date,project_id,backlog_position,id);
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(8,?)').run(Date.now())
      })()
    }
    if (!applied.has(9)) {
      store.db.transaction(() => {
        store.db.exec(`
          UPDATE notes SET completed_at=coalesce(completed_at,updated_at)
          WHERE kind='task' AND task_status='done' AND deleted_at IS NULL;
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(9,?)').run(Date.now())
      })()
    }
    if (!applied.has(10)) {
      store.db.transaction(() => {
        store.db.exec(`
          ALTER TABLE notes ADD COLUMN planned_start_at INTEGER;
          ALTER TABLE notes ADD COLUMN planned_end_at INTEGER;
          CREATE INDEX notes_timed_plan ON notes(kind,deleted_at,planned_start_at,planned_end_at);
          CREATE TRIGGER notes_timing_insert BEFORE INSERT ON notes
          WHEN NOT ((NEW.planned_start_at IS NULL AND NEW.planned_end_at IS NULL) OR
            (NEW.kind='task' AND NEW.planned_date IS NOT NULL AND NEW.before_event_id IS NULL AND NEW.planned_start_at IS NOT NULL AND NEW.planned_end_at IS NOT NULL AND NEW.planned_end_at>NEW.planned_start_at))
          BEGIN SELECT RAISE(ABORT,'Invalid task time range'); END;
          CREATE TRIGGER notes_timing_update BEFORE UPDATE ON notes
          WHEN NOT ((NEW.planned_start_at IS NULL AND NEW.planned_end_at IS NULL) OR
            (NEW.kind='task' AND NEW.planned_date IS NOT NULL AND NEW.before_event_id IS NULL AND NEW.planned_start_at IS NOT NULL AND NEW.planned_end_at IS NOT NULL AND NEW.planned_end_at>NEW.planned_start_at))
          BEGIN SELECT RAISE(ABORT,'Invalid task time range'); END;
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(10,?)').run(Date.now())
      })()
    }
    if (!applied.has(11)) {
      store.db.transaction(() => {
        store.db.exec(`
          ALTER TABLE item_tags ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
          CREATE INDEX item_tags_order ON item_tags(category_id,position,id);
          UPDATE item_tags AS t SET position=(SELECT count(*) FROM item_tags AS earlier WHERE earlier.category_id IS t.category_id AND (earlier.name COLLATE NOCASE<t.name COLLATE NOCASE OR (earlier.name COLLATE NOCASE=t.name COLLATE NOCASE AND earlier.id<t.id)));
          ALTER TABLE notes ADD COLUMN is_later INTEGER NOT NULL DEFAULT 0 CHECK(is_later IN (0,1));
          CREATE INDEX notes_later ON notes(kind,deleted_at,task_status,is_later,project_id,backlog_position);
        `)
        store.db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(11,?)').run(Date.now())
      })()
    }
    if (!applied.has(12)) {
      store.db.transaction(() => {
        const legacy = store.db.prepare('SELECT t.* FROM item_tags t LEFT JOIN categories c ON c.id=t.category_id ORDER BY coalesce(c.position,-1),t.position,t.name COLLATE NOCASE,t.id').all() as { id: string; name: string; category_id: string | null; color: string; position: number }[]
        const originalLinks = (store.db.prepare('SELECT count(*) AS count FROM note_tags').get() as { count: number }).count
        store.db.exec(`
          CREATE TABLE subcategories(id TEXT PRIMARY KEY,category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,name TEXT NOT NULL COLLATE NOCASE,color TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,UNIQUE(category_id,name));
          ALTER TABLE notes ADD COLUMN subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL;
          ALTER TABLE drafts ADD COLUMN subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL;
          CREATE TABLE taxonomy_migration_mapping(tag_id TEXT PRIMARY KEY,subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE);
          CREATE TABLE taxonomy_migration_review(note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,reason TEXT NOT NULL,candidates TEXT NOT NULL);
          CREATE INDEX notes_subcategory ON notes(project_id,subcategory_id,deleted_at,backlog_position,id);
          CREATE INDEX subcategories_order ON subcategories(category_id,position,id);
        `)
        const mapping = new Map<string,string>()
        for (const tag of legacy) if (tag.category_id) {
          const id = randomUUID(); mapping.set(tag.id,id)
          store.db.prepare('INSERT INTO subcategories(id,category_id,name,color,position) VALUES(?,?,?,?,?)').run(id,tag.category_id,tag.name,tag.color,tag.position)
          store.db.prepare('INSERT INTO taxonomy_migration_mapping VALUES(?,?)').run(tag.id,id)
        }
        for (const item of store.db.prepare('SELECT id,project_id FROM notes').all() as { id: string; project_id: string | null }[]) {
          const linked = store.db.prepare('SELECT t.id,t.category_id FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=? AND t.category_id IS NOT NULL ORDER BY t.position,t.id').all(item.id) as { id: string; category_id: string }[]
          const matching = linked.filter(tag=>tag.category_id===item.project_id)
          if (matching.length===1) store.db.prepare('UPDATE notes SET subcategory_id=? WHERE id=?').run(mapping.get(matching[0]!.id)!,item.id)
          if (matching.length>1 || linked.some(tag=>tag.category_id!==item.project_id)) store.db.prepare('INSERT INTO taxonomy_migration_review VALUES(?,?,?)').run(item.id,matching.length>1 ? 'multiple-matching-subcategories' : item.project_id ? 'foreign-category-labels' : 'unassigned-category',JSON.stringify(linked.map(tag=>mapping.get(tag.id))))
        }
        store.db.exec(`CREATE TEMP TABLE preserved_note_tags AS SELECT * FROM note_tags; DROP TABLE note_tags; DROP TABLE item_tags;
          CREATE TABLE item_tags(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE COLLATE NOCASE,color TEXT NOT NULL DEFAULT '#85858e',position INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE note_tags(note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,tag_id TEXT NOT NULL REFERENCES item_tags(id) ON DELETE CASCADE,PRIMARY KEY(note_id,tag_id));`)
        legacy.forEach((tag,position)=>store.db.prepare('INSERT INTO item_tags VALUES(?,?,?,?)').run(tag.id,tag.name,tag.color,position))
        store.db.exec('INSERT INTO note_tags SELECT * FROM preserved_note_tags; DROP TABLE preserved_note_tags;')
        for (const table of ['notes','drafts']) for (const operation of ['INSERT','UPDATE']) store.db.exec(`CREATE TRIGGER ${table}_subcategory_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.subcategory_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM subcategories s WHERE s.id=NEW.subcategory_id AND s.category_id=NEW.${table==='notes'?'project_id':'category_id'}) BEGIN SELECT RAISE(ABORT,'Subcategory must belong to item category'); END;`)
        store.db.exec(`CREATE TRIGGER subcategory_parent_update BEFORE UPDATE OF category_id ON subcategories WHEN NEW.category_id<>OLD.category_id BEGIN SELECT RAISE(ABORT,'Subcategory parent cannot change'); END;
          CREATE TRIGGER category_clear_assignments BEFORE DELETE ON categories BEGIN UPDATE notes SET subcategory_id=NULL WHERE project_id=OLD.id; UPDATE drafts SET subcategory_id=NULL WHERE category_id=OLD.id; END;`)
        if ((store.db.prepare('SELECT count(*) AS count FROM note_tags').get() as { count: number }).count!==originalLinks || (store.db.pragma('foreign_key_check') as unknown[]).length) throw new AppError('MIGRATION_FAILED','Taxonomy preservation checks failed.')
        store.db.prepare("INSERT OR REPLACE INTO app_state VALUES('taxonomy-upgrade',?)").run(JSON.stringify({subcategories:mapping.size,assigned:(store.db.prepare('SELECT count(*) AS count FROM notes WHERE subcategory_id IS NOT NULL').get() as {count:number}).count,review:store.migrationReview().reduce((counts,row)=>({...counts,[row.reason]:(counts[row.reason]??0)+1}),{} as Record<string,number>)}))
        store.db.prepare('INSERT INTO schema_migrations VALUES(12,?)').run(Date.now())
      })()
    }
    if (!applied.has(13)) store.db.transaction(() => {
      store.db.exec('ALTER TABLE planner_events ADD COLUMN series_id TEXT; CREATE INDEX planner_events_series ON planner_events(series_id);')
      store.db.prepare('INSERT INTO schema_migrations VALUES(13,?)').run(Date.now())
    })()
    if (!applied.has(14)) store.db.transaction(() => {
      store.db.exec(`CREATE TABLE task_intentions(note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('unplanned','day','week','later')), target_date TEXT, position INTEGER NOT NULL CHECK(position>=0), CHECK((kind IN ('unplanned','later') AND target_date IS NULL) OR (kind IN ('day','week') AND target_date IS NOT NULL)));
        CREATE INDEX task_intentions_order ON task_intentions(kind,target_date,position,note_id);
        ALTER TABLE drafts ADD COLUMN capture_kind TEXT NOT NULL DEFAULT 'inbox' CHECK(capture_kind IN ('inbox','task','note'));`)
      const today = toLocalISODate(new Date())
      const rows = store.db.prepare("SELECT id,is_later,planned_date,planned_start_at,task_ready FROM notes WHERE kind='task' ORDER BY project_id,CASE WHEN task_ready=1 THEN task_position ELSE backlog_position END,id").all() as { id: string; is_later: number; planned_date: string | null; planned_start_at: number | null; task_ready: number }[]
      const insert = store.db.prepare('INSERT INTO task_intentions VALUES(?,?,?,?)')
      rows.forEach((row, position) => {
        const date = row.planned_date ?? (row.planned_start_at === null ? null : toLocalISODate(new Date(row.planned_start_at)))
        insert.run(row.id, row.is_later ? 'later' : date || row.task_ready ? 'day' : 'unplanned', row.is_later ? null : date ?? (row.task_ready ? today : null), position)
      })
      store.db.exec(`CREATE TRIGGER task_intention_insert AFTER INSERT ON notes WHEN NEW.kind='task' BEGIN INSERT OR IGNORE INTO task_intentions VALUES(NEW.id,'unplanned',NULL,(SELECT coalesce(max(position),-1)+1 FROM task_intentions)); END;
        CREATE TRIGGER task_intention_classify AFTER UPDATE OF kind ON notes WHEN NEW.kind='task' BEGIN INSERT OR IGNORE INTO task_intentions VALUES(NEW.id,'unplanned',NULL,(SELECT coalesce(max(position),-1)+1 FROM task_intentions)); END;
        CREATE TRIGGER task_intention_unfile AFTER UPDATE OF kind ON notes WHEN NEW.kind<>'task' BEGIN DELETE FROM task_intentions WHERE note_id=NEW.id; END;`)
      store.db.prepare('INSERT INTO schema_migrations VALUES(14,?)').run(Date.now())
    })()
    if (!applied.has(15)) store.db.transaction(() => {
      const today = toLocalISODate(new Date()), monday = mondayISO(fromLocalISODate(today)), next = addLocalDays(monday, 7), tomorrow = addLocalDays(today, 1)
      const deferred = store.db.prepare("SELECT note_id FROM task_intentions WHERE (kind='week' AND target_date=?) OR (kind='day' AND target_date>? AND target_date<?) ORDER BY position,note_id").all(monday, tomorrow, next) as { note_id: string }[]
      let position = (store.db.prepare('SELECT coalesce(max(position),-1) AS position FROM task_intentions').get() as { position: number }).position + 1
      for (const item of deferred) {
        store.db.prepare("UPDATE task_intentions SET kind='later',target_date=NULL,position=? WHERE note_id=?").run(position++, item.note_id)
        store.db.prepare('UPDATE notes SET revision=revision+1 WHERE id=?').run(item.note_id)
      }
      store.db.prepare('INSERT INTO schema_migrations VALUES(15,?)').run(Date.now())
    })()
    if (!applied.has(16)) store.db.transaction(() => {
      if (!(store.db.pragma('table_info(categories)') as { name: string }[]).some(column => column.name === 'color')) store.db.exec("ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#85858e'");
      store.db.prepare('INSERT INTO schema_migrations VALUES(16,?)').run(Date.now());
    })()
    if (!applied.has(17)) store.db.transaction(() => {
      // Preserve reference content as completed tasks; old captures become Backlog tasks.
      store.db.prepare("UPDATE notes SET kind='task',task_status=CASE WHEN kind='note' THEN 'done' ELSE 'open' END,completed_at=CASE WHEN kind='note' THEN coalesce(completed_at,updated_at,created_at) ELSE NULL END,processed_at=coalesce(processed_at,created_at),task_ready=0,is_later=0,planned_date=NULL,planned_start_at=NULL,planned_end_at=NULL,before_event_id=NULL,revision=revision+1 WHERE kind IN ('note','inbox')").run()
      store.db.prepare("UPDATE drafts SET capture_kind='task'").run()
      store.db.prepare('INSERT INTO schema_migrations VALUES(17,?)').run(Date.now())
    })()
    if (!applied.has(18)) store.db.transaction(() => {
      const today = toLocalISODate(new Date())
      const rows = store.db.prepare('SELECT note_id,kind,target_date AS targetDate,position FROM task_intentions ORDER BY position,note_id').all() as (TaskIntention & { note_id: string })[]
      // Rebuild the constraint while preserving task IDs, ordering, and calendar schedules.
      store.db.exec(`DROP TRIGGER task_intention_insert; DROP TRIGGER task_intention_classify; DROP TRIGGER task_intention_unfile;
        DROP TABLE task_intentions;
        CREATE TABLE task_intentions(note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('unplanned','now','next','soon','later','day','week')),target_date TEXT,position INTEGER NOT NULL CHECK(position>=0),CHECK((kind IN ('unplanned','now','next','soon','later') AND target_date IS NULL) OR (kind IN ('day','week') AND target_date IS NOT NULL)));
        CREATE INDEX task_intentions_order ON task_intentions(kind,target_date,position,note_id);`)
      const insert = store.db.prepare('INSERT INTO task_intentions VALUES(?,?,NULL,?)')
      const positions = new Map<string, number>()
      for (const row of rows) {
        const bucket = horizonOf(row, today), position = positions.get(bucket) ?? 0
        insert.run(row.note_id, bucket, position)
        positions.set(bucket, position + 1)
        store.db.prepare('UPDATE notes SET revision=revision+1 WHERE id=?').run(row.note_id)
      }
      store.db.exec(`CREATE TRIGGER task_intention_insert AFTER INSERT ON notes WHEN NEW.kind='task' BEGIN INSERT OR IGNORE INTO task_intentions VALUES(NEW.id,'unplanned',NULL,(SELECT coalesce(max(position),-1)+1 FROM task_intentions)); END;
        CREATE TRIGGER task_intention_classify AFTER UPDATE OF kind ON notes WHEN NEW.kind='task' BEGIN INSERT OR IGNORE INTO task_intentions VALUES(NEW.id,'unplanned',NULL,(SELECT coalesce(max(position),-1)+1 FROM task_intentions)); END;
        CREATE TRIGGER task_intention_unfile AFTER UPDATE OF kind ON notes WHEN NEW.kind<>'task' BEGIN DELETE FROM task_intentions WHERE note_id=NEW.id; END;`)
      store.db.prepare('INSERT INTO schema_migrations VALUES(18,?)').run(Date.now())
    })()
    const version = store.db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number | null }
    if (version.version !== 18) throw new AppError('DB_INVALID_SCHEMA', 'This database has an unsupported captured schema.')
}
