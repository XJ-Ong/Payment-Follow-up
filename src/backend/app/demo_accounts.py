"""Public, disposable demonstration credentials. Never private production passwords."""
DEMO_ACCOUNTS = (
    dict(staff='USR-01', label='Owner', email='admin@test.com', password='admintest12345'),
    dict(staff='USR-02', label='Finance', email='finance@demo.local', password='FinanceDemo!2026'),
    dict(staff='USR-05', label='Backup Finance', email='backup@demo.local', password='BackupDemo!2026'),
)

# Older seeded Owner credentials remain ineligible for production authentication.
LEGACY_DEMO_ACCOUNTS = (
    dict(email='owner@demo.local', password='OwnerDemo!2026'),
)
