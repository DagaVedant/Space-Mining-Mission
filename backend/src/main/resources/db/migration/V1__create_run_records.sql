CREATE TABLE run_records (
    id VARCHAR(36) PRIMARY KEY,
    callsign VARCHAR(32) NOT NULL,
    seed BIGINT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    final_savings_billions BIGINT NOT NULL,
    cargo_billions BIGINT NOT NULL,
    shipments_launched INTEGER NOT NULL,
    pills_delivered INTEGER NOT NULL,
    peak_heat INTEGER NOT NULL,
    final_health INTEGER NOT NULL,
    completion_status VARCHAR(16) NOT NULL,
    loss_reason VARCHAR(16) NOT NULL,
    selected_upgrades VARCHAR(1024),
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL
);
