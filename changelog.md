# Changelog

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
