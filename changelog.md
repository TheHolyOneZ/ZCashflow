# Changelog

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
