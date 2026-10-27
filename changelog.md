# Changelog

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
