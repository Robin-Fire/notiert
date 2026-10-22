# Service coverage register

Open `index.html` in a modern browser. No installation, build, internet, account, or server is required. The monochrome interface uses plain HTML, CSS, and JavaScript.

## Shared-drive workflow

The HTML contains all data and column definitions. No JSON file is required.

1. Copy index.html to your shared drive (you can rename it service-coverage.html).
2. Open the latest shared copy in your browser.
3. Edit the table, then click **Save HTML**.
4. Save the download back to the shared drive, replacing the previous file. Depending on browser settings, you may need to move it from Downloads.
5. Colleagues reopen the shared file to see the updates.

Only one person should edit at a time. There is no file locking, automatic refresh, or merging of concurrent edits. Browser drafts are local recovery copies; they never update the shared file. The browser cannot verify that you replaced the shared copy.

JSON import/export remains under File options for optional backups and migration.

## Features

- Area → Extension → Service hierarchy with group headings. Edit Area and Extension cells to reorganize a service; new services require both. Older imports and browser drafts receive blank hierarchy fields and appear under Unassigned until classified.
- Search across all fields, including Area and Extension. Multiple words must all match, even across different fields (for example, `Commerce payments`).
- Area and Extension filters; selecting an area narrows extension choices. Extensions with the same name in different areas remain separate. Header sorting applies within each extension. Pagination still counts services, and repeats hierarchy headings when a group spans pages.

- Editable cells; Enter commits, Escape cancels, leaving a cell commits.
- Dropdown coverage states, area, extension, and criticality filters, full-text search, one additional contains filter on any column.
- Click headers to sort; 25 services per page; service name stays pinned while scrolling.
- Add services; confirm deletion; undo the last 30 data changes during the session.
- Add text, number, date, or dropdown columns; rename, hide, and reorder columns. Service name remains visible and first. Hidden fields retain all data.
- Export/import JSON (including column definitions) or export a standalone HTML snapshot.
- Summary counts always describe the full register; table counts reflect filters.

## Assessment conventions

Coverage dimensions: Unknown = not reviewed; Missing = no checks; Partial = important gaps; Target met = agreed expectations satisfied with evidence; N/A = not applicable with a reason. Record evidence and rationale using the available column. Review dates are explicit, not updated automatically on unrelated edits.

Critical gaps means a Critical service with any built-in coverage dimension marked Unknown, Missing, or Partial. Custom columns do not change this calculation. Needs assessment means the Assessment field is not Assessed. These counts indicate planning work, not test pass rates or numerical coverage percentages.

Example data is fictional. This register does not integrate with Testmo, execute tests, or sync with GitLab. Links can be recorded as text in the evidence and next-action columns.

Team, Authorization, and Retries / concurrency fields have been removed. Older imports and restored drafts are migrated automatically. The Comment field preserves the former Most important gap values.
