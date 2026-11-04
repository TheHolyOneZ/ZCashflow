# Changelog

## 1.8.2

### Added

- Time picker in all time fields (transactions, recurring payments, receipts and bulk changes): the clock icon opens a grid for the hour and minute, with buttons to change the time by one minute and to take the current time. Typing a time works as before.
- New setting *Settings → Amounts & transactions → Time format*, per device: *24-hour* (default) or *12-hour*, which shows AM/PM in time fields, the picker and lists.

### Changed

- *Statistics* keeps the month or year, the income or expense tab, the currency and the unfolded categories while the app is open, so they are still there when you come back from a category's transactions.
- Times now always follow the *Time format* setting. With the English language, lists used to show 12-hour times; they now show 24-hour times unless *12-hour* is selected.

### Notes

- No database or sync schema change; devices on 1.8.1, 1.8.0 and 1.7.0 still sync.

## 1.8.1

### Added

- *Restore backup* under *Settings → Data*, on all platforms including Android and iOS:
  - Pick a backup file (`.db`, or `.zcvault` for backups saved with a password). Before anything changes, the dialog shows how many entries and accounts the backup holds and the period it covers; encrypted backups first ask for the password that was set when they were saved.
  - By default the current data is saved as a backup first.
  - The backup replaces entries, accounts, categories and settings on this device. The device keeps its own identity, password (if set), pairings and device-specific settings (sync, OCR and AI). On a protected device the restored data is stored encrypted right away.
  - Paired devices take over the restored data with the next sync; entries added on them after the backup are kept. Backups from older versions are updated on the fly; backups from newer versions are refused with a message.
  - Receipt photos aren't part of a backup. Paired devices send missing photos again.
- The *Data* settings explain what a backup contains and that backups made with a password are encrypted. After saving a backup, a message says where to restore it.

### Fixed

- Sync could connect and drop again every few seconds without exchanging anything. Changes arrive in batches of 500, and a batch that referenced a row from a later batch – typically a category changed after the entries that use it – failed as a whole and was retried endlessly. Changes are now applied regardless of order, and a single row that can't be applied is skipped and logged instead of stopping the sync.
- *Delete everything* with *Save a backup first* now saves an encrypted `.zcvault` backup on a protected device, named accordingly.

### Notes

- No sync schema change; devices on 1.8.0 and 1.7.0 still sync. Update all devices to get the sync fix on both ends.

## 1.8.0

### Added

- Password protection with encryption, per device, under *Settings → Security*:
  - With a password set, the database is stored as one encrypted file (`zcashflow.vault`) and receipt photos and thumbnails are encrypted as well. Encryption uses XChaCha20-Poly1305; the key is derived from the password with Argon2id. The unencrypted database file is removed.
  - While the app runs, the data is kept in memory and written back encrypted about a second after every change, when the app goes to the background and when it quits.
  - The app asks for the password when it starts. It can also lock itself as soon as it goes to the background or after 1, 5 or 15 minutes without use (default: 5 minutes), and *Lock now* is available in the title bar, the phone header and the settings.
  - The password can be changed or removed again; removing it stores the data unencrypted as before.
  - The password only applies to the device it was set on and is never synced. Paired devices keep syncing while the app is unlocked, and each device can have its own password or none.
  - A forgotten password can't be recovered. The lock screen offers to reset the device, which deletes all data on it; paired devices keep their data, so the device can be paired again to get it back.
  - With a password set, *Save backup* writes an encrypted backup (`.zcvault`) that needs the same password.
- When a period contains a balance correction, the transactions list shows *Balance corrected on …* in place of the carried-over value, with a hint why there is none.

### Fixed

