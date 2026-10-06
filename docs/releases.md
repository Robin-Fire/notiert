# Releasing captured

The Windows installer is published through GitHub Releases. The repository is configured as `Robin-Fire/notiert` (the existing GitHub repository; rename it to captured and update this setting together) in `electron-builder.yml`.

1. Update the version in `package.json`.
2. Commit the change and create a tag matching the version, for example `v0.1.2`.
3. Push the commit and tag: `git push origin master --tags`.
4. GitHub Actions runs typecheck, tests, and the Windows installer build.

Installed copies check GitHub Releases for a newer version. They download it automatically and show an update action in the app when it is ready to install.

## 0.1.10

- Updated captured branding and improved text sizes across the sidebar, tasks, and calendar.
- Added multi-select tag inclusion/exclusion and predefined tag color palettes.
- Remembered capture categories during the session and simplified Inbox classification controls.
- Made calendar cards opaque, fixed modal layering, removed all-day task scheduling, and returned unfinished past plans to Ready.
- Kept task creation available on an empty Backlog and removed transient empty category headers.
- Reduced backlog reads with shared category counts, skipped empty/collapsed task pages, and removed unused tag-option queries.
- Separated taxonomy notifications from routine task changes and scheduled task rollover at local midnight and resume.
- Removed the unused calendar example and its UI wrappers.