- Balances before a balance correction (*Correct balance*, or an import with *Keep today's balances*) are counted back from the corrected amount. Before, every earlier month and day showed the corrected amount itself as its balance and carried-over value.
- The carried-over value is only hidden for periods that contain the correction; months before it show it again.

### Notes

- No sync schema change; devices on 1.7.0 still sync. The database gains no new columns.
- A device with a password can't be opened by older versions of ZCashflow. Remove the password before going back to an older version.

## 1.7.0

### Added

- Several transactions can be changed at once. Choose *Select* in the right-click menu of a transaction (long-press on phones and tablets), or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>-click it; <kbd>Shift</kbd>-click selects a range. A bar at the bottom changes the category, date (optionally with a time) or account of all selected entries, or deletes them. Transfers keep their accounts and have no category, and an account is only changed for entries in its currency; skipped entries are counted in the message. <kbd>Esc</kbd> clears the selection.
- *Create more* in the new-transaction dialog: after saving, the dialog stays open with an empty form, keeping type, date and account. The choice is remembered per device.
- New setting *Settings → Amounts & transactions → Enter in the transaction form*, per device: *Saves* (default, as before) or *Next field*, which goes from amount to description and category and then to *Save*.
- <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> saves the transaction form from any field.
- On touch screens, swiping left or right in the transactions list (when a month is shown) and on *Statistics* switches to the next or previous period.
- Categories can be exported to and imported from a JSON file on the *Categories* page – with any depth of subcategories, icons and colors. `out` holds expense categories, `in` income categories and `both` categories for both; every entry has a `name`, an optional `symbol` and `color`, and `subcategories`. Existing categories are matched by name within the same parent, so a file can be imported again without duplicates; new categories are added after the existing ones, and the order in the file is kept. A preview shows new, changed and unchanged categories and points out unknown icons or colors before anything is saved. Common icon names such as `water_drop` or `cable` are mapped to the app's icons, and the dialog lists all available icon names.
- Two new category icons: droplet and zap.
- The carried-over balance in the transactions list explains that it is already part of the account balance, so it doesn't need to be booked as income.

### Fixed

- On Windows the close button sometimes needed a second click, e.g. in full screen. It now leaves full screen and quits the app directly.

### Notes

- No database or sync schema change; devices on 1.6.0 still sync.

## 1.6.0

### Added

- New *Statistics* page: expenses and income per category for a month or a year, with ◀ ▶ to switch periods, a donut chart and the categories ranked by amount with their share. Main categories fold out to their subcategories, shown with their share of the main category; amounts booked directly on a main category are listed separately. Tapping a category opens the matching transactions for that period. With several currencies, the currency can be chosen.
- The category filter in the transactions list opens a panel with *Expenses* and *Income* tabs, the total of each tab and the amount of every category for the current period, largest first. Subcategories fold out, and several categories can be selected at once. Entries without a category can be filtered too.
- Categories can be put in any order: drag a category by its handle onto the upper or lower edge of another one to place it before or after it, or use *Move up* / *Move down* in the right-click menu. Dropping onto the middle still makes it a subcategory. The order is used in every category list and picker and syncs to paired devices.
- Two export options under *Settings → Data* and in the export dialog, per device. The defaults stay as before:
  - *Expense amounts*: with a minus (as before) or as positive amounts; the *type* column tells income and expenses apart.
  - *Category columns*: one column with the path (as before) or additional *main_category* and *subcategory* columns for filters and pivot tables. The *category* column stays, so the file can still be imported.

### Changed

- *Statistics* has no number shortcut, so <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>1</kbd> … <kbd>9</kbd> keep jumping to the same sections as before.

### Notes

- The database gets a new optional column for the category order. The sync schema stays at version 6, so devices on 1.5.0 still sync; they show categories in their previous order and keep the order set on an updated device.

## 1.5.0

### Added

- The pairing code, the pairing request and the *By address* dialog warn to only pair your own devices: paired devices share all data – transactions, accounts and receipts – and unpairing doesn't separate it again.
- The role of a new device (*Full access*, *Read only*, *Receipts only*) can be chosen right next to the pairing code. Before, it could only be changed after pairing.

### Fixed

- With *Visible on the network* turned off, a device still answered network searches with its name and still showed pairing requests from other devices. A hidden device now stays silent for searches and pairing requests. It becomes findable only while a pairing code is shown, and is hidden again as soon as pairing finishes, is cancelled or the code expires.

### Notes

- Paired devices keep syncing while hidden. If both devices are hidden and their network addresses change, show a pairing code on one of them for a moment, or connect by address, so they find each other again.
- No database or sync schema change; devices on 1.4.0 still sync.

## 1.4.0

### Added

- All ISO currencies can be chosen for accounts, the default currency and during setup – e.g. LKR, INR or PKR – shown with their names. Before, only 11 currencies were available.
- When the default currency is changed and all accounts use one other currency, ZCashflow offers to switch the accounts and all entries, recurring payments, budgets, goals and debts to the new currency. Amounts stay the same; only the currency changes. Not offered between currencies with a different number of decimal places.
- New settings section *Amounts & transactions*, per device. The defaults stay as before:
  - *Currency symbol*: hide it while all accounts use the same currency.
  - *Expenses*: show them in red without a minus sign. Balances keep their minus sign.
  - *Transactions open with*: the current month instead of all time.
- The transactions list shows ◀ month ▶ arrows when a full month is selected, and *Month view* to jump to the current month.
- The totals in the transactions list show the balance carried over from before the period and the balance at its end, when no category, type or search filter is set. The carried-over balance is left out for accounts corrected within the period, since their earlier history is not known.
- The description field in the transaction dialog and the *Simple* view suggests earlier descriptions while typing, most used first. Picking one fills in its category. The typed part is highlighted in suggestions.
- *Devices & sync* has a troubleshooting section for Windows, macOS, Linux, Android and iPhone, with copyable firewall commands. Before, only Linux had a hint.

### Fixed

- The overview showed a total balance of 0 when the default currency differed from the currency of the accounts. The overview, forecast, month plan and insights now use the currency the accounts actually use, and balances of accounts in other currencies are listed below the total.

### Notes

- No database or sync schema change; devices on 1.3.0 still sync. The default currency is stored per device, so after switching currencies on one device, choose the same default currency on the others.

## 1.3.0

### Added

- The transactions list shows income, expenses and net at the top, for exactly what the filters select: everything, one account, one category, or a period set with *From* and *To*. With several currencies, each currency gets its own line.
- Every day in the transactions list shows that day's income and expenses in its header.
- Transactions can have a time. New entries made for today get the current time automatically – in the transaction dialog, the quick entry (Ctrl+K) and the *Simple* view. The time can be changed or removed, and older or past entries can stay without one.
- The time is shown in the transactions list and in the *Simple* view, and entries of the same day are sorted by it.
- Receipt recognition reads the time printed on the receipt and books the entry with it. Opening hours on the receipt are ignored.
- The time is exported as its own CSV column and can be imported – from a *time* / *Uhrzeit* column or from a date like `26.10.2026 14:30`.
- Recurring payments can have an optional time, e.g. 09:00 for a salary. Automatic bookings get that time, and on the due day they are booked once that time has passed. The time is shown in the recurring list, the planner and the pending confirmations, and included in the CSV export of recurring payments.

### Changed

- The number of transactions in the page header counts all matches, not only the entries loaded into the list.
- Due recurring payments are checked every minute instead of every ten minutes, and again whenever the app comes back to the foreground – so on phones they are booked as soon as the app is opened.

### Notes

- The database gets new optional time columns for transactions and recurring payments; existing entries keep working without a time. The sync schema stays at version 6, so devices on 1.2.0 still sync. A device on 1.2.0 doesn't show or change the time, and its edits keep the time set on an updated device. A device on 1.2.0 books timed recurring payments at the start of the day without a time, so please update all paired devices.

## 1.2.0

### Added

- Categories can be nested as deep as you like. Drag a category by its handle onto another one to make it a subcategory, or onto the drop zone to make it a main category. Works with mouse and touch. The context menu also offers *Add subcategory* and *Make main category*.
- Budgets, the transaction filter and the category totals include all levels of subcategories.
- Export dialog: export everything or a selection (transactions, accounts, categories, recurring payments, budgets, savings goals, debts) for all time, this year, the last 12 months or a custom period. Several selections are saved as one ZIP file with a CSV file each. The *Excel (;)* format uses semicolons and decimal commas for European Excel; *Standard (,)* uses commas and decimal points.
- The transactions page exports the current filtered list, and the recurring page exports all recurring payments.
- CSV import with a downloadable ZCashflow template. Bank exports work directly: column names such as *Buchungstag*, *Betrag*, *Verwendungszweck* or *Empfänger* are recognised, as are dates like `26.10.2026` and amounts like `-1.234,56`. The preview shows rows, duplicates, errors and new accounts or categories before anything is saved. Optional: suggest categories, skip entries that already exist, and keep today's account balances so imported history doesn't change them.
- Receipts can be split into line items. Recognised items can be edited, each item can get its own category, and items of the same category can be combined. Booking creates one entry per category, all linked to the same photo.
- Line items are recognised from receipt text; a local AI model returns them too. Known store names (REWE, Lidl, dm …) are preferred as merchant.
- Receipts can be imported from PDF scans made with phone scanner apps.
- Forecast charts on the overview and in the planner can show selected accounts only, or one curve per account.
- Budgets can be included in the month plan, forecast and safe-to-spend – all of them or a selection. For the current period, at least the normal budget rate for the remaining days is planned.
- Minimize, maximize and quit stay available in narrow windows, and F11 toggles full screen.

### Fixed

- Importing a receipt on Android failed with "expected raw image bytes".
- HEIC/HEIF photos now show a clear message instead of a generic error.
- Exporting and saving a backup on Android write to the chosen location.

### Notes

- No database or sync schema change. Devices on older versions sync as before, but they don't show categories below the second level, so please update all paired devices.

## 1.1.1

### Fixed

- Correcting an account balance no longer appears to revert when the account has transactions dated after today. Today's balance now only counts transactions dated up to today, so it shows exactly the balance you entered.
- Transactions dated in the future count towards the balance on their date. The forecast, month preview and "safe to spend" include them on that day.
- Removed a doubled colon after "Difference" in the balance correction dialog.

## 1.1.0

### Added

- The balance correction dialog now compares the recorded balance immediately before correction with the bank balance entered by the user and displays the difference. The difference can help identify missing or incorrect entries; it does not guess which transaction is missing or reconstruct an opening balance.

### Fixed

- Correcting an account balance now saves the entered balance instead of reverting to the previous figure. Zero and negative balances are accepted.
- Transactions after the correction date continue to adjust the corrected balance; earlier transactions remain history.
- Account balance corrections sync separately from account details, so editing an account's name or color on another device does not overwrite the correction.
- Upcoming recurring occurrences refresh every 60 seconds while the relevant query is active, so a payment that becomes due appears without restarting or navigating away.

### Preserved

- Ordinary transaction and recurring-payment amounts must still be greater than zero.
- Existing balance corrections are carried forward by the database migration.
- Deleted recurring occurrences are not recreated automatically.
- Sync uses schema version 6; paired devices must both support that schema.
